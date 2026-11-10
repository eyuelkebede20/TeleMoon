// MTProto layer via GramJS. We deliberately avoid the Bot HTTP API
// (20 MB download / 50 MB upload caps). Over MTProto a bot can move
// up to 2 GB per message; a premium *user* session raises that to 4 GB.
import telegram from "telegram";
import sessionsMod from "telegram/sessions/index.js";
import eventsMod from "telegram/events/index.js";
import bigInt from "big-integer";
import { cfg } from "./config.js";
import {
  ensureInboxFolder, createFileNode, getSetting, setSetting, getIndexedMessageIds,
  saveTgEntity, getTgEntity, q,
} from "./db.js";
import { emitSyncChange } from "./sync.js";

const { TelegramClient, Api } = telegram;
const { StringSession } = sessionsMod;
const { NewMessage } = eventsMod;

export const tg = {
  client: null,
  channel: null, // resolved entity
  ready: false,
  mode: null, // "bot" | "user"
  error: null,
};

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

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
  console.log(
    `[tg] connected (${tg.mode}). Tip: set TG_SESSION to reuse this session:\n` +
      `TG_SESSION=${client.session.save()}`
  );

  // One handler covers both jobs: while no channel is linked it echoes ids
  // (bot-mode setup aid); once linked it indexes foreign document posts.
  client.addEventHandler(onChannelPost, new NewMessage({}));

  // Channel: DB setting (linked from the UI) wins; TG_CHANNEL_ID is a seed.
  const saved = getSetting("channel") || cfg.channel;
  if (!saved) {
    tg.error = "no storage linked yet — paste a channel link in the app";
    console.log(`[tg] ${tg.error}`);
    return;
  }
  try {
    const { title } = await setChannel(saved);
    console.log(`[tg] storage channel: "${title}"`);
  } catch (e) {
    tg.error = `stored channel unreachable: ${e.message}`;
    console.warn(`[tg] ${tg.error}`);
  }
}

