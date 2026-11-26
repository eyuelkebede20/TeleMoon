// MTProto layer via GramJS. We deliberately avoid the Bot HTTP API
// (20 MB download / 50 MB upload caps). Over MTProto a bot can move
// up to 2 GB per message; a premium *user* session raises that to 4 GB.
import telegram from "telegram";
import sessionsMod from "telegram/sessions/index.js";
import eventsMod from "telegram/events/index.js";
import bigInt from "big-integer";
import { cfg } from "./config.js";
import {
  createFileNode, getSetting, setSetting,
  saveTgEntity, getTgEntity, escapeRegex, User,
} from "./db.js";
import { emitSyncChange } from "./sync.js";

const { TelegramClient, Api } = telegram;
const { StringSession } = sessionsMod;
const { NewMessage, Raw } = eventsMod;

export const tg = {
  client: null,
  channel: null, // resolved entity
  ready: false,
  mode: null, // "bot" | "user"
  botUsername: null,
  error: null,
};

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

// Per-client in-memory cache of verified full Channel / Chat entities
const verifiedByClient = new WeakMap();
function getVerifiedMap(client) {
  if (!client) return null;
  let map = verifiedByClient.get(client);
  if (!map) {
    map = new Map();
    verifiedByClient.set(client, map);
  }
  return map;
}

function cacheVerified(client, ent) {
  if (!client || !ent || !ent.id) return;
  if (ent.className !== "Channel" && ent.className !== "Chat") return;
  const map = getVerifiedMap(client);
  const cleanId = ent.id.toString().replace(/^-100/, "").replace(/^-/, "");
  map.set(cleanId, ent);
  if (ent.username) map.set(`@${ent.username.toLowerCase()}`, ent);
}

async function persistEntity(ent) {
  if (!ent || !ent.id) return;
  if (ent.className !== "Channel" && ent.className !== "Chat") return;
  if (ent.min) return; // Min entities carry restricted hashes unusable as InputPeer
  try {
    await saveTgEntity({
      id: ent.id.toString(),
      accessHash: ent.accessHash?.toString?.() || null,
      title: ent.title || null,
      username: ent.username || null,
      className: ent.className,
    });
  } catch (e) {
    console.warn("[tg] saveTgEntity:", e.message);
  }
}

/**
 * Parse any Telegram channel/group reference (t.me/c/<id>/<msg>, topic links,
 * t.me/+invite, public links, @username, or bare/-100 numeric IDs) into a canonical form.
 */
