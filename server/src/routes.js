import { Router } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { once } from "node:events";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const archiver = require("archiver");
import bcrypt from "bcryptjs";
import bigInt from "big-integer";
import jwt from "jsonwebtoken";
import { cfg } from "./config.js";
import {
  db, now, uid, getNode, breadcrumb, children, subtreeIds,
  isAncestor, uniqueName, createFileNode, createFolderNode,
  trashNode, restoreNode, updateNode, getDelta, getSnapshot,
  getFileVersions, getTrash, findVerifiedBlob, registerDevice,
  updateDeviceCursor, getDevices, revokeDevice, createSSETicket,
  verifyAndConsumeSSETicket, createShare, getShare,
  createDropLink, getDropLinkById, getDropLinkByCode, getDropLinksByFolder,
  updateDropLink, deleteDropLink, incrementDropLinkUploadCount,
  User, Node, Chunk, Upload, UploadPart, Blob, FileVersion,
  SyncJournal, Device, SseTicket, Share, DropLink, TgEntity, Setting,
} from "./db.js";
import { sign, auth } from "./auth.js";
import { addSSEClient, emitSyncChange } from "./sync.js";
import {
  tg, sendDocument, deleteMessages, streamRange, connectByLink, listDialogs, syncChannelHistory, resolvePeer,
} from "./telegram.js";
import {
  getKeepAliveStatus, triggerPing, updateKeepAliveConfig,
} from "./keepalive.js";

export const api = Router();
const bad = (res, code, error) => res.status(code).json({ error });

async function getUserPeer(userId) {
  if (!userId) {
    if (tg.channel) return tg.channel;
    throw new Error("No Telegram channel connected");
  }
  const u = await User.findOne({ id: userId }, { channel_id: 1 }).lean();
  if (!u || !u.channel_id) {
    if (tg.channel) return tg.channel;
    throw new Error("No Telegram channel connected");
  }
  let cid = String(u.channel_id).trim();
  const cMatch = cid.match(/(?:t\.me\/|telegram\.me\/)c\/(\d+)/i);
  if (cMatch) {
    cid = `-100${cMatch[1]}`;
  }
  if (!cid.startsWith("@") && !cid.startsWith("-100") && /^\d+$/.test(cid)) {
    cid = `-100${cid}`;
  }
  if (/^-?\d+$/.test(cid)) return bigInt(cid);
  return cid;
}

/* ---------------------------------------------------------------- status */

api.get("/ping", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "TeleMoon",
    time: Date.now(),
    uptime: Math.floor(process.uptime()),
  });
});

api.get("/keep-alive", (_req, res) => {
  res.json({ keepAlive: getKeepAliveStatus() });
});

api.post("/keep-alive", auth, async (req, res) => {
  const { action, url, enabled, intervalMin } = req.body || {};
  if (action === "ping") {
    const result = await triggerPing();
    return res.json({ result, keepAlive: getKeepAliveStatus() });
  }
  const updated = updateKeepAliveConfig({ url, enabled, intervalMin });
  res.json({ keepAlive: updated });
});

api.get("/status", async (_req, res) => {
  const userCount = await User.countDocuments();
  res.json({
    telegram: tg.ready ? "connected" : "offline",
    mode: tg.mode,
    channel: tg.channel?.title || null,
    error: tg.error,
    chunkBytes: cfg.chunkBytes,
    users: userCount,
    keepAlive: getKeepAliveStatus(),
  });
});

api.get("/public-status", async (_req, res) => {
  const userCount = await User.countDocuments();
  res.json({
    users: userCount,
    botUsername: tg.botUsername || cfg.botUsername || "Telemoon2bot",
    telegram: tg.ready ? "connected" : "offline",
    channel: tg.channel?.title || null,
  });
});

/* ------------------------------------------------------------------ auth */

api.post("/auth/login", async (req, res) => {
  const { password } = req.body || {};
  const handle = String(req.body?.handle || "").trim().replace(/^@/, "").toLowerCase();
  if (!handle) return bad(res, 400, "Handle is required");
  if (!password) return bad(res, 400, "Password is required");

  const user = await User.findOne({ handle }).lean();
  if (!user) {
    return bad(res, 404, `No account found for @${handle}. Please sign up.`);
  }

  const valid = await bcrypt.compare(password, user.pass_hash);
  if (!valid) {
    return bad(res, 401, `Incorrect password for @${handle}`);
  }

  return res.json({
    token: sign(user),
    user: {
      id: user.id,
      handle: user.handle,
      channel_id: user.channel_id || null,
      telegram_id: user.telegram_id || null,
      created_at: user.created_at,
    },
  });
});

api.post("/auth/signup", async (req, res) => {
  const { password, telegramId } = req.body || {};
  const handle = String(req.body?.handle || "").trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(handle)) {
    return bad(res, 400, "Handle must be 3–32 letters, numbers, or underscores");
  }
  if (!password || password.length < 6) {
    return bad(res, 400, "Password must be at least 6 characters");
  }

  const existing = await User.findOne({ handle }, { id: 1 }).lean();
  if (existing) {
    return bad(res, 409, `Handle @${handle} is already taken. Please choose another or log in.`);
  }

  const tgId = telegramId ? String(telegramId).trim().replace(/^@/, "") : null;
  const u = {
    id: uid(),
    handle,
    pass_hash: await bcrypt.hash(password, 10),
    created_at: now(),
    telegram_id: tgId || null,
  };
  await new User(u).save();

  return res.status(201).json({
    token: sign(u),
    user: {
      id: u.id,
      handle: u.handle,
      channel_id: null,
      telegram_id: u.telegram_id,
      created_at: u.created_at,
    },
    created: true,
  });
});

