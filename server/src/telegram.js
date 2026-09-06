// MTProto layer via GramJS. We deliberately avoid the Bot HTTP API
// (20 MB download / 50 MB upload caps). Over MTProto a bot can move
// up to 2 GB per message; a premium *user* session raises that to 4 GB.
import telegram from "telegram";
import sessionsMod from "telegram/sessions/index.js";
import eventsMod from "telegram/events/index.js";
import bigInt from "big-integer";
import { cfg } from "./config.js";
import {
  ensureInboxFolder, createFileNode, getSetting, setSetting,
} from "./db.js";

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
  if (typeof ent !== "object") {
    const r = String(ent).trim();
    ent = await tg.client.getEntity(/^-?\d+$/.test(r) ? bigInt(r) : r.startsWith("@") ? r : `@${r}`);
  }
  if (ent.className !== "Channel")
    throw err("TeleMoon needs a channel or supergroup — plain group chats and users aren't supported");
  tg.channel = ent;
  tg.ready = true;
  tg.error = null;
  setSetting("channel", `-100${ent.id.toString()}`);
  return { id: `-100${ent.id.toString()}`, title: ent.title };
}

/** Accepts t.me/+HASH invite links, t.me/name, @name, or a -100… id. */
export async function connectByLink(link) {
  if (!tg.client) throw err(tg.error || "Telegram offline", 503);
  const raw = String(link || "").trim();
  if (!raw) throw err("paste a link first");

  const invite = raw.match(/(?:t\.me\/|telegram\.me\/)?(?:joinchat\/|\+)([A-Za-z0-9_-]{8,})\/?$/);
  if (invite) {
    if (tg.mode === "bot")
      throw err(
        "bots can't follow invite links — add the bot to the channel as admin, " +
          "then paste the channel's @name or -100… id (or switch to a user session: npm run login)"
      );
    const hash = invite[1];
    try {
      const upd = await tg.client.invoke(new Api.messages.ImportChatInvite({ hash }));
      return await setChannel(upd.chats?.[0]);
    } catch (e) {
      if (/ALREADY_PARTICIPANT/.test(e.errorMessage || e.message || "")) {
        const info = await tg.client.invoke(new Api.messages.CheckChatInvite({ hash }));
        if (info.chat) return await setChannel(info.chat);
      }
      if (/INVITE_HASH/.test(e.errorMessage || "")) throw err("that invite link is invalid or expired");
      throw e;
    }
  }

  const uname = raw.match(/(?:t\.me|telegram\.me)\/([A-Za-z]\w{3,})\/?$/)?.[1];
  return setChannel(uname ? `@${uname}` : raw);
}

/** Channels & supergroups this account has accessed (user session only). */
export async function listDialogs() {
  if (!tg.client) throw err(tg.error || "Telegram offline", 503);
  if (tg.mode === "bot")
    throw err("browsing your chats needs a user session (npm run login) — bots can't list dialogs");
  const dialogs = await tg.client.getDialogs({ limit: 200 });
  return dialogs
    .filter((d) => d.entity?.className === "Channel")
    .map((d) => ({
      id: `-100${d.entity.id.toString()}`,
      title: d.entity.title,
      username: d.entity.username || null,
      group: !!d.entity.megagroup,
      current: !!tg.channel && d.entity.id.toString() === tg.channel.id.toString(),
    }));
}

function onChannelPost(ev) {
  try {
    const m = ev.message;
    const cid = m?.peerId?.channelId;
    if (!cid) return;
    if (!tg.channel) {
      console.log(`[setup] channel id: -100${cid}`); // aid for bot-mode linking
      return;
    }
    if (cid.toString() !== tg.channel.id.toString()) return;
    const doc = m.media?.document;
    if (!doc) return; // photos/stickers ignored — send as "File" to index
    if ((m.message || "").startsWith("tm1;")) return; // our own upload part

    const fnAttr = doc.attributes?.find(
      (a) => a.className === "DocumentAttributeFilename"
    );
    const name = fnAttr?.fileName || `telegram_${m.id}`;
    const size = Number(doc.size?.toString?.() ?? doc.size);
    const inbox = ensureInboxFolder();
    const node = createFileNode({
      parentId: inbox.id,
      name,
      size,
      mime: doc.mimeType || null,
      parts: [{ msg_id: m.id, size }],
    });
    console.log(`[indexer] +${node.name} (${size} B) from channel post ${m.id}`);
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
  const msg = await tg.client.sendFile(peer, {
    file: filePath,
    caption,
    forceDocument: true,
    attributes: [new Api.DocumentAttributeFilename({ fileName })],
  });
  return msg.id;
}

export async function getMessage(msgId, peer = tg.channel) {
  assertReady();
  const [m] = await tg.client.getMessages(peer, { ids: [msgId] });
  if (!m || !m.media) throw err(`message ${msgId} missing in channel (deleted?)`, 502);
  return m;
}

export async function deleteMessages(ids, peer = tg.channel) {
  if (!tg.ready || !ids.length) return;
  for (let i = 0; i < ids.length; i += 100) {
    try {
      await tg.client.deleteMessages(peer, ids.slice(i, i + 100), {
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