/** Point storage at a channel/supergroup; persists across restarts. */
export async function setChannel(refOrEntity) {
  if (!tg.client) throw err("Telegram offline", 503);
  let ent = refOrEntity;
  if (typeof ent !== "object" || !ent?.className) {
    ent = await resolvePeer(ent);
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
  setSetting("channel", formattedId);
  try {
    saveTgEntity({
      id: ent.id.toString(),
      accessHash: ent.accessHash?.toString?.() || null,
      title: ent.title || null,
      username: ent.username || null,
      className: ent.className || null,
    });
  } catch (e) {
    console.warn("[tg] saveTgEntity in setChannel:", e.message);
  }
  return { id: formattedId, title: ent.title || "Untitled" };
}

/** Accepts t.me/+HASH invite links, t.me/c/... channel links, t.me/name, @name, or IDs. */
export async function connectByLink(link) {
  if (!tg.client) throw err(tg.error || "Telegram offline", 503);
  const raw = String(link || "").trim();
  if (!raw) throw err("Please enter a channel link, @username, or chat ID", 400);

  // Private channel link: https://t.me/c/1234567890 or https://t.me/c/1234567890/123
  const cMatch = raw.match(/(?:t\.me\/|telegram\.me\/)c\/(\d+)(?:\/\d+)?/i);
  if (cMatch) {
    return await setChannel(`-100${cMatch[1]}`);
  }

  // Invite links: t.me/+HASH or t.me/joinchat/HASH
  const invite = raw.match(/(?:t\.me\/|telegram\.me\/)?(?:joinchat\/|\+)([A-Za-z0-9_-]{8,})/i);
  if (invite) {
    if (tg.mode === "bot") {
      throw err(
        "Telegram bots cannot follow invite links. Please add your bot to the channel/group as an Administrator, then enter the channel's @username or ID (-100...)",
        400
      );
    }
    const hash = invite[1];
    try {
      const upd = await tg.client.invoke(new Api.messages.ImportChatInvite({ hash }));
      const chat = upd.chats?.[0];
      if (chat) return await setChannel(chat);
    } catch (e) {
      const errMsg = e.errorMessage || e.message || "";
      if (/ALREADY_PARTICIPANT/.test(errMsg)) {
        try {
          const info = await tg.client.invoke(new Api.messages.CheckChatInvite({ hash }));
          if (info.chat) return await setChannel(info.chat);
        } catch (_) {}

        try {
          const dialogs = await tg.client.getDialogs({ limit: 150 });
          const groupOrChan = dialogs.find(
            (d) => d.entity && (d.entity.className === "Channel" || d.entity.className === "Chat")
          );
          if (groupOrChan?.entity) return await setChannel(groupOrChan.entity);
        } catch (_) {}

        throw err("You are already a participant in this chat. Please select it from your channels list below or enter its ID.", 400);
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

  // Public channel link: https://t.me/username or https://t.me/username/123
  const pubMatch = raw.match(/(?:t\.me\/|telegram\.me\/)([A-Za-z]\w{3,})(?:\/\d+)?/i);
  if (pubMatch && !["joinchat", "c"].includes(pubMatch[1].toLowerCase())) {
    return await setChannel(`@${pubMatch[1]}`);
  }

  // Direct channel or group ID
  if (/^-?100\d+$/.test(raw)) {
    const formatted = raw.startsWith("-") ? raw : `-${raw}`;
    return await setChannel(formatted);
  }
  if (/^-\d+$/.test(raw)) {
    return await setChannel(raw);
  }
  if (/^\d{10,}$/.test(raw)) {
    return await setChannel(`-100${raw}`);
  }
  if (/^\d{5,9}$/.test(raw)) {
    return await setChannel(`-${raw}`);
  }

  // Username format: @name or clean name
  if (raw.startsWith("@")) {
    return await setChannel(raw);
  }
  if (/^[A-Za-z]\w{3,32}$/.test(raw)) {
    return await setChannel(`@${raw}`);
  }

  return await setChannel(raw);
}

/** Channels & groups this account has accessed (user session only). */
export async function listDialogs() {
  if (!tg.client) throw err(tg.error || "Telegram offline", 503);
  if (tg.mode === "bot")
    throw err("browsing your chats needs a user session (npm run login) — bots can't list dialogs", 400);
  const dialogs = await tg.client.getDialogs({ limit: 200 });
  return dialogs
    .filter((d) => d.entity?.className === "Channel" || d.entity?.className === "Chat")
    .map((d) => {
      const isChannel = d.entity.className === "Channel";
      const id = isChannel ? `-100${d.entity.id.toString()}` : `-${d.entity.id.toString()}`;
      return {
        id,
        title: d.entity.title || "Untitled Chat",
        username: d.entity.username || null,
        group: isChannel ? !!d.entity.megagroup : true,
        current: !!tg.channel && d.entity.id.toString() === tg.channel.id.toString(),
      };
    });
}

/** Resolve a string, bigInt, or entity into a Telegram Entity */
export async function resolvePeer(refOrEntity) {
  if (!tg.client) throw err("Telegram offline", 503);
  if (!refOrEntity) return tg.channel;
  if (typeof refOrEntity === "object" && refOrEntity.className) {
    if (refOrEntity.id && (refOrEntity.className === "Channel" || refOrEntity.className === "Chat")) {
      try {
        saveTgEntity({
          id: refOrEntity.id.toString(),
          accessHash: refOrEntity.accessHash?.toString?.() || null,
          title: refOrEntity.title || null,
          username: refOrEntity.username || null,
          className: refOrEntity.className || null,
        });
      } catch (_) {}
    }
    return refOrEntity;
  }

  let r = String(refOrEntity).trim();

  // Strip t.me/c/... if passed directly
  const cMatch = r.match(/(?:t\.me\/|telegram\.me\/)c\/(\d+)/i);
  if (cMatch) {
    r = `-100${cMatch[1]}`;
  } else {
    // Strip public t.me/... if passed directly
    const pubMatch = r.match(/(?:t\.me\/|telegram\.me\/)([A-Za-z]\w{3,})/i);
    if (pubMatch && !["joinchat", "c"].includes(pubMatch[1].toLowerCase())) {
      r = `@${pubMatch[1]}`;
    }
  }

  const cleanR = r.replace(/^-100/, "").replace(/^-/, "");

  if (tg.channel) {
    const chanIdStr = tg.channel.id.toString().replace(/^-100/, "").replace(/^-/, "");
    if (cleanR === chanIdStr || r === tg.channel.username || (r.startsWith("@") && r.slice(1) === tg.channel.username)) {
      return tg.channel;
    }
  }

  // Check persistent SQLite database for entity access_hash
  try {
    const savedEntity = getTgEntity(cleanR) || getTgEntity(r);
    if (savedEntity) {
      if (savedEntity.class_name === "Channel" && savedEntity.access_hash) {
        return new Api.InputPeerChannel({
          channelId: bigInt(savedEntity.id),
          accessHash: bigInt(savedEntity.access_hash),
        });
      } else if (savedEntity.class_name === "Chat") {
        return new Api.InputPeerChat({
          chatId: bigInt(savedEntity.id),
        });
      }
    }
  } catch (dbErr) {
    console.warn("[tg] SQLite entity lookup warning:", dbErr.message);
  }

  let targetId = r;
  if (!targetId.startsWith("@") && !targetId.startsWith("-") && /^\d{10,}$/.test(targetId)) {
    targetId = `-100${targetId}`;
  } else if (!targetId.startsWith("@") && !targetId.startsWith("-") && /^\d+$/.test(targetId)) {
    targetId = `-${targetId}`;
  } else if (!targetId.startsWith("@") && !targetId.startsWith("-") && /^[A-Za-z]\w{3,32}$/.test(targetId)) {
    targetId = `@${targetId}`;
  }

  try {
    const ent = await tg.client.getEntity(/^-?\d+$/.test(targetId) ? bigInt(targetId) : targetId.startsWith("@") ? targetId : `@${targetId}`);
    if (ent && ent.id) {
      try {
        saveTgEntity({
          id: ent.id.toString(),
          accessHash: ent.accessHash?.toString?.() || null,
          title: ent.title || null,
          username: ent.username || null,
          className: ent.className || null,
        });
      } catch (_) {}
    }
    return ent;
  } catch (err1) {
    if (tg.mode !== "bot") {
      try {
        const dialogs = await tg.client.getDialogs({ limit: 150 });
        const cleanT = targetId.replace(/^-100/, "").replace(/^-/, "");
        const found = dialogs.find((d) => {
          if (!d.entity) return false;
          const eid = d.entity.id?.toString();
          const uname = d.entity.username?.toLowerCase();
          const matchUname = targetId.startsWith("@") ? targetId.slice(1).toLowerCase() : targetId.toLowerCase();
          return eid === cleanT || (uname && uname === matchUname);
        });
        if (found?.entity) {
          try {
            saveTgEntity({
              id: found.entity.id.toString(),
              accessHash: found.entity.accessHash?.toString?.() || null,
              title: found.entity.title || null,
              username: found.entity.username || null,
              className: found.entity.className || null,
            });
          } catch (_) {}
          return found.entity;
        }
      } catch (_) {}
    }

    const msg = err1.errorMessage || err1.message || "";
    if (/CHANNEL_INVALID|CHAT_INVALID|Could not find input entity|Cannot find any entity/i.test(msg)) {
      if (tg.mode === "bot") {
        throw err(
          "TeleMoon cannot access this channel/group. Make sure your Telegram bot is added to the channel as an Administrator with post/read permissions, then try again.",
          400
        );
      } else {
        throw err(
          "TeleMoon could not find or access this Telegram channel. Make sure your account is a member or admin of the channel and check the link/ID.",
          400
        );
      }
    }
    if (/USERNAME_NOT_OCCUPIED|USERNAME_INVALID/i.test(msg)) {
      throw err(`The Telegram channel or group "${targetId}" does not exist. Please check for typos.`, 404);
    }
    if (/CHAT_ADMIN_REQUIRED|CHAT_WRITE_FORBIDDEN/i.test(msg)) {
      throw err("Administrator permissions are required in this Telegram channel/group to connect storage.", 403);
    }
    throw err(msg || "Could not resolve Telegram channel", 400);
  }
}

/**
 * Scan past history of a channel / group and index all documents & photos into the virtual drive.
 */
export async function syncChannelHistory({ peerRef, ownerId, targetParentId = "root", limit = 1000 } = {}) {
  if (!tg.client) throw err("Telegram offline", 503);

  const entity = await resolvePeer(peerRef);
  if (!entity) throw err("No channel or group connected", 400);

  // Elevate any previously imported files sitting inside "Telegram Inbox" directly to 'root'
  try {
    q(`
      UPDATE nodes
      SET parent_id = ?
      WHERE parent_id IN (
        SELECT id FROM nodes WHERE name = 'Telegram Inbox' AND type = 'folder'
      )
      AND (owner_id = ? OR owner_id IS NULL)
    `).run(targetParentId || "root", ownerId || null);
  } catch (e) {
    console.warn("[tg] Elevate Inbox files warning:", e.message);
  }

  const existingMsgIds = getIndexedMessageIds(ownerId);

  let scanned = 0;
  let imported = 0;
  let skipped = 0;

  const processMessage = (m) => {
    if (!m) return false;
    scanned++;

    // Skip TeleMoon multipart uploads
    if ((m.message || "").startsWith("tm1;")) {
      skipped++;
      return false;
    }

    const doc = m.media?.document;
    const photo = m.media?.photo;
    if (!doc && !photo) return false;

    // Skip stickers
    if (doc?.attributes?.some((a) => a.className === "DocumentAttributeSticker")) {
      return false;
    }

    // Already indexed in our database
    if (existingMsgIds.has(m.id)) {
      skipped++;
      return false;
    }

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
    if (!size || isNaN(size)) return false;

    createFileNode({
      parentId: targetParentId || "root",
      name,
      size,
      mime,
      ownerId: ownerId || null,
      parts: [{ msg_id: m.id, size }],
    });

    existingMsgIds.add(m.id);
    imported++;
    return true;
  };

  let iterSuccess = false;
  try {
    for await (const m of tg.client.iterMessages(entity, { limit })) {
      processMessage(m);
    }
    iterSuccess = true;
  } catch (iterErr) {
    const iterMsg = iterErr.errorMessage || iterErr.message || "";
    console.warn(`[tg] iterMessages encountered: ${iterMsg}. Attempting fallback...`);

    const isRestricted = /CHAT_ADMIN_REQUIRED|BOT_METHOD_INVALID|CHANNEL_PRIVATE/i.test(iterMsg);
    if (!isRestricted && tg.mode !== "bot") {
      throw err(iterMsg || "Failed to scan Telegram history", 400);
    }

    try {
      let maxId = 0;
      try {
        const full = await tg.client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
        maxId = full?.fullChat?.readInboxMaxId || full?.fullChat?.readOutboxMaxId || full?.fullChat?.pts || 0;
      } catch (_) {}

      if (!maxId || maxId < 1) {
        maxId = 500;
      }

      const scanLimit = Math.min(limit, 1000);
      const startId = Math.max(1, maxId - scanLimit + 1);

      for (let fromId = maxId; fromId >= startId; fromId -= 100) {
        const batchIds = [];
        for (let i = fromId; i > Math.max(0, fromId - 100) && i >= startId; i--) {
          batchIds.push(i);
        }
        if (!batchIds.length) break;

        try {
          const msgs = await tg.client.getMessages(entity, { ids: batchIds });
          for (const m of msgs) {
            if (m && m.id) processMessage(m);
          }
        } catch (batchErr) {
          console.warn("[tg] batch getMessages warning:", batchErr.message);
          break;
        }
      }
      iterSuccess = true;
    } catch (fallbackErr) {
      console.warn("[tg] Fallback batch scan warning:", fallbackErr.message);
      if (imported === 0 && !iterSuccess) {
        throw err(iterMsg || fallbackErr.message || "Could not read chat history", 400);
      }
    }
  }

  // Notify connected clients
  if (ownerId) {
    emitSyncChange(ownerId, 0);
  }
  emitSyncChange("system", 0);

  return {
    scanned,
    imported,
    skipped,
    folderId: targetParentId || "root",
    folderName: targetParentId === "root" ? "Main Drive" : targetParentId,
  };
}

function onChannelPost(ev) {
  try {
    const m = ev.message;
    const cid = m?.peerId?.channelId || m?.peerId?.chatId;
    if (!cid) return;

    if (ev.chat) {
      try {
        saveTgEntity({
          id: ev.chat.id?.toString(),
          accessHash: ev.chat.accessHash?.toString?.() || null,
          title: ev.chat.title || null,
          username: ev.chat.username || null,
          className: ev.chat.className || null,
        });
      } catch (_) {}
    }

    const cidStr = cid.toString();
    const cleanCid = cidStr.replace(/^-100/, "").replace(/^-/, "");

    let matched = false;
    if (tg.channel) {
      const activeClean = tg.channel.id.toString().replace(/^-100/, "").replace(/^-/, "");
      if (cleanCid === activeClean) matched = true;
    }

    const user = q(
      `SELECT id FROM users WHERE channel_id = ? OR channel_id = ? OR channel_id = ? OR channel_id LIKE ?`
    ).get(`-100${cleanCid}`, `-${cleanCid}`, cleanCid, `%${cleanCid}%`);

    if (!matched && !user) {
      console.log(`[setup] channel post from unlinked channel id: -100${cid}`);
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
    const node = createFileNode({
      parentId: "root",
      name,
      size,
      mime,
      ownerId,
      parts: [{ msg_id: m.id, size }],
    });
    console.log(`[indexer] +${node.name} (${size} B) from post ${m.id} -> root (owner: ${ownerId || "system"})`);
    if (ownerId) {
      emitSyncChange(ownerId, 0);
    }
    emitSyncChange("system", 0);
  } catch (e) {
    console.error("[indexer]", e);
  }
}

function assertReady() {
  if (!tg.ready) throw err(tg.error || "Telegram storage not connected", 503);
}

/** Upload a file from disk into the channel. Returns the message id. */
export async function sendDocument(filePath, fileName, caption, peer = tg.channel) {
  assertReady();
  const target = peer ? await resolvePeer(peer) : tg.channel;
  const msg = await tg.client.sendFile(target, {
    file: filePath,
    caption,
    forceDocument: true,
    attributes: [new Api.DocumentAttributeFilename({ fileName })],
  });
  return msg.id;
}

export async function getMessage(msgId, peer = tg.channel) {
  assertReady();
  const target = peer ? await resolvePeer(peer) : tg.channel;
  const [m] = await tg.client.getMessages(target, { ids: [msgId] });
  if (!m || !m.media) throw err(`message ${msgId} missing in channel (deleted?)`, 502);
  return m;
}

export async function deleteMessages(ids, peer = tg.channel) {
  if (!tg.ready || !ids.length) return;
  const target = peer ? await resolvePeer(peer) : tg.channel;
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