api.post("/auth/enter", async (req, res) => {
  const { password } = req.body || {};
  const handle = String(req.body?.handle || "").trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(handle))
    return bad(res, 400, "handle: 3–32 letters, digits or _");
  if (!password || password.length < 6)
    return bad(res, 400, "password: at least 6 characters");

  const user = await User.findOne({ handle }).lean();
  if (user) {
    if (!(await bcrypt.compare(password, user.pass_hash)))
      return bad(res, 401, `wrong password for @${handle}`);
    return res.json({
      token: sign(user),
      user: {
        id: user.id,
        handle,
        channel_id: user.channel_id || null,
        telegram_id: user.telegram_id || null,
        created_at: user.created_at,
      },
    });
  }

  const u = {
    id: uid(),
    handle,
    pass_hash: await bcrypt.hash(password, 10),
    created_at: now(),
    telegram_id: req.body?.telegramId || null,
  };
  await new User(u).save();
  res.status(201).json({
    token: sign(u),
    user: {
      id: u.id,
      handle,
      channel_id: null,
      telegram_id: u.telegram_id,
      created_at: u.created_at,
    },
    created: true,
  });
});

api.get("/auth/me", auth, async (req, res) => {
  const user = await User.findOne({ id: req.user.id }, { id: 1, handle: 1, channel_id: 1, telegram_id: 1, created_at: 1 }).lean();
  if (!user) return bad(res, 404, "User not found");
  res.json({ user });
});

api.post("/auth/logout", (_req, res) => {
  res.json({ ok: true, message: "Logged out successfully" });
});

/* ------------------------------------------------------- storage linking */

api.get("/tg/dialogs", auth, async (_req, res) => {
  try {
    res.json({ dialogs: await listDialogs(), mode: tg.mode });
  } catch (e) {
    const code = e.status || (/offline/i.test(e.message) ? 503 : 400);
    bad(res, code, e.errorMessage || e.message);
  }
});

api.post("/user/channel", auth, async (req, res) => {
  try {
    let { channel_id } = req.body;
    if (!channel_id) return bad(res, 400, "channel_id required");
    channel_id = String(channel_id).trim();

    // Check if it's a t.me/c/ link: https://t.me/c/3836770302/35
    const cMatch = channel_id.match(/(?:t\.me\/|telegram\.me\/)c\/(\d+)/i);
    let extractedId = cMatch ? `-100${cMatch[1]}` : null;

    let channel = null;
    if (channel_id.includes("t.me") || channel_id.includes("telegram.me") || channel_id.startsWith("@")) {
      try {
        channel = await connectByLink(channel_id);
      } catch (linkErr) {
        if (!extractedId) throw linkErr;
      }
    }

    if (channel?.id) {
      let cid = String(channel.id).trim();
      if (!cid.startsWith("@") && !cid.startsWith("-100") && /^\d+$/.test(cid)) {
        cid = `-100${cid}`;
      }
      await User.updateOne({ id: req.user.id }, { $set: { channel_id: cid } });
      return res.json({ ok: true, channel_id: cid, title: channel.title });
    }

    if (extractedId) channel_id = extractedId;
    if (/^\d{10,}$/.test(channel_id)) channel_id = `-100${channel_id}`;
    else if (/^\d{5,9}$/.test(channel_id)) channel_id = `-${channel_id}`;

    await User.updateOne({ id: req.user.id }, { $set: { channel_id } });
    res.json({ ok: true, channel_id, title: `Group (${channel_id})` });
  } catch (e) {
    const code = e.status || (/offline/i.test(e.message) ? 503 : 400);
    bad(res, code, e.errorMessage || e.message);
  }
});

api.post("/tg/connect", auth, async (req, res) => {
  try {
    const rawLink = String(req.body?.link || "").trim();
    if (!rawLink) return bad(res, 400, "link required");
    let channel;
    try {
      channel = await connectByLink(rawLink);
    } catch (connErr) {
      const cMatch = rawLink.match(/(?:t\.me\/|telegram\.me\/)c\/(\d+)/i);
      if (cMatch) {
        channel = { id: `-100${cMatch[1]}`, title: `Group (-100${cMatch[1]})` };
        await setSetting("channel", channel.id);
      } else {
        throw connErr;
      }
    }
    if (channel?.id) {
      let cid = String(channel.id).trim();
      if (!cid.startsWith("@") && !cid.startsWith("-100") && /^\d+$/.test(cid)) {
        cid = `-100${cid}`;
      }
      await User.updateOne({ id: req.user.id }, { $set: { channel_id: cid } });
    }
    res.json(channel);
  } catch (e) {
    const code = e.status || (/offline/i.test(e.message) ? 503 : 400);
    bad(res, code, e.errorMessage || e.message);
  }
});