export function normalizeChannelRef(input) {
  const raw = String(input || "").trim();
  if (!raw) return { type: "empty", raw: "", ref: "" };

  // Invite links: https://t.me/+HASH, https://t.me/joinchat/HASH, tg://join?invite=HASH, or +HASH
  const invite = raw.match(
    /(?:(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:joinchat\/|\+)|tg:\/\/join\?invite=|^(?:\+|joinchat\/))([A-Za-z0-9_-]{8,})/i
  );
  if (invite) {
    return { type: "invite", hash: invite[1], ref: raw };
  }

  // Private channel/supergroup links (including topic links):
  // https://t.me/c/3836770302/35, https://t.me/c/3836770302/12/35, tg://privatepost?channel=3836770302&post=35
  const cMatch =
    raw.match(/(?:t\.me|telegram\.me|telegram\.dog)\/c\/(\d+)(?:\/\d+)*(?:[/?#]|$)/i) ||
    raw.match(/tg:\/\/privatepost\?[^#]*\bchannel=(\d+)/i);
  if (cMatch) {
    const cleanId = cMatch[1];
    return { type: "id", cleanId, ref: `-100${cleanId}` };
  }

  // Telegram Web URLs ending in #-1001234567 or #-1234567
  const webHashMatch = raw.match(/#(-?100\d+|-\d+)$/);
  if (webHashMatch) {
    const idStr = webHashMatch[1];
    if (/^-?100\d+$/.test(idStr)) {
      const formatted = idStr.startsWith("-") ? idStr : `-${idStr}`;
      return { type: "id", cleanId: formatted.slice(4), ref: formatted };
    }
    return { type: "id", cleanId: idStr.slice(1), ref: idStr };
  }

  // Public channel/group links: https://t.me/username or https://t.me/s/username or https://t.me/username/123
  const pubMatch = raw.match(
    /(?:t\.me|telegram\.me|telegram\.dog)\/(?:s\/)?([A-Za-z]\w{3,})(?:\/\d+)?(?:[/?#]|$)/i
  );
  if (
    pubMatch &&
    !["joinchat", "c", "addstickers", "addemoji", "share", "iv", "proxy"].includes(pubMatch[1].toLowerCase())
  ) {
    return { type: "username", username: pubMatch[1], ref: `@${pubMatch[1]}` };
  }

  // Direct numeric IDs
  if (/^-?100\d+$/.test(raw)) {
    const formatted = raw.startsWith("-") ? raw : `-${raw}`;
    return { type: "id", cleanId: formatted.slice(4), ref: formatted };
  }
  if (/^-\d+$/.test(raw)) {
    return { type: "id", cleanId: raw.slice(1), ref: raw };
  }
  if (/^\d{10,}$/.test(raw)) {
    return { type: "id", cleanId: raw, ref: `-100${raw}` };
  }
  if (/^\d{5,9}$/.test(raw)) {
    return { type: "id", cleanId: raw, ref: `-${raw}` };
  }

  // Username: @name or clean username
  if (raw.startsWith("@") && /^@[A-Za-z]\w{3,32}$/.test(raw)) {
    return { type: "username", username: raw.slice(1), ref: raw };
  }
  if (/^[A-Za-z]\w{3,32}$/.test(raw)) {
    return { type: "username", username: raw, ref: `@${raw}` };
  }

  return { type: "other", ref: raw };
}

export async function initTelegram() {
  if (!cfg.apiId || !cfg.apiHash || (!cfg.botToken && !cfg.session)) {
    tg.error = "Telegram not configured (TG_API_ID / TG_API_HASH / TG_BOT_TOKEN or TG_SESSION)";
    console.warn(`[tg] ${tg.error} — API is up, storage is disabled.`);
    return;
  }

  const client = new TelegramClient(
    new StringSession(cfg.session || ""),
    cfg.apiId,
    cfg.apiHash,
    { connectionRetries: 5 }
  );

  if (cfg.botToken) {
    await client.start({ botAuthToken: cfg.botToken });
    tg.mode = "bot";
  } else {
    await client.connect(); // pre-generated user session (see scripts/login.js)
    tg.mode = "user";
  }
  tg.client = client;

  try {
    const me = await client.getMe();
    if (me?.username) tg.botUsername = me.username;
  } catch (_) {}

  console.log(
    `[tg] connected (${tg.mode}${tg.botUsername ? ` @${tg.botUsername}` : ""}). Tip: set TG_SESSION to reuse this session:\n` +
      `TG_SESSION=${client.session.save()}`
  );

  // Persist entities seen in raw updates (covers service events such as adding the bot/account to a group)
  client.addEventHandler((update) => {
    if (update?._entities?.size) {
      for (const ent of update._entities.values()) {
        if (ent && (ent.className === "Channel" || ent.className === "Chat") && ent.id && !ent.min) {
          cacheVerified(client, ent);
          persistEntity(ent);
        }
      }
    }
  }, new Raw({}));

  // One handler covers both jobs: while no channel is linked it echoes ids
  // (bot-mode setup aid); once linked it indexes foreign document posts.
  client.addEventHandler(onChannelPost, new NewMessage({}));

  // Channel: DB setting (linked from the UI) wins; TG_CHANNEL_ID is a seed; fallback to linked users' channels.
  const userChannelIds = await User.distinct("channel_id", { channel_id: { $nin: [null, ""] } }).catch(() => []);
  const candidates = [await getSetting("channel"), cfg.channel, ...userChannelIds].filter(Boolean);
  const saved = candidates[0];
  if (!saved) {
    tg.error = "no storage linked yet — paste a channel link in the app";
    console.log(`[tg] ${tg.error}`);
    return;
  }

  let linked = false;
  let lastBootErr = null;
  for (const candidate of [...new Set(candidates)]) {
    try {
      const { title } = await setChannel(candidate);
      console.log(`[tg] storage channel: "${title}"`);
      linked = true;
      break;
    } catch (e) {
      lastBootErr = e;
    }
  }
  if (!linked && lastBootErr) {
    tg.error = `stored channel unreachable: ${lastBootErr.message}`;
    console.warn(`[tg] ${tg.error}`);
  }
}

/** Hydrate InputPeerChannel / InputPeerChat to full Channel / Chat entity when needed. */
async function hydrateEntity(ent) {
  if (!ent || !tg.client) return ent;
  if (ent.className === "InputPeerChannel" || ent.className === "InputPeerChat") {
    return await tg.client.getEntity(ent);
  }
  return ent;
}

/** Point storage at a channel/supergroup; persists across restarts. */
export async function setChannel(refOrEntity) {
  if (!tg.client) throw err("Telegram offline", 503);
  let ent = refOrEntity;
  if (typeof ent !== "object" || !ent?.className) {
    ent = await resolvePeer(ent, { requireFullEntity: true });
  } else {
    ent = await hydrateEntity(ent);
  }

  if (!ent || (ent.className !== "Channel" && ent.className !== "Chat")) {
    if (ent?.className?.includes("Forbidden")) {
      throw err("TeleMoon cannot access this channel — it was kicked or access is forbidden", 403);
    }
    throw err("TeleMoon needs a channel or group — private user chats aren't supported", 400);
  }

  tg.channel = ent;
  tg.ready = true;
  tg.error = null;

  const isChannel = ent.className === "Channel";
  const formattedId = isChannel ? `-100${ent.id.toString()}` : `-${ent.id.toString()}`;
  cacheVerified(tg.client, ent);
  await setSetting("channel", formattedId);
  await persistEntity(ent);
  return { id: formattedId, title: ent.title || "Untitled" };
}

/** Accepts t.me/+HASH invite links, t.me/c/... channel links, t.me/name, @name, or IDs. */
export async function connectByLink(link) {
  if (!tg.client) throw err(tg.error || "Telegram offline", 503);
  const raw = String(link || "").trim();
  if (!raw) throw err("Please enter a channel link, @username, or chat ID", 400);

  const parsed = normalizeChannelRef(raw);

  if (parsed.type === "invite") {
    if (tg.mode === "bot") {
      throw err(
        "Telegram bots cannot follow invite links. Please add your bot to the channel/group as an Administrator, then enter the channel's https://t.me/c/... link, @username, or ID (-100...)",
        400
      );
    }
    const hash = parsed.hash;
    try {
      const upd = await tg.client.invoke(new Api.messages.ImportChatInvite({ hash }));
      const chat = upd.chats?.[0];
      if (chat) return await setChannel(chat);
    } catch (e) {
      const errMsg = e.errorMessage || e.message || "";
      if (/ALREADY_PARTICIPANT/.test(errMsg)) {
        try {
          const info = await tg.client.invoke(new Api.messages.CheckChatInvite({ hash }));
          if (info?.chat) return await setChannel(info.chat);
        } catch (_) {}
        throw err(
          "You are already a participant in this chat. Please select it from your channels list below or enter its t.me/c/... link or ID.",
          400
        );
      }
      if (/INVITE_HASH/.test(errMsg)) {
        throw err("That Telegram invite link is invalid or has expired.", 400);
      }
      if (/CHANNELS_TOO_MUCH/.test(errMsg)) {
        throw err("Your Telegram account is in too many channels or groups. Please leave some before joining new ones.", 400);
      }
      if (/USERS_TOO_MUCH/.test(errMsg)) {
        throw err("This Telegram channel or group has reached its maximum member limit.", 400);
      }
      if (/INVITE_REQUEST_SENT/.test(errMsg)) {
        throw err("A request to join this channel was sent. Please approve it in Telegram, then connect again.", 400);
      }
      throw err(errMsg || "Failed to join Telegram channel via invite link", 400);
    }
  }

  if (parsed.type === "id" || parsed.type === "username") {
    return await setChannel(parsed.ref);
  }

  return await setChannel(raw);
}

/** Channels & groups this account has accessed (user session only). */
export async function listDialogs() {
  if (!tg.client) throw err(tg.error || "Telegram offline", 503);
  if (tg.mode === "bot")
    throw err("browsing your chats needs a user session (npm run login) — bots can't list dialogs", 400);

  const seen = new Set();
  const result = [];
  for (const params of [{ limit: 200 }, { limit: 200, archived: true }]) {
    const dialogs = await tg.client.getDialogs(params).catch((e) => {
      if (params.archived) return [];
      throw e;
    });
    for (const d of dialogs) {
      if (d.entity?.className !== "Channel" && d.entity?.className !== "Chat") continue;
      const isChannel = d.entity.className === "Channel";
      const id = isChannel ? `-100${d.entity.id.toString()}` : `-${d.entity.id.toString()}`;
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({
        id,
        title: d.entity.title || "Untitled Chat",
        username: d.entity.username || null,
        group: isChannel ? !!d.entity.megagroup : true,
        current: !!tg.channel && d.entity.id.toString() === tg.channel.id?.toString(),
      });
    }
  }
  return result;
}

async function searchDialogsForPeer(parsed) {
  if (tg.mode === "bot" || typeof tg.client.getDialogs !== "function") return null;
  const cleanT = parsed.cleanId || "";
  const matchUname = parsed.username ? parsed.username.toLowerCase() : null;
  for (const params of [{}, { archived: true }]) {
    try {
      const dialogs = await tg.client.getDialogs(params);
      const found = dialogs.find((d) => {
        if (!d?.entity) return false;
        if (d.entity.className !== "Channel" && d.entity.className !== "Chat") return false;
        const eid = d.entity.id?.toString();
        const did = d.id?.toString();
        const uname = d.entity.username?.toLowerCase();
        if (
          cleanT &&
          (eid === cleanT || did === cleanT || did === `-100${cleanT}` || did === `-${cleanT}`)
        ) {
          return true;
        }
        if (matchUname && uname && uname === matchUname) return true;
        return false;
      });
      if (found?.entity) return found.entity;
    } catch (_) {}
  }
  return null;
}

/** Resolve a string, bigInt, or entity into a verified Telegram Peer / Entity. */
export async function resolvePeer(refOrEntity, { requireFullEntity = false } = {}) {
  if (!tg.client) throw err("Telegram offline", 503);
  if (!refOrEntity) {
    if (tg.channel) return tg.channel;
    throw err("No channel or group connected", 400);
  }

  if (typeof refOrEntity === "object" && refOrEntity.className) {
    const resolved = requireFullEntity ? await hydrateEntity(refOrEntity) : refOrEntity;
    if (resolved?.id && (resolved.className === "Channel" || resolved.className === "Chat")) {
      cacheVerified(tg.client, resolved);
      await persistEntity(resolved);
    }
    return resolved;
  }

  const parsed = normalizeChannelRef(refOrEntity);
  if (parsed.type === "empty") {
    throw err("Please enter a channel link, @username, or chat ID", 400);
  }
  if (parsed.type === "invite") {
    throw err("Please use /tg/connect for invite links", 400);
  }
  if (parsed.type === "other") {
    throw err(`Invalid Telegram channel link or ID: "${parsed.ref}"`, 400);
  }

  const cleanR = parsed.cleanId || "";
  const matchUname = parsed.username ? parsed.username.toLowerCase() : null;

  // 1. Fast match against current channel or verified cache on this client
  if (tg.channel) {
    const chanIdStr = tg.channel.id?.toString().replace(/^-100/, "").replace(/^-/, "");
    const chanUname = tg.channel.username?.toLowerCase();
    if ((cleanR && cleanR === chanIdStr) || (matchUname && chanUname && matchUname === chanUname)) {
      return tg.channel;
    }
  }

  const verifiedMap = getVerifiedMap(tg.client);
  if (verifiedMap) {
    const cached =
      (cleanR && verifiedMap.get(cleanR)) ||
      (matchUname && verifiedMap.get(`@${matchUname}`));
    if (cached) return cached;
  }

  // 2. Check persistent MongoDB cache (and verify/hydrate via getEntity so stale accessHashes fall through cleanly)
  try {
    const savedEntity = (cleanR && (await getTgEntity(cleanR))) || (await getTgEntity(parsed.ref));
    if (savedEntity) {
      let candidatePeer = null;
      if (savedEntity.class_name === "Channel" && savedEntity.access_hash) {
        candidatePeer = new Api.InputPeerChannel({
          channelId: bigInt(savedEntity.id),
          accessHash: bigInt(savedEntity.access_hash),
        });
      } else if (savedEntity.class_name === "Chat") {
        candidatePeer = new Api.InputPeerChat({
          chatId: bigInt(savedEntity.id),
        });
      }
      if (candidatePeer) {
        try {
          const liveEnt = await tg.client.getEntity(candidatePeer);
          if (liveEnt && (liveEnt.className === "Channel" || liveEnt.className === "Chat")) {
            cacheVerified(tg.client, liveEnt);
            await persistEntity(liveEnt);
            return liveEnt;
          }
        } catch (dbVerifyErr) {
          console.warn("[tg] cached entity verification fell through:", dbVerifyErr.message);
        }
      }
    }
  } catch (dbErr) {
    console.warn("[tg] entity lookup warning:", dbErr.message);
  }

  // 3. Direct GramJS getEntity lookup
  const targetId = parsed.ref;
  const candidateTargets = [];
  if (parsed.type === "id") {
    candidateTargets.push(bigInt(targetId));
    // If targetId was "-<id>" (legacy chat format) also try supergroup "-100<id>"
    if (!targetId.startsWith("-100") && cleanR) {
      candidateTargets.push(bigInt(`-100${cleanR}`));
    }
  } else {
    candidateTargets.push(targetId);
  }

  let lastErr = null;
  for (const cand of candidateTargets) {
    try {
      const ent = await tg.client.getEntity(cand);
      if (ent && ent.id) {
        if (ent.className === "Channel" || ent.className === "Chat") {
          cacheVerified(tg.client, ent);
          await persistEntity(ent);
          return ent;
        }
        if (!requireFullEntity && (ent.className === "InputPeerChannel" || ent.className === "InputPeerChat")) {
          return ent;
        }
        if (requireFullEntity && (ent.className === "InputPeerChannel" || ent.className === "InputPeerChat")) {
          const full = await hydrateEntity(ent);
          if (full && (full.className === "Channel" || full.className === "Chat")) {
            cacheVerified(tg.client, full);
            await persistEntity(full);
            return full;
          }
        }
        // Only treat User entity as error (private user chats aren't storage channels)
        if (ent.className === "User" || ent.className === "InputPeerUser" || ent.className === "ChannelForbidden" || ent.className === "ChatForbidden") {
          return ent;
        }
      }
    } catch (e) {
      lastErr = e;
    }
  }

  // 4. User-mode dialog scan (checks active AND archived folders with no 150-chat limit)
  const dialogEntity = await searchDialogsForPeer(parsed);
  if (dialogEntity) {
    cacheVerified(tg.client, dialogEntity);
    await persistEntity(dialogEntity);
    return dialogEntity;
  }

  // 5. Try getInputEntity as final GramJS lookup, hydrating Channel/Chat peers
  for (const cand of candidateTargets) {
    try {
      const inputPeer = await tg.client.getInputEntity(cand);
      if (inputPeer && (inputPeer.className === "InputPeerChannel" || inputPeer.className === "InputPeerChat")) {
        try {
          const full = await hydrateEntity(inputPeer);
          if (full && (full.className === "Channel" || full.className === "Chat")) {
            cacheVerified(tg.client, full);
            await persistEntity(full);
            return full;
          }
        } catch (_) {}
        if (!requireFullEntity) return inputPeer;
      }
    } catch (e) {
      if (!lastErr) lastErr = e;
    }
  }

  // 6. Accurate error reporting (never silently switch to another channel or fabricate peers)
  const msg = lastErr?.errorMessage || lastErr?.message || "";
  if (/USERNAME_NOT_OCCUPIED|USERNAME_INVALID/i.test(msg)) {
    throw err(`The Telegram channel or group "${targetId}" does not exist. Please check for typos.`, 404);
  }
  if (/CHAT_ADMIN_REQUIRED|CHAT_WRITE_FORBIDDEN|CHANNEL_PRIVATE/i.test(msg)) {
    throw err("TeleMoon does not have permission to access this Telegram channel/group.", 403);
  }
  if (tg.mode === "bot") {
    throw err(
      `TeleMoon could not access group ${targetId}. Make sure @${tg.botUsername || "your bot"} is added to the group as an Administrator, send any message in the group, then try again.`,
      400
    );
  }
  if (parsed.type === "id") {
    throw err(
      `TeleMoon could not access private group ${targetId}. Make sure the connected Telegram account is a member of this group (a t.me/c/ link doesn't join automatically — paste a https://t.me/+... invite link instead, or add the account to the group first).`,
      400
    );
  }
  throw err(
    "TeleMoon could not find or access this Telegram channel. Make sure your account is a member or admin of the channel and check the link/ID.",
    400
  );
}

async function onChannelPost(ev) {
  try {
    const m = ev.message;
    const cid = m?.peerId?.channelId || m?.peerId?.chatId;
    if (!cid) return;

    const chat = ev.chat || m?.chat || (await ev.getChat?.().catch(() => null));
    if (chat) {
      cacheVerified(tg.client, chat);
      await persistEntity(chat);
    }

    const cidStr = cid.toString();
    const cleanCid = cidStr.replace(/^-100/, "").replace(/^-/, "");

    let matched = false;
    if (tg.channel) {
      const activeClean = tg.channel.id?.toString().replace(/^-100/, "").replace(/^-/, "");
      if (cleanCid === activeClean) matched = true;
    }

    const escapedCid = escapeRegex(cleanCid);
    const user = await User.findOne({
      $or: [
        { channel_id: `-100${cleanCid}` },
        { channel_id: `-${cleanCid}` },
        { channel_id: cleanCid },
        { channel_id: new RegExp(`(?:^|/c/)${escapedCid}(?:$|/)`) },
      ],
    }).lean();

    if (!matched && !user) {
      const isChan = m?.peerId?.className === "PeerChannel";
      console.log(`[setup] channel post from unlinked channel id: ${isChan ? `-100${cleanCid}` : `-${cleanCid}`}`);
      return;
    }

    const doc = m.media?.document;
    const photo = m.media?.photo;
    if (!doc && !photo) return;
    if ((m.message || "").startsWith("tm1;")) return;
    if (doc?.attributes?.some((a) => a.className === "DocumentAttributeSticker")) return;

    let name;
    let size = 0;
    let mime = null;

    if (doc) {
      const fnAttr = doc.attributes?.find(
        (a) => a.className === "DocumentAttributeFilename"
      );
      name = fnAttr?.fileName;
      if (!name) {
        const audioAttr = doc.attributes?.find(
          (a) => a.className === "DocumentAttributeAudio"
        );
        if (audioAttr?.title) {
          name = `${audioAttr.performer ? audioAttr.performer + " - " : ""}${audioAttr.title}`;
          const ext = doc.mimeType?.includes("ogg") ? ".ogg" : doc.mimeType?.includes("mp3") ? ".mp3" : ".m4a";
          if (!name.endsWith(ext)) name += ext;
        } else if (doc.attributes?.some((a) => a.className === "DocumentAttributeVideo")) {
          name = `video_${m.id}.mp4`;
        } else {
          const ext = doc.mimeType ? `.${doc.mimeType.split("/")[1] || "bin"}` : "";
          name = `telegram_${m.id}${ext}`;
        }
      }
      size = Number(doc.size?.toString?.() ?? doc.size);
      mime = doc.mimeType || null;
    } else if (photo) {
      const sizes = photo.sizes || [];
      const large = sizes[sizes.length - 1];
      size = Number(large?.size || (large?.w && large?.h ? Math.round(large.w * large.h * 0.3) : 100000));
      mime = "image/jpeg";
      const caption = (m.message || "").trim().slice(0, 40).replace(/[/\\]/g, "-");
      name = caption ? `${caption}_${m.id}.jpg` : `photo_${m.id}.jpg`;
    }

    name = String(name || `telegram_${m.id}`).replace(/[/\\]/g, "-").trim() || `telegram_${m.id}`;
    if (!size || isNaN(size)) return;

    const ownerId = user ? user.id : null;
    const { node } = await createFileNode({
      parentId: "root",
      name,
      size,
      mime,
      ownerId,
      parts: [{ msg_id: m.id, size }],
    });
    console.log(`[indexer] +${node?.name || name} (${size} B) from post ${m.id} -> root (owner: ${ownerId || "system"})`);
    if (ownerId) {
      emitSyncChange(ownerId, 0);
    }
    emitSyncChange("system", 0);
  } catch (e) {
    console.error("[indexer]", e);
  }
}

function assertClient() {
  if (!tg.client) throw err(tg.error || "Telegram offline", 503);
}

function assertReady() {
  assertClient();
  if (!tg.ready || !tg.channel) throw err(tg.error || "Telegram storage not connected", 503);
}

/** Upload a file from disk into the channel. Returns the message id. */
export async function sendDocument(filePath, fileName, caption, peer = null) {
  let target;
  if (peer) {
    assertClient();
    target = await resolvePeer(peer);
  } else {
    assertReady();
    target = tg.channel;
  }
  const msg = await tg.client.sendFile(target, {
    file: filePath,
    caption,
    forceDocument: true,
    attributes: [new Api.DocumentAttributeFilename({ fileName })],
  });
  return msg.id;
}

export async function getMessage(msgId, peer = null) {
  let target;
  if (peer) {
    assertClient();
    target = await resolvePeer(peer);
  } else {
    assertReady();
    target = tg.channel;
  }
  const [m] = await tg.client.getMessages(target, { ids: [msgId] });
  if (!m || !m.media) throw err(`message ${msgId} missing in channel (deleted?)`, 502);
  return m;
}

export async function deleteMessages(ids, peer = null) {
  if (!tg.client || !ids.length) return;
  let target;
  if (peer) {
    target = await resolvePeer(peer);
  } else {
    if (!tg.ready || !tg.channel) return;
    target = tg.channel;
  }
  for (let i = 0; i < ids.length; i += 100) {
    try {
      await tg.client.deleteMessages(target, ids.slice(i, i + 100), {
        revoke: true,
      });
    } catch (e) {
      console.warn("[tg] deleteMessages:", e.message);
    }
  }
}

/**
 * Stream bytes [from..to] (inclusive, chunk-local) of one stored message.
 * MTProto wants offsets aligned to 4096 and requestSize | 1 MB, so we
 * over-fetch to the previous 4 KB boundary and trim.
 * `write(buf) -> Promise<boolean>` returns false to abort (client gone).
 */
export async function streamRange(msgId, from, to, write, peer = tg.channel) {
  const m = await getMessage(msgId, peer);
  const aligned = from - (from % 4096);
  let skip = from - aligned;
  let remaining = to - from + 1;

  for await (const piece of tg.client.iterDownload({
    file: m.media,
    offset: bigInt(aligned),
    requestSize: 512 * 1024,
  })) {
    let buf = Buffer.from(piece);
    if (skip > 0) {
      if (buf.length <= skip) { skip -= buf.length; continue; }
      buf = buf.subarray(skip);
      skip = 0;
    }
    if (buf.length > remaining) buf = buf.subarray(0, remaining);
    remaining -= buf.length;
    const keepGoing = await write(buf);
    if (!keepGoing || remaining <= 0) break; // breaking closes the iterator
  }
}
