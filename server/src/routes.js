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
  db, q, now, uid, getNode, breadcrumb, children, subtreeIds,
  isAncestor, uniqueName, createFileNode, createFolderNode,
  trashNode, restoreNode, updateNode, getDelta, getSnapshot,
  getFileVersions, getTrash, findVerifiedBlob, registerDevice,
  updateDeviceCursor, getDevices, revokeDevice, createSSETicket,
  verifyAndConsumeSSETicket, createShare, getShare,
  createDropLink, getDropLinkById, getDropLinkByCode, getDropLinksByFolder,
  updateDropLink, deleteDropLink, incrementDropLinkUploadCount,
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

function getUserPeer(userId) {
  if (!userId) {
    if (tg.channel) return tg.channel;
    throw new Error("No Telegram channel connected");
  }
  const u = q(`SELECT channel_id FROM users WHERE id=?`).get(userId);
  if (!u || !u.channel_id) {
    if (tg.channel) return tg.channel;
    throw new Error("No Telegram channel connected");
  }
  let cid = String(u.channel_id).trim();
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

api.get("/status", (_req, res) => {
  res.json({
    telegram: tg.ready ? "connected" : "offline",
    mode: tg.mode,
    channel: tg.channel?.title || null,
    error: tg.error,
    chunkBytes: cfg.chunkBytes,
    users: q(`SELECT COUNT(*) c FROM users`).get().c,
    keepAlive: getKeepAliveStatus(),
  });
});

api.get("/public-status", (_req, res) => {
  res.json({
    users: q(`SELECT COUNT(*) c FROM users`).get().c,
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

  const user = q(`SELECT * FROM users WHERE handle=?`).get(handle);
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

  const existing = q(`SELECT id FROM users WHERE handle=?`).get(handle);
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
  q(`INSERT INTO users(id,handle,pass_hash,telegram_id,created_at) VALUES (?,?,?,?,?)`)
    .run(u.id, u.handle, u.pass_hash, u.telegram_id, u.created_at);

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

  const user = q(`SELECT * FROM users WHERE handle=?`).get(handle);
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

  const u = { id: uid(), handle, pass_hash: await bcrypt.hash(password, 10), created_at: now(), telegram_id: req.body?.telegramId || null };
  q(`INSERT INTO users(id,handle,pass_hash,telegram_id,created_at) VALUES (?,?,?,?,?)`)
    .run(u.id, u.handle, u.pass_hash, u.telegram_id, u.created_at);
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

api.get("/auth/me", auth, (req, res) => {
  const user = q(`SELECT id, handle, channel_id, telegram_id, created_at FROM users WHERE id=?`).get(req.user.id);
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
    bad(res, e.status || 500, e.errorMessage || e.message);
  }
});

api.post("/user/channel", auth, async (req, res) => {
  let { channel_id } = req.body;
  if (!channel_id) return bad(res, 400, "channel_id required");
  channel_id = String(channel_id).trim();

  if (channel_id.includes("t.me") || channel_id.includes("telegram.me")) {
    return bad(res, 400, "Please paste the channel ID (e.g. -100...) or @username, not an invite link.");
  }

  if (/^\d{10,}$/.test(channel_id)) channel_id = `-100${channel_id}`;

  q(`UPDATE users SET channel_id=? WHERE id=?`).run(channel_id, req.user.id);
  res.json({ ok: true, channel_id });
});

api.post("/tg/connect", auth, async (req, res) => {
  try {
    const channel = await connectByLink(req.body?.link);
    if (channel?.id) {
      let cid = String(channel.id).trim();
      if (!cid.startsWith("@") && !cid.startsWith("-100") && /^\d+$/.test(cid)) {
        cid = `-100${cid}`;
      }
      q(`UPDATE users SET channel_id=? WHERE id=?`).run(cid, req.user.id);
    }
    res.json(channel);
  } catch (e) {
    bad(res, e.status || 500, e.errorMessage || e.message);
  }
});

api.post("/tg/sync", auth, async (req, res) => {
  try {
    const channelRef = req.body?.channelId || req.body?.channel || req.body?.peerRef;
    let peer = channelRef;
    if (!peer) {
      try { peer = getUserPeer(req.user.id); } catch (e) {}
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
    bad(res, e.status || 500, e.message);
  }
});

/* ----------------------------------------------------- sync & delta feed */

api.get("/sync/delta", auth, (req, res) => {
  const cursor = Number(req.query.cursor) || 0;
  const limit = Number(req.query.limit) || 500;
  const result = getDelta({ userId: req.user.id, cursor, limit });

  // Update device tracking if header is present
  const deviceId = req.headers["x-device-id"];
  if (deviceId && result.cursor) {
    updateDeviceCursor(deviceId, result.cursor);
  }

  res.json(result);
});

api.get("/sync/snapshot", auth, (req, res) => {
  const afterNodeId = req.query.after || null;
  const limit = Number(req.query.limit) || 500;
  const result = getSnapshot({ userId: req.user.id, afterNodeId, limit });
  res.json(result);
});

api.post("/sync/events/ticket", auth, (req, res) => {
  const ticket = createSSETicket(req.user.id);
  res.json({ ticket });
});

api.get("/sync/events", (req, res) => {
  let userId = null;

  // Ticket auth for browsers
  if (req.query.ticket) {
    userId = verifyAndConsumeSSETicket(req.query.ticket);
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

api.post("/devices", auth, (req, res) => {
  const { id, name, platform, appVersion } = req.body || {};
  const dev = registerDevice({
    id,
    userId: req.user.id,
    name,
    platform,
    appVersion,
  });
  res.json({ device: dev });
});

api.get("/devices", auth, (req, res) => {
  res.json({ devices: getDevices(req.user.id) });
});

api.delete("/devices/:id", auth, (req, res) => {
  res.json(revokeDevice(req.params.id, req.user.id));
});

/* ---------------------------------------------------- virtual filesystem */

api.get("/nodes/:id/children", auth, (req, res) => {
  const folder = getNode(req.params.id);
  if (!folder || folder.type !== "folder" || folder.deleted_at)
    return bad(res, 404, "folder not found");
  res.json({ folder, breadcrumb: breadcrumb(folder.id), children: children(folder.id, req.user.id) });
});

api.post("/folders", auth, (req, res) => {
  const { parentId, name } = req.body || {};
  const parent = getNode(parentId);
  if (!parent || parent.type !== "folder" || parent.deleted_at)
    return bad(res, 404, "parent not found");
  const clean = String(name || "").trim().replace(/[/\\]/g, "-");
  if (!clean) return bad(res, 400, "name required");

  const deviceId = req.headers["x-device-id"] || req.body?.deviceId || null;
  const { node, cursor } = createFolderNode({
    parentId,
    name: clean,
    ownerId: req.user.id,
    deviceId,
  });

  emitSyncChange(req.user.id, cursor);
  res.json(node);
});

api.patch("/nodes/:id", auth, (req, res) => {
  const { name, parentId } = req.body || {};
  const ifMatch = req.headers["if-match"] ? Number(req.headers["if-match"]) : null;
  const deviceId = req.headers["x-device-id"] || req.body?.deviceId || null;

  try {
    const { node, cursor } = updateNode({
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
api.delete("/nodes/:id", auth, (req, res) => {
  const ifMatch = req.headers["if-match"] ? Number(req.headers["if-match"]) : null;
  const deviceId = req.headers["x-device-id"] || null;

  try {
    const { trashed, cursor } = trashNode(req.params.id, req.user.id, deviceId, ifMatch);
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
api.post("/nodes/:id/restore", auth, (req, res) => {
  const deviceId = req.headers["x-device-id"] || req.body?.deviceId || null;
  try {
    const { node, cursor } = restoreNode(req.params.id, req.user.id, deviceId);
    emitSyncChange(req.user.id, cursor);
    res.json(node);
  } catch (e) {
    bad(res, e.status || 500, e.message);
  }
});

// Trash view
api.get("/trash", auth, (req, res) => {
  res.json({ trash: getTrash(req.user.id) });
});

// Version history
api.get("/nodes/:id/versions", auth, (req, res) => {
  res.json({ versions: getFileVersions(req.params.id) });
});

api.get("/search", auth, (req, res) => {
  const term = String(req.query.q || "").trim();
  if (!term) return res.json({ results: [] });
  const results = q(
    `SELECT id,parent_id,name,type,size,mime,hash,version,updated_at FROM nodes
     WHERE name LIKE ? AND id != 'root' AND deleted_at IS NULL AND (owner_id=? OR owner_id IS NULL)
     ORDER BY type='folder' DESC, name COLLATE NOCASE LIMIT 100`
  ).all(`%${term}%`, req.user.id);
  res.json({ results });
});

api.post("/nodes/:id/share", auth, (req, res) => {
  const node = getNode(req.params.id);
  if (!node || node.type !== "file" || node.deleted_at) return bad(res, 404, "file not found");
  const shareId = createShare(node.id);
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

function verifyDropTicket(req, res, next) {
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
    const dropLink = getDropLinkById(decoded.dropLinkId);
    if (!dropLink || !dropLink.is_active) {
      return res.status(403).json({ error: "This upload link is inactive or has been revoked" });
    }
    const targetFolder = getNode(dropLink.folder_id);
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
api.get("/folders/:id/drop-links", auth, (req, res) => {
  const folder = getNode(req.params.id);
  if (!folder || folder.type !== "folder" || folder.deleted_at) {
    return bad(res, 404, "Folder not found");
  }
  const links = getDropLinksByFolder(folder.id, req.user.id);
  res.json({ dropLinks: links });
});

// Create a drop link for a folder
api.post("/folders/:id/drop-links", auth, (req, res) => {
  const { code, password, title } = req.body || {};
  try {
    const link = createDropLink({
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
api.patch("/drop-links/:id", auth, (req, res) => {
  const { code, password, is_active, title } = req.body || {};
  try {
    const updated = updateDropLink(req.params.id, req.user.id, {
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
api.delete("/drop-links/:id", auth, (req, res) => {
  try {
    const result = deleteDropLink(req.params.id, req.user.id);
    res.json(result);
  } catch (e) {
    bad(res, 400, e.message);
  }
});

// Public info for a drop link / 4-digit code
api.get("/drop/:code", (req, res) => {
  const link = getDropLinkByCode(req.params.code);
  if (!link || !link.is_active) {
    return bad(res, 404, "Upload link not found or inactive");
  }
  const folder = getNode(link.folder_id);
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
api.post("/drop/:code/verify", (req, res) => {
  const link = getDropLinkByCode(req.params.code);
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
api.post("/drop/:code/uploads", verifyDropTicket, (req, res) => {
  const { name, size, mime, hash, clientModifiedAt } = req.body || {};
  if (!name || !(Number.isFinite(size) && size >= 0)) {
    return bad(res, 400, "name and size required");
  }

  const dropLink = req.dropLink;

  // Deduplication check
  if (hash && size > 0) {
    const verifiedBlob = findVerifiedBlob(dropLink.owner_id, hash, size);
    if (verifiedBlob) {
      try {
        const { node, cursor } = createFileNode({
          parentId: dropLink.folder_id,
          name,
          size,
          mime,
          ownerId: dropLink.owner_id,
          hash,
          clientModifiedAt,
          blobId: verifiedBlob.id,
        });

        incrementDropLinkUploadCount(dropLink.id);
        emitSyncChange(dropLink.owner_id, cursor);
        return res.json({ dedup: true, node, cursor });
      } catch (e) {
        return bad(res, 500, e.message);
      }
    }
  }

  const id = uid();
  q(`INSERT INTO uploads(id,name,parent_id,size,mime,chunk_size,user_id,hash,client_modified_at,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(
      id,
      String(name),
      dropLink.folder_id,
      size,
      mime || null,
      cfg.chunkBytes,
      dropLink.owner_id,
      hash || null,
      clientModifiedAt ? Number(clientModifiedAt) : null,
      now()
    );

  res.json({ id, chunkSize: cfg.chunkBytes, dedup: false });
});

// Public drop upload part streaming
api.put("/drop/:code/uploads/:id/parts/:idx", verifyDropTicket, async (req, res) => {
  const up = q(`SELECT * FROM uploads WHERE id=?`).get(req.params.id);
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
    try { peer = getUserPeer(up.user_id); } catch (e) {}

    const partName =
      totalParts > 1
        ? `${up.name}.part${String(idx + 1).padStart(3, "0")}`
        : up.name;
    const caption = `tm1;f=${up.name.slice(0, 200)};p=${idx + 1}/${totalParts};drop=${req.dropLink.code}`;
    const msgId = await sendDocument(tmp, partName, caption, peer);

    const prev = q(`SELECT msg_id FROM upload_parts WHERE upload_id=? AND idx=?`).get(up.id, idx);
    if (prev) deleteMessages([prev.msg_id], peer);

    q(`INSERT OR REPLACE INTO upload_parts(upload_id,idx,msg_id,size,part_hash) VALUES (?,?,?,?,?)`)
      .run(up.id, idx, msgId, received, computedPartHash);

    res.json({ msgId, size: received, partHash: computedPartHash });
  } catch (e) {
    console.error("[drop upload part]", e);
    bad(res, e.status || 500, e.message);
  } finally {
    fsp.rm(tmp, { force: true }).catch(() => {});
  }
});

// Public drop upload completion
api.post("/drop/:code/uploads/:id/complete", verifyDropTicket, (req, res) => {
  const up = q(`SELECT * FROM uploads WHERE id=?`).get(req.params.id);
  if (!up || up.user_id !== req.dropLink.owner_id || up.parent_id !== req.dropLink.folder_id) {
    return bad(res, 404, "upload not found");
  }

  const parts = q(`SELECT * FROM upload_parts WHERE upload_id=? ORDER BY idx`).all(up.id);
  const expected = up.size === 0 ? 0 : Math.ceil(up.size / up.chunk_size);
  const total = parts.reduce((s, p) => s + p.size, 0);

  if (parts.length !== expected || total !== up.size) {
    return bad(res, 400, `incomplete upload: ${parts.length}/${expected} parts, ${total}/${up.size} bytes`);
  }

  try {
    const { node, cursor } = createFileNode({
      parentId: up.parent_id,
      name: up.name,
      size: up.size,
      mime: up.mime,
      ownerId: up.user_id,
      parts,
      hash: up.hash,
      clientModifiedAt: up.client_modified_at,
    });

    db.transaction(() => {
      q(`DELETE FROM upload_parts WHERE upload_id=?`).run(up.id);
      q(`DELETE FROM uploads WHERE id=?`).run(up.id);
    })();

    incrementDropLinkUploadCount(req.dropLink.id);
    emitSyncChange(up.user_id, cursor);
    res.json({ ok: true, node });
  } catch (e) {
    bad(res, 500, e.message);
  }
});

// Public drop abort upload
api.delete("/drop/:code/uploads/:id", verifyDropTicket, (req, res) => {
  const up = q(`SELECT * FROM uploads WHERE id=?`).get(req.params.id);
  if (!up || up.user_id !== req.dropLink.owner_id) return bad(res, 404, "upload not found");
  const msgIds = q(`SELECT msg_id FROM upload_parts WHERE upload_id=?`).all(up.id).map((r) => r.msg_id);
  db.transaction(() => {
    q(`DELETE FROM upload_parts WHERE upload_id=?`).run(up.id);
    q(`DELETE FROM uploads WHERE id=?`).run(up.id);
  })();
  let peer;
  try { peer = getUserPeer(up.user_id); } catch (e) {}
  deleteMessages(msgIds, peer);
  res.json({ ok: true });
});

api.get("/folders/tree", auth, (req, res) => {
  const folders = q(
    `SELECT id, parent_id, name FROM nodes
     WHERE type='folder' AND deleted_at IS NULL AND (owner_id=? OR owner_id IS NULL)
     ORDER BY name COLLATE NOCASE`
  ).all(req.user.id);
  res.json({ folders });
});

api.post("/nodes/move", auth, (req, res) => {
  const { ids, targetParentId } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return bad(res, 400, "ids array required");
  const target = getNode(targetParentId);
  if (!target || target.type !== "folder" || target.deleted_at)
    return bad(res, 404, "target folder not found");

  let moved = 0;
  let lastCursor = 0;
  const deviceId = req.headers["x-device-id"] || null;

  for (const id of ids) {
    try {
      const { cursor } = updateNode({
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

api.post("/uploads", auth, (req, res) => {
  const {
    name, size, mime, parentId, hash, clientModifiedAt,
    deviceId, replaceNodeId, baseVersion, onNameConflict,
  } = req.body || {};

  const parent = getNode(parentId);
  if (!parent || parent.type !== "folder" || parent.deleted_at)
    return bad(res, 404, "parent not found");
  if (!name || !(Number.isFinite(size) && size >= 0))
    return bad(res, 400, "name and size required");

  // Check version conflict early if replacing a node
  if (replaceNodeId && baseVersion !== undefined && baseVersion !== null) {
    const existing = getNode(replaceNodeId);
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
    const verifiedBlob = findVerifiedBlob(req.user.id, hash, size);
    if (verifiedBlob) {
      try {
        const { node, cursor } = createFileNode({
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
  q(`INSERT INTO uploads(id,name,parent_id,size,mime,chunk_size,user_id,hash,base_version,replace_node_id,on_name_conflict,client_modified_at,device_id,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      id,
      String(name),
      parentId,
      size,
      mime || null,
      cfg.chunkBytes,
      req.user.id,
      hash || null,
      baseVersion !== undefined ? Number(baseVersion) : null,
      replaceNodeId || null,
      onNameConflict || "rename",
      clientModifiedAt ? Number(clientModifiedAt) : null,
      deviceId || req.headers["x-device-id"] || null,
      now()
    );

  res.json({ id, chunkSize: cfg.chunkBytes, dedup: false });
});

api.put("/uploads/:id/parts/:idx", auth, async (req, res) => {
  const up = q(`SELECT * FROM uploads WHERE id=?`).get(req.params.id);
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
    try { peer = getUserPeer(up.user_id); } catch(e) {}

    const partName =
      totalParts > 1
        ? `${up.name}.part${String(idx + 1).padStart(3, "0")}`
        : up.name;
    const caption = `tm1;f=${up.name.slice(0, 200)};p=${idx + 1}/${totalParts}`;
    const msgId = await sendDocument(tmp, partName, caption, peer);

    // Retried part? Drop the superseded Telegram message.
    const prev = q(`SELECT msg_id FROM upload_parts WHERE upload_id=? AND idx=?`).get(up.id, idx);
    if (prev) deleteMessages([prev.msg_id], peer);

    q(`INSERT OR REPLACE INTO upload_parts(upload_id,idx,msg_id,size,part_hash) VALUES (?,?,?,?,?)`)
      .run(up.id, idx, msgId, received, computedPartHash);

    res.json({ msgId, size: received, partHash: computedPartHash });
  } catch (e) {
    console.error("[upload part]", e);
    bad(res, e.status || 500, e.message);
  } finally {
    fsp.rm(tmp, { force: true }).catch(() => {});
  }
});

api.get("/uploads/:id", auth, (req, res) => {
  const up = q(`SELECT * FROM uploads WHERE id=?`).get(req.params.id);
  if (!up) return bad(res, 404, "upload not found");
  const parts = q(`SELECT idx, msg_id, size, part_hash FROM upload_parts WHERE upload_id=? ORDER BY idx`).all(up.id);
  res.json({
    uploadId: up.id,
    size: up.size,
    chunkSize: up.chunk_size,
    parts,
    expectedParts: Math.max(1, Math.ceil(up.size / up.chunk_size)),
  });
});

api.post("/uploads/:id/complete", auth, (req, res) => {
  const up = q(`SELECT * FROM uploads WHERE id=?`).get(req.params.id);
  if (!up) return bad(res, 404, "upload not found");
  const parts = q(`SELECT * FROM upload_parts WHERE upload_id=? ORDER BY idx`).all(up.id);
  const expected = up.size === 0 ? 0 : Math.ceil(up.size / up.chunk_size);
  const total = parts.reduce((s, p) => s + p.size, 0);

  if (parts.length !== expected || total !== up.size)
    return bad(res, 400, `incomplete upload: ${parts.length}/${expected} parts, ${total}/${up.size} bytes`);

  try {
    const { node, cursor } = createFileNode({
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

    db.transaction(() => {
      q(`DELETE FROM upload_parts WHERE upload_id=?`).run(up.id);
      q(`DELETE FROM uploads WHERE id=?`).run(up.id);
    })();

    emitSyncChange(up.user_id, cursor);
    res.json(node);
  } catch (e) {
    if (e.code === "VERSION_CONFLICT") {
      return res.status(409).json({ error: { code: e.code, message: e.message, current: e.current } });
    }
    bad(res, 500, e.message);
  }
});

api.delete("/uploads/:id", auth, (req, res) => {
  const up = q(`SELECT * FROM uploads WHERE id=?`).get(req.params.id);
  if (!up) return bad(res, 404, "upload not found");
  const msgIds = q(`SELECT msg_id FROM upload_parts WHERE upload_id=?`).all(up.id).map((r) => r.msg_id);
  db.transaction(() => {
    q(`DELETE FROM upload_parts WHERE upload_id=?`).run(up.id);
    q(`DELETE FROM uploads WHERE id=?`).run(up.id);
  })();
  let peer;
  try { peer = getUserPeer(up.user_id); } catch(e) {}
  deleteMessages(msgIds, peer);
  res.json({ ok: true });
});

/* ------------------------------------------------------- ranged downloads */

async function serveNodeContent(req, res, node) {
  if (!node || node.type !== "file" || node.deleted_at) return bad(res, 404, "file not found");
  if (!tg.ready) return bad(res, 503, tg.error || "Telegram storage not connected");

  let chunks = q(`SELECT * FROM chunks WHERE file_id=? ORDER BY idx`).all(node.id);
  if (chunks.length === 0 && node.blob_id) {
    chunks = q(`SELECT * FROM chunks WHERE blob_id=? ORDER BY idx`).all(node.blob_id);
  }
  const total = node.size;
  if (total > 0 && chunks.length === 0) {
    return bad(res, 502, "File chunks not found");
  }

  let peer = tg.channel;
  if (node.owner_id) {
    try {
      peer = await resolvePeer(getUserPeer(node.owner_id));
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
  serveNodeContent(req, res, getNode(req.params.id));
});

api.get("/share/:id/content", async (req, res) => {
  const share = getShare(req.params.id);
  if (!share) return bad(res, 404, "share link not found");
  serveNodeContent(req, res, getNode(share.file_id));
});

api.get("/folders/:id/download", auth, async (req, res) => {
  const rootFolder = getNode(req.params.id);
  if (!rootFolder || rootFolder.type !== "folder" || rootFolder.deleted_at)
    return bad(res, 404, "folder not found");
  if (!tg.ready) return bad(res, 503, tg.error || "Telegram storage not connected");

  let peer = tg.channel;
  if (rootFolder.owner_id) {
    try {
      peer = await resolvePeer(getUserPeer(rootFolder.owner_id));
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
    const folderChildren = children(folderId, req.user.id);
    for (const child of folderChildren) {
      if (closed) return;
      const childPath = basePath ? `${basePath}/${child.name}` : child.name;

      if (child.type === "folder") {
        archive.append("", { name: childPath + "/" });
        await addFolder(child.id, childPath);
      } else {
        let fileChunks = q(`SELECT * FROM chunks WHERE file_id=? ORDER BY idx`).all(child.id);
        if (fileChunks.length === 0 && child.blob_id) {
          fileChunks = q(`SELECT * FROM chunks WHERE blob_id=? ORDER BY idx`).all(child.blob_id);
        }
        const { PassThrough } = await import("node:stream");
        const pt = new PassThrough();

        archive.append(pt, { name: childPath });

        let filePeer = peer;
        if (child.owner_id && child.owner_id !== rootFolder.owner_id) {
          try {
            filePeer = await resolvePeer(getUserPeer(child.owner_id));
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