api.post("/tg/sync", auth, async (req, res) => {
  try {
    const channelRef = req.body?.channelId || req.body?.channel || req.body?.peerRef;
    let peer = channelRef;
    if (!peer) {
      try { peer = await getUserPeer(req.user.id); } catch (e) {}
    }
    const limit = req.body?.limit ? Number(req.body.limit) : 1000;
    const result = await syncChannelHistory({
      peerRef: peer,
      ownerId: req.user.id,
      limit,
    });
    emitSyncChange(req.user.id, 0);
    res.json({ ok: true, ...result });
  } catch (e) {
    const code = e.status || (/offline/i.test(e.message) ? 503 : 400);
    bad(res, code, e.errorMessage || e.message);
  }
});

/* ----------------------------------------------------- sync & delta feed */

api.get("/sync/delta", auth, async (req, res) => {
  const cursor = Number(req.query.cursor) || 0;
  const limit = Number(req.query.limit) || 500;
  const result = await getDelta({ userId: req.user.id, cursor, limit });

  // Update device tracking if header is present
  const deviceId = req.headers["x-device-id"];
  if (deviceId && result.cursor) {
    await updateDeviceCursor(deviceId, result.cursor);
  }

  res.json(result);
});

api.get("/sync/snapshot", auth, async (req, res) => {
  const afterNodeId = req.query.after || null;
  const limit = Number(req.query.limit) || 500;
  const result = await getSnapshot({ userId: req.user.id, afterNodeId, limit });
  res.json(result);
});

api.post("/sync/events/ticket", auth, async (req, res) => {
  const ticket = await createSSETicket(req.user.id);
  res.json({ ticket });
});

api.get("/sync/events", async (req, res) => {
  let userId = null;

  // Ticket auth for browsers
  if (req.query.ticket) {
    userId = await verifyAndConsumeSSETicket(req.query.ticket);
  }

  // Header or query JWT auth for native clients
  if (!userId) {
    const raw = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query.t;
    if (raw) {
      try {
        const decoded = jwt.verify(raw, cfg.jwtSecret);
        userId = decoded.id;
      } catch (_) {}
    }
  }

  if (!userId) {
    return res.status(401).send("Unauthorized");
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  addSSEClient(userId, res);

  // Send initial connected hint
  res.write(`: connected\n\n`);
});

/* --------------------------------------------------------------- devices */

api.post("/devices", auth, async (req, res) => {
  const { id, name, platform, appVersion } = req.body || {};
  const dev = await registerDevice({
    id,
    userId: req.user.id,
    name,
    platform,
    appVersion,
  });
  res.json({ device: dev });
});

api.get("/devices", auth, async (req, res) => {
  res.json({ devices: await getDevices(req.user.id) });
});

api.delete("/devices/:id", auth, async (req, res) => {
  res.json(await revokeDevice(req.params.id, req.user.id));
});

/* ---------------------------------------------------- virtual filesystem */

api.get("/nodes/:id/children", auth, async (req, res) => {
  const folder = await getNode(req.params.id);
  if (!folder || folder.type !== "folder" || folder.deleted_at)
    return bad(res, 404, "folder not found");
  res.json({ folder, breadcrumb: await breadcrumb(folder.id), children: await children(folder.id, req.user.id) });
});

api.post("/folders", auth, async (req, res) => {
  const { parentId, name } = req.body || {};
  const parent = await getNode(parentId);
  if (!parent || parent.type !== "folder" || parent.deleted_at)
    return bad(res, 404, "parent not found");
  const clean = String(name || "").trim().replace(/[/\\]/g, "-");
  if (!clean) return bad(res, 400, "name required");

  const deviceId = req.headers["x-device-id"] || req.body?.deviceId || null;
  const { node, cursor } = await createFolderNode({
    parentId,
    name: clean,
    ownerId: req.user.id,
    deviceId,
  });

  emitSyncChange(req.user.id, cursor);
  res.json(node);
});

api.patch("/nodes/:id", auth, async (req, res) => {
  const { name, parentId } = req.body || {};
  const ifMatch = req.headers["if-match"] ? Number(req.headers["if-match"]) : null;
  const deviceId = req.headers["x-device-id"] || req.body?.deviceId || null;

  try {
    const { node, cursor } = await updateNode({
      id: req.params.id,
      name,
      parentId,
      ownerId: req.user.id,
      deviceId,
      ifMatchVersion: ifMatch,
    });
    emitSyncChange(req.user.id, cursor);
    res.json(node);
  } catch (e) {
    if (e.code === "VERSION_CONFLICT") {
      return res.status(409).json({ error: { code: e.code, message: e.message, current: e.current } });
    }
    bad(res, e.status || 500, e.message);
  }
});

// Soft delete to Trash
api.delete("/nodes/:id", auth, async (req, res) => {
  const ifMatch = req.headers["if-match"] ? Number(req.headers["if-match"]) : null;
  const deviceId = req.headers["x-device-id"] || null;

  try {
    const { trashed, cursor } = await trashNode(req.params.id, req.user.id, deviceId, ifMatch);
    emitSyncChange(req.user.id, cursor);
    res.json({ ok: true, trashed, cursor });
  } catch (e) {
    if (e.code === "VERSION_CONFLICT") {
      return res.status(409).json({ error: { code: e.code, message: e.message, current: e.current } });
    }
    bad(res, e.status || 500, e.message);
  }
});

// Restore from Trash
api.post("/nodes/:id/restore", auth, async (req, res) => {
  const deviceId = req.headers["x-device-id"] || req.body?.deviceId || null;
  try {
    const { node, cursor } = await restoreNode(req.params.id, req.user.id, deviceId);
    emitSyncChange(req.user.id, cursor);
    res.json(node);
  } catch (e) {
    bad(res, e.status || 500, e.message);
  }
});

// Trash view
api.get("/trash", auth, async (req, res) => {
  res.json({ trash: await getTrash(req.user.id) });
});

// Version history
api.get("/nodes/:id/versions", auth, async (req, res) => {
  res.json({ versions: await getFileVersions(req.params.id) });
});

api.get("/search", auth, async (req, res) => {
  const term = String(req.query.q || "").trim();
  if (!term) return res.json({ results: [] });
  const results = await Node.find({
    name: { $regex: term, $options: "i" },
    id: { $ne: "root" },
    deleted_at: null,
    $or: [{ owner_id: req.user.id }, { owner_id: null }],
  })
    .select("id parent_id name type size mime hash version updated_at")
    .sort({ type: -1, name: 1 })
    .limit(100)
    .lean();
  res.json({ results });
});

api.post("/nodes/:id/share", auth, async (req, res) => {
  const node = await getNode(req.params.id);
  if (!node || node.type !== "file" || node.deleted_at) return bad(res, 404, "file not found");
  const shareId = await createShare(node.id);
  res.json({ shareId });
});

/* ---------------------------------------------------- drop / upload links */

function signDropTicket(dropLink) {
  return jwt.sign(
    {
      type: "drop",
      dropLinkId: dropLink.id,
      code: dropLink.code,
      ownerId: dropLink.owner_id,
      folderId: dropLink.folder_id,
    },
    cfg.jwtSecret,
    { expiresIn: "4h" }
  );
}

async function verifyDropTicket(req, res, next) {
  const raw =
    req.headers["x-drop-ticket"] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
    req.body?.ticket ||
    req.query.ticket;

  if (!raw) return res.status(401).json({ error: "Missing upload ticket" });

  try {
    const decoded = jwt.verify(raw, cfg.jwtSecret);
    if (decoded.type !== "drop") {
      return res.status(401).json({ error: "Invalid ticket type" });
    }
    const dropLink = await getDropLinkById(decoded.dropLinkId);
    if (!dropLink || !dropLink.is_active) {
      return res.status(403).json({ error: "This upload link is inactive or has been revoked" });
    }
    const targetFolder = await getNode(dropLink.folder_id);
    if (!targetFolder || targetFolder.deleted_at) {
      return res.status(404).json({ error: "Destination folder no longer exists" });
    }

    req.dropLink = dropLink;
    req.dropTargetFolder = targetFolder;
    next();
  } catch (_) {
    return res.status(401).json({ error: "Upload session expired. Please re-enter the code or password." });
  }
}

// List drop links for a folder
api.get("/folders/:id/drop-links", auth, async (req, res) => {
  const folder = await getNode(req.params.id);
  if (!folder || folder.type !== "folder" || folder.deleted_at) {
    return bad(res, 404, "Folder not found");
  }
  const links = await getDropLinksByFolder(folder.id, req.user.id);
  res.json({ dropLinks: links });
});

// Create a drop link for a folder
api.post("/folders/:id/drop-links", auth, async (req, res) => {
  const { code, password, title } = req.body || {};
  try {
    const link = await createDropLink({
      folderId: req.params.id,
      ownerId: req.user.id,
      code,
      password,
      title,
    });
    res.json({ dropLink: link });
  } catch (e) {
    bad(res, 400, e.message);
  }
});

// Update a drop link
api.patch("/drop-links/:id", auth, async (req, res) => {
  const { code, password, is_active, title } = req.body || {};
  try {
    const updated = await updateDropLink(req.params.id, req.user.id, {
      code,
      password,
      is_active,
      title,
    });
    res.json({ dropLink: updated });
  } catch (e) {
    bad(res, 400, e.message);
  }
});

// Delete a drop link
api.delete("/drop-links/:id", auth, async (req, res) => {
  try {
    const result = await deleteDropLink(req.params.id, req.user.id);
    res.json(result);
  } catch (e) {
    bad(res, 400, e.message);
  }
});

// Public info for a drop link / 4-digit code
api.get("/drop/:code", async (req, res) => {
  const link = await getDropLinkByCode(req.params.code);
  if (!link || !link.is_active) {
    return bad(res, 404, "Upload link not found or inactive");
  }
  const folder = await getNode(link.folder_id);
  if (!folder || folder.deleted_at) {
    return bad(res, 404, "Destination folder no longer exists");
  }

  const hasPassword = Boolean(link.password_hash);
  res.json({
    valid: true,
    id: link.id,
    code: link.code,
    title: link.title || null,
    ownerHandle: link.owner_handle || "user",
    folderName: folder.name,
    hasPassword,
    uploadCount: link.upload_count,
    ticket: hasPassword ? null : signDropTicket(link),
  });
});

// Verify password/PIN for a drop link
api.post("/drop/:code/verify", async (req, res) => {
  const link = await getDropLinkByCode(req.params.code);
  if (!link || !link.is_active) {
    return bad(res, 404, "Upload link not found or inactive");
  }

  const { password } = req.body || {};
  if (!link.password_hash) {
    return res.json({ ok: true, ticket: signDropTicket(link) });
  }

  if (!password || !bcrypt.compareSync(String(password), link.password_hash)) {
    return bad(res, 401, "Incorrect password or PIN");
  }

  res.json({ ok: true, ticket: signDropTicket(link) });
});

// Public drop chunked upload initialization
api.post("/drop/:code/uploads", verifyDropTicket, async (req, res) => {
  const { name, size, mime, hash, clientModifiedAt } = req.body || {};
  if (!name || !(Number.isFinite(size) && size >= 0)) {
    return bad(res, 400, "name and size required");
  }

  const dropLink = req.dropLink;

  // Deduplication check
  if (hash && size > 0) {
    const verifiedBlob = await findVerifiedBlob(dropLink.owner_id, hash, size);
    if (verifiedBlob) {
      try {
        const { node, cursor } = await createFileNode({
          parentId: dropLink.folder_id,
          name,
          size,
          mime,
          ownerId: dropLink.owner_id,
          hash,
          clientModifiedAt,
          blobId: verifiedBlob.id,
        });

        await incrementDropLinkUploadCount(dropLink.id);
        emitSyncChange(dropLink.owner_id, cursor);
        return res.json({ dedup: true, node, cursor });
      } catch (e) {
        return bad(res, 500, e.message);
      }
    }
  }

  const id = uid();
  await new Upload({
    id,
    name: String(name),
    parent_id: dropLink.folder_id,
    size,
    mime: mime || null,
    chunk_size: cfg.chunkBytes,
    user_id: dropLink.owner_id,
    hash: hash || null,
    client_modified_at: clientModifiedAt ? Number(clientModifiedAt) : null,
    created_at: now(),
  }).save();

  res.json({ id, chunkSize: cfg.chunkBytes, dedup: false });
});

// Public drop upload part streaming
api.put("/drop/:code/uploads/:id/parts/:idx", verifyDropTicket, async (req, res) => {
  const up = await Upload.findOne({ id: req.params.id }).lean();
  if (!up || up.user_id !== req.dropLink.owner_id || up.parent_id !== req.dropLink.folder_id) {
    return bad(res, 404, "upload not found");
  }
  if (!tg.ready) return bad(res, 503, tg.error || "Telegram storage offline");

  const idx = Number(req.params.idx);
  const totalParts = Math.max(1, Math.ceil(up.size / up.chunk_size));
  if (!(idx >= 0 && idx < totalParts)) return bad(res, 400, "part index out of range");

  const tmp = path.join(cfg.dataDir, "tmp", `${up.id}.${idx}`);
  try {
    let received = 0;
    const hasher = crypto.createHash("sha256");

    req.on("data", (d) => {
      received += d.length;
      hasher.update(d);
    });

    await pipeline(req, fs.createWriteStream(tmp));
    if (received === 0 && up.size > 0) return bad(res, 400, "empty part");

    const computedPartHash = hasher.digest("hex");
    const expectedPartHash = req.headers["x-part-sha256"] || req.headers["x-part-hash"];

    if (expectedPartHash && expectedPartHash.toLowerCase() !== computedPartHash.toLowerCase()) {
      await fsp.rm(tmp, { force: true });
      return res.status(422).json({
        error: { code: "HASH_MISMATCH", message: "Part SHA-256 mismatch", computed: computedPartHash },
      });
    }

    let peer;
    try { peer = await getUserPeer(up.user_id); } catch (e) {}

    const partName =
      totalParts > 1
        ? `${up.name}.part${String(idx + 1).padStart(3, "0")}`
        : up.name;
    const caption =
      totalParts > 1
        ? `tm1;f=${up.name.slice(0, 200)};p=${idx + 1}/${totalParts};drop=${req.dropLink.code}\n📁 ${up.name} (Part ${idx + 1}/${totalParts})`
        : `tm1;f=${up.name.slice(0, 200)};p=1/1;drop=${req.dropLink.code}\n📁 ${up.name}`;
    const msgId = await sendDocument(tmp, partName, caption, peer);

    const prev = await UploadPart.findOne({ upload_id: up.id, idx }, { msg_id: 1 }).lean();
    if (prev) deleteMessages([prev.msg_id], peer);

    await UploadPart.findOneAndUpdate(
      { upload_id: up.id, idx },
      { $set: { upload_id: up.id, idx, msg_id: msgId, size: received, part_hash: computedPartHash } },
      { upsert: true }
    );

    res.json({ msgId, size: received, partHash: computedPartHash });
  } catch (e) {
    console.error("[drop upload part]", e);
    bad(res, e.status || 500, e.message);
  } finally {
    fsp.rm(tmp, { force: true }).catch(() => {});
  }
});

// Public drop upload completion
api.post("/drop/:code/uploads/:id/complete", verifyDropTicket, async (req, res) => {
  const up = await Upload.findOne({ id: req.params.id }).lean();
  if (!up || up.user_id !== req.dropLink.owner_id || up.parent_id !== req.dropLink.folder_id) {
    return bad(res, 404, "upload not found");
  }

  const parts = await UploadPart.find({ upload_id: up.id }).sort({ idx: 1 }).lean();
  const expected = up.size === 0 ? 0 : Math.ceil(up.size / up.chunk_size);
  const total = parts.reduce((s, p) => s + p.size, 0);

  if (parts.length !== expected || total !== up.size) {
    return bad(res, 400, `incomplete upload: ${parts.length}/${expected} parts, ${total}/${up.size} bytes`);
  }

  try {
    const { node, cursor } = await createFileNode({
      parentId: up.parent_id,
      name: up.name,
      size: up.size,
      mime: up.mime,
      ownerId: up.user_id,
      parts,
      hash: up.hash,
      clientModifiedAt: up.client_modified_at,
    });

    await UploadPart.deleteMany({ upload_id: up.id });
    await Upload.findOneAndDelete({ id: up.id });

    await incrementDropLinkUploadCount(req.dropLink.id);
    emitSyncChange(up.user_id, cursor);
    res.json({ ok: true, node });
  } catch (e) {
    bad(res, 500, e.message);
  }
});

// Public drop abort upload
api.delete("/drop/:code/uploads/:id", verifyDropTicket, async (req, res) => {
  const up = await Upload.findOne({ id: req.params.id }).lean();
  if (!up || up.user_id !== req.dropLink.owner_id) return bad(res, 404, "upload not found");
  const msgIds = (await UploadPart.find({ upload_id: up.id }, { msg_id: 1 }).lean()).map((r) => r.msg_id);
  await UploadPart.deleteMany({ upload_id: up.id });
  await Upload.findOneAndDelete({ id: up.id });
  let peer;
  try { peer = await getUserPeer(up.user_id); } catch (e) {}
  deleteMessages(msgIds, peer);
  res.json({ ok: true });
});

api.get("/folders/tree", auth, async (req, res) => {
  const folders = await Node.find({
    type: "folder",
    deleted_at: null,
    $or: [{ owner_id: req.user.id }, { owner_id: null }],
  })
    .select("id parent_id name")
    .sort({ name: 1 })
    .lean();
  res.json({ folders });
});

api.post("/nodes/move", auth, async (req, res) => {
  const { ids, targetParentId } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return bad(res, 400, "ids array required");
  const target = await getNode(targetParentId);
  if (!target || target.type !== "folder" || target.deleted_at)
    return bad(res, 404, "target folder not found");

  let moved = 0;
  let lastCursor = 0;
  const deviceId = req.headers["x-device-id"] || null;

  for (const id of ids) {
    try {
      const { cursor } = await updateNode({
        id,
        parentId: target.id,
        ownerId: req.user.id,
        deviceId,
      });
      moved++;
      lastCursor = cursor;
    } catch (_) {}
  }

  if (moved > 0 && lastCursor) {
    emitSyncChange(req.user.id, lastCursor);
  }
  res.json({ ok: true, moved });
});

/* -------------------------------------------------------- chunked uploads */

api.post("/uploads", auth, async (req, res) => {
  const {
    name, size, mime, parentId, hash, clientModifiedAt,
    deviceId, replaceNodeId, baseVersion, onNameConflict,
  } = req.body || {};

  const parent = await getNode(parentId);
  if (!parent || parent.type !== "folder" || parent.deleted_at)
    return bad(res, 404, "parent not found");
  if (!name || !(Number.isFinite(size) && size >= 0))
    return bad(res, 400, "name and size required");

  // Check version conflict early if replacing a node
  if (replaceNodeId && baseVersion !== undefined && baseVersion !== null) {
    const existing = await getNode(replaceNodeId);
    if (!existing) return bad(res, 404, "target file to replace not found");
    if (existing.version !== Number(baseVersion)) {
      return res.status(409).json({
        error: {
          code: "VERSION_CONFLICT",
          message: "Node changed since baseVersion",
          current: { version: existing.version, hash: existing.hash },
        },
      });
    }
  }

  // Instant Deduplication check (per-user, verified blob match)
  if (hash && size > 0) {
    const verifiedBlob = await findVerifiedBlob(req.user.id, hash, size);
    if (verifiedBlob) {
      try {
        const { node, cursor } = await createFileNode({
          parentId,
          name,
          size,
          mime,
          ownerId: req.user.id,
          hash,
          clientModifiedAt,
          deviceId: deviceId || req.headers["x-device-id"] || null,
          replaceNodeId,
          baseVersion,
          blobId: verifiedBlob.id,
        });

        emitSyncChange(req.user.id, cursor);
        return res.json({ dedup: true, node, cursor });
      } catch (e) {
        if (e.code === "VERSION_CONFLICT") {
          return res.status(409).json({ error: { code: e.code, message: e.message, current: e.current } });
        }
        return bad(res, 500, e.message);
      }
    }
  }

  const id = uid();
  await new Upload({
    id,
    name: String(name),
    parent_id: parentId,
    size,
    mime: mime || null,
    chunk_size: cfg.chunkBytes,
    user_id: req.user.id,
    hash: hash || null,
    base_version: baseVersion !== undefined ? Number(baseVersion) : null,
    replace_node_id: replaceNodeId || null,
    on_name_conflict: onNameConflict || "rename",
    client_modified_at: clientModifiedAt ? Number(clientModifiedAt) : null,
    device_id: deviceId || req.headers["x-device-id"] || null,
    created_at: now(),
  }).save();

  res.json({ id, chunkSize: cfg.chunkBytes, dedup: false });
});

api.put("/uploads/:id/parts/:idx", auth, async (req, res) => {
  const up = await Upload.findOne({ id: req.params.id }).lean();
  if (!up) return bad(res, 404, "upload not found");
  if (!tg.ready) return bad(res, 503, tg.error || "Telegram storage offline");
  const idx = Number(req.params.idx);
  const totalParts = Math.max(1, Math.ceil(up.size / up.chunk_size));
  if (!(idx >= 0 && idx < totalParts)) return bad(res, 400, "part index out of range");

  const tmp = path.join(cfg.dataDir, "tmp", `${up.id}.${idx}`);
  try {
    let received = 0;
    const hasher = crypto.createHash("sha256");

    req.on("data", (d) => {
      received += d.length;
      hasher.update(d);
    });

    await pipeline(req, fs.createWriteStream(tmp));
    if (received === 0 && up.size > 0) return bad(res, 400, "empty part");

    const computedPartHash = hasher.digest("hex");
    const expectedPartHash = req.headers["x-part-sha256"] || req.headers["x-part-hash"];

    if (expectedPartHash && expectedPartHash.toLowerCase() !== computedPartHash.toLowerCase()) {
      await fsp.rm(tmp, { force: true });
      return res.status(422).json({
        error: { code: "HASH_MISMATCH", message: "Part SHA-256 mismatch", computed: computedPartHash },
      });
    }

    let peer;
    try { peer = await getUserPeer(up.user_id); } catch(e) {}

    const partName =
      totalParts > 1
        ? `${up.name}.part${String(idx + 1).padStart(3, "0")}`
        : up.name;
    const caption =
      totalParts > 1
        ? `tm1;f=${up.name.slice(0, 200)};p=${idx + 1}/${totalParts}\n📁 ${up.name} (Part ${idx + 1}/${totalParts})`
        : `tm1;f=${up.name.slice(0, 200)};p=1/1\n📁 ${up.name}`;
    const msgId = await sendDocument(tmp, partName, caption, peer);

    // Retried part? Drop the superseded Telegram message.
    const prev = await UploadPart.findOne({ upload_id: up.id, idx }, { msg_id: 1 }).lean();
    if (prev) deleteMessages([prev.msg_id], peer);

    await UploadPart.findOneAndUpdate(
      { upload_id: up.id, idx },
      { $set: { upload_id: up.id, idx, msg_id: msgId, size: received, part_hash: computedPartHash } },
      { upsert: true }
    );

    res.json({ msgId, size: received, partHash: computedPartHash });
  } catch (e) {
    console.error("[upload part]", e);
    bad(res, e.status || 500, e.message);
  } finally {
    fsp.rm(tmp, { force: true }).catch(() => {});
  }
});

api.get("/uploads/:id", auth, async (req, res) => {
  const up = await Upload.findOne({ id: req.params.id }).lean();
  if (!up) return bad(res, 404, "upload not found");
  const parts = await UploadPart.find({ upload_id: up.id })
    .select("idx msg_id size part_hash")
    .sort({ idx: 1 })
    .lean();
  res.json({
    uploadId: up.id,
    size: up.size,
    chunkSize: up.chunk_size,
    parts,
    expectedParts: Math.max(1, Math.ceil(up.size / up.chunk_size)),
  });
});

api.post("/uploads/:id/complete", auth, async (req, res) => {
  const up = await Upload.findOne({ id: req.params.id }).lean();
  if (!up) return bad(res, 404, "upload not found");
  const parts = await UploadPart.find({ upload_id: up.id }).sort({ idx: 1 }).lean();
  const expected = up.size === 0 ? 0 : Math.ceil(up.size / up.chunk_size);
  const total = parts.reduce((s, p) => s + p.size, 0);

  if (parts.length !== expected || total !== up.size)
    return bad(res, 400, `incomplete upload: ${parts.length}/${expected} parts, ${total}/${up.size} bytes`);

  try {
    const { node, cursor } = await createFileNode({
      parentId: up.parent_id,
      name: up.name,
      size: up.size,
      mime: up.mime,
      ownerId: up.user_id,
      parts,
      hash: up.hash,
      clientModifiedAt: up.client_modified_at,
      deviceId: up.device_id,
      replaceNodeId: up.replace_node_id,
      baseVersion: up.base_version,
    });

    await UploadPart.deleteMany({ upload_id: up.id });
    await Upload.findOneAndDelete({ id: up.id });

    emitSyncChange(up.user_id, cursor);
    res.json(node);
  } catch (e) {
    if (e.code === "VERSION_CONFLICT") {
      return res.status(409).json({ error: { code: e.code, message: e.message, current: e.current } });
    }
    bad(res, 500, e.message);
  }
});

api.delete("/uploads/:id", auth, async (req, res) => {
  const up = await Upload.findOne({ id: req.params.id }).lean();
  if (!up) return bad(res, 404, "upload not found");
  const msgIds = (await UploadPart.find({ upload_id: up.id }, { msg_id: 1 }).lean()).map((r) => r.msg_id);
  await UploadPart.deleteMany({ upload_id: up.id });
  await Upload.findOneAndDelete({ id: up.id });
  let peer;
  try { peer = await getUserPeer(up.user_id); } catch(e) {}
  deleteMessages(msgIds, peer);
  res.json({ ok: true });
});

/* ------------------------------------------------------- ranged downloads */

async function serveNodeContent(req, res, node) {
  if (!node || node.type !== "file" || node.deleted_at) return bad(res, 404, "file not found");
  if (!tg.ready) return bad(res, 503, tg.error || "Telegram storage not connected");

  let chunks = await Chunk.find({ file_id: node.id }).sort({ idx: 1 }).lean();
  if (chunks.length === 0 && node.blob_id) {
    chunks = await Chunk.find({ blob_id: node.blob_id }).sort({ idx: 1 }).lean();
  }
  const total = node.size;
  if (total > 0 && chunks.length === 0) {
    return bad(res, 502, "File chunks not found");
  }

  let peer = tg.channel;
  if (node.owner_id) {
    try {
      peer = await resolvePeer(await getUserPeer(node.owner_id));
    } catch (_) {
      peer = tg.channel;
    }
  }
  if (!peer) {
    return bad(res, 503, "No Telegram channel connected for this file");
  }

  let start = 0, end = Math.max(total - 1, 0), status = 200;
  const range = req.headers.range;
  if (range && total > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = Number(m[1]); end = m[2] ? Number(m[2]) : total - 1; }
      else { start = Math.max(total - Number(m[2]), 0); end = total - 1; }
      end = Math.min(end, total - 1);
      if (start > end || start >= total)
        return res.status(416).set("Content-Range", `bytes */${total}`).end();
      status = 206;
    }
  }

  const safeAscii = (node.name || "download").replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encodedName = encodeURIComponent(node.name || "download");

  res.status(status).set({
    "Accept-Ranges": "bytes",
    "Content-Type": node.mime || "application/octet-stream",
    "Content-Length": String(total === 0 ? 0 : end - start + 1),
    "Content-Disposition":
      `${req.query.dl === "1" ? "attachment" : "inline"}; ` +
      `filename="${safeAscii}"; filename*=UTF-8''${encodedName}`,
  });
  if (status === 206) res.set("Content-Range", `bytes ${start}-${end}/${total}`);
  if (req.method === "HEAD" || total === 0) return res.end();

  let closed = false;
  res.on("close", () => (closed = true));
  try {
    let pos = 0;
    for (const c of chunks) {
      const cStart = pos, cEnd = pos + c.size - 1;
      pos += c.size;
      if (cEnd < start) continue;
      if (cStart > end) break;
      await streamRange(
        c.msg_id,
        Math.max(start - cStart, 0),
        Math.min(end - cStart, c.size - 1),
        async (buf) => {
          if (closed) return false;
          if (!res.write(buf)) await once(res, "drain");
          return !closed;
        },
        peer
      );
      if (closed) break;
    }
    if (!closed) res.end();
  } catch (e) {
    console.error("[download]", e.message);
    if (!res.writableEnded) {
      res.destroy(e);
    }
  }
}

api.get("/files/:id/content", auth, async (req, res) => {
  serveNodeContent(req, res, await getNode(req.params.id));
});

api.get("/share/:id/content", async (req, res) => {
  const share = await getShare(req.params.id);
  if (!share) return bad(res, 404, "share link not found");
  serveNodeContent(req, res, await getNode(share.file_id));
});

api.get("/folders/:id/download", auth, async (req, res) => {
  const rootFolder = await getNode(req.params.id);
  if (!rootFolder || rootFolder.type !== "folder" || rootFolder.deleted_at)
    return bad(res, 404, "folder not found");
  if (!tg.ready) return bad(res, 503, tg.error || "Telegram storage not connected");

  let peer = tg.channel;
  if (rootFolder.owner_id) {
    try {
      peer = await resolvePeer(await getUserPeer(rootFolder.owner_id));
    } catch (_) {
      peer = tg.channel;
    }
  }
  if (!peer) {
    return bad(res, 503, "No Telegram channel connected for this folder");
  }

  const safeAscii = (rootFolder.name || "folder").replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encodedName = encodeURIComponent(rootFolder.name || "folder");

  res.status(200).set({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${safeAscii}.zip"; filename*=UTF-8''${encodedName}.zip`,
  });

  const archive = new archiver.ZipArchive({ zlib: { level: 1 } });
  archive.on("error", (err) => console.error("[zip error]", err));
  archive.pipe(res);

  let closed = false;
  res.on("close", () => (closed = true));

  async function addFolder(folderId, basePath) {
    if (closed) return;
    const folderChildren = await children(folderId, req.user.id);
    for (const child of folderChildren) {
      if (closed) return;
      const childPath = basePath ? `${basePath}/${child.name}` : child.name;

      if (child.type === "folder") {
        archive.append("", { name: childPath + "/" });
        await addFolder(child.id, childPath);
      } else {
        let fileChunks = await Chunk.find({ file_id: child.id }).sort({ idx: 1 }).lean();
        if (fileChunks.length === 0 && child.blob_id) {
          fileChunks = await Chunk.find({ blob_id: child.blob_id }).sort({ idx: 1 }).lean();
        }
        const { PassThrough } = await import("node:stream");
        const pt = new PassThrough();

        archive.append(pt, { name: childPath });

        let filePeer = peer;
        if (child.owner_id && child.owner_id !== rootFolder.owner_id) {
          try {
            filePeer = await resolvePeer(await getUserPeer(child.owner_id));
          } catch (_) {}
        }

        try {
          for (const c of fileChunks) {
            if (closed) break;
            if (c.size > 0) {
              await streamRange(
                c.msg_id,
                0,
                c.size - 1,
                async (buf) => {
                  if (!pt.write(buf)) await once(pt, "drain");
                  return !closed;
                },
                filePeer
              );
            }
          }
        } catch (e) {
          console.error("[zip stream]", e.message);
        }
        pt.end();
      }
    }
  }

  try {
    await addFolder(rootFolder.id, "");
  } finally {
    archive.finalize();
  }
});
