import fs from "node:fs";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import mongoose from "mongoose";
import { cfg } from "./config.js";

fs.mkdirSync(cfg.dataDir, { recursive: true });
fs.mkdirSync(`${cfg.dataDir}/tmp`, { recursive: true });

export const now = () => Date.now();
export const uid = () => nanoid(12);
export const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ==========================================================================
   MONGOOSE SCHEMAS & MODELS
   ========================================================================== */

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  handle: { type: String, required: true, unique: true },
  pass_hash: { type: String, required: true },
  channel_id: { type: String, default: null },
  telegram_id: { type: String, default: null },
  created_at: { type: Number, required: true },
});

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, required: true },
});

const nodeSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  parent_id: { type: String, default: null },
  name: { type: String, required: true },
  type: { type: String, enum: ["folder", "file"], required: true },
  size: { type: Number, default: 0 },
  mime: { type: String, default: null },
  owner_id: { type: String, default: null },
  created_at: { type: Number, required: true },
  updated_at: { type: Number, required: true },
  hash: { type: String, default: null },
  version: { type: Number, default: 1 },
  client_modified_at: { type: Number, default: null },
  deleted_at: { type: Number, default: null },
  blob_id: { type: String, default: null },
});
nodeSchema.index({ parent_id: 1 });

const chunkSchema = new mongoose.Schema({
  file_id: { type: String, required: true },
  idx: { type: Number, required: true },
  msg_id: { type: Number, required: true },
  size: { type: Number, required: true },
  blob_id: { type: String, default: null },
});
chunkSchema.index({ file_id: 1, idx: 1 }, { unique: true });
chunkSchema.index({ blob_id: 1 });

const uploadSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  parent_id: { type: String, required: true },
  size: { type: Number, required: true },
  mime: { type: String, default: null },
  chunk_size: { type: Number, required: true },
  user_id: { type: String, default: null },
  hash: { type: String, default: null },
  base_version: { type: Number, default: null },
  replace_node_id: { type: String, default: null },
  on_name_conflict: { type: String, default: "rename" },
  client_modified_at: { type: Number, default: null },
  device_id: { type: String, default: null },
  created_at: { type: Number, required: true },
});

const uploadPartSchema = new mongoose.Schema({
  upload_id: { type: String, required: true },
  idx: { type: Number, required: true },
  msg_id: { type: Number, required: true },
  size: { type: Number, required: true },
  part_hash: { type: String, default: null },
});
uploadPartSchema.index({ upload_id: 1, idx: 1 }, { unique: true });

const blobSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true },
  sha256: { type: String, default: null },
  size: { type: Number, required: true },
  verified: { type: Boolean, default: false },
  created_at: { type: Number, required: true },
  unreferenced_at: { type: Number, default: null },
});
blobSchema.index(
  { user_id: 1, sha256: 1, size: 1 },
  { unique: true, sparse: true, partialFilterExpression: { sha256: { $exists: true }, verified: true } }
);

const fileVersionSchema = new mongoose.Schema({
  node_id: { type: String, required: true },
  version: { type: Number, required: true },
  blob_id: { type: String, required: true },
  size: { type: Number, required: true },
  hash: { type: String, default: null },
  client_modified_at: { type: Number, default: null },
  device_id: { type: String, default: null },
  created_at: { type: Number, required: true },
});
fileVersionSchema.index({ node_id: 1, version: 1 }, { unique: true });

const syncJournalSchema = new mongoose.Schema({
  cursor: { type: Number, unique: true },
  user_id: { type: String, required: true },
  node_id: { type: String, required: true },
  action: { type: String, enum: ["CREATE", "UPDATE", "MOVE", "DELETE", "RESTORE"], required: true },
  parent_id: { type: String, default: null },
  name: { type: String, required: true },
  type: { type: String, enum: ["file", "folder"], required: true },
  size: { type: Number, default: 0 },
  hash: { type: String, default: null },
  version: { type: Number, required: true },
  client_modified_at: { type: Number, default: null },
  device_id: { type: String, default: null },
  created_at: { type: Number, required: true },
});
syncJournalSchema.index({ user_id: 1, cursor: 1 });
syncJournalSchema.index({ user_id: 1, node_id: 1, cursor: 1 });

const deviceSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true },
  name: { type: String, required: true },
  platform: { type: String, enum: ["windows", "android", "ios", "web", "other"], required: true },
  app_version: { type: String, default: null },
  last_cursor: { type: Number, default: 0 },
  last_seen_at: { type: Number, required: true },
  created_at: { type: Number, required: true },
  revoked_at: { type: Number, default: null },
});
deviceSchema.index({ user_id: 1 });

const sseTicketSchema = new mongoose.Schema({
  ticket: { type: String, required: true, unique: true },
  user_id: { type: String, required: true },
  created_at: { type: Number, required: true },
});

const idempotencyKeySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  user_id: { type: String, required: true },
  response: { type: String, required: true },
  status: { type: Number, required: true },
  created_at: { type: Number, required: true },
});

const shareSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  file_id: { type: String, required: true },
  created_at: { type: Number, required: true },
});

const dropLinkSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  code: { type: String, required: true, unique: true },
  folder_id: { type: String, required: true },
  owner_id: { type: String, required: true },
  title: { type: String, default: null },
  password_hash: { type: String, default: null },
  is_active: { type: Boolean, default: true },
  upload_count: { type: Number, default: 0 },
  created_at: { type: Number, required: true },
  updated_at: { type: Number, required: true },
});

const tgEntitySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  access_hash: { type: String, default: null },
  title: { type: String, default: null },
  username: { type: String, default: null },
  class_name: { type: String, default: null },
  updated_at: { type: Number, required: true },
});

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const User = mongoose.model("User", userSchema);
export const Setting = mongoose.model("Setting", settingSchema);
export const Node = mongoose.model("Node", nodeSchema);
export const Chunk = mongoose.model("Chunk", chunkSchema);
export const Upload = mongoose.model("Upload", uploadSchema);
export const UploadPart = mongoose.model("UploadPart", uploadPartSchema);
export const Blob = mongoose.model("Blob", blobSchema);
export const FileVersion = mongoose.model("FileVersion", fileVersionSchema);
export const SyncJournal = mongoose.model("SyncJournal", syncJournalSchema);
export const Device = mongoose.model("Device", deviceSchema);
export const SseTicket = mongoose.model("SseTicket", sseTicketSchema);
export const IdempotencyKey = mongoose.model("IdempotencyKey", idempotencyKeySchema);
export const Share = mongoose.model("Share", shareSchema);
export const DropLink = mongoose.model("DropLink", dropLinkSchema);
export const TgEntity = mongoose.model("TgEntity", tgEntitySchema);
export const Counter = mongoose.model("Counter", counterSchema);

/* ==========================================================================
   CONNECTION
   ========================================================================== */

export let db = null;

export async function connectDB() {
  if (!cfg.mongoUri) {
    throw new Error("MONGODB_URI is not set in environment");
  }
  await mongoose.connect(cfg.mongoUri, {
    serverSelectionTimeoutMS: 15000,
  });
  db = mongoose.connection;
  console.log("[db] MongoDB connected:", mongoose.connection.host);

  // Seed root node
  await Node.findOneAndUpdate(
    { id: "root" },
    {
      $setOnInsert: {
        id: "root",
        parent_id: null,
        name: "Home",
        type: "folder",
        size: 0,
        version: 1,
        created_at: now(),
        updated_at: now(),
      },
    },
    { upsert: true, new: true }
  );
}

/* ==========================================================================
   AUTO-INCREMENT COUNTER FOR sync_journal.cursor
   ========================================================================== */

async function nextJournalCursor() {
  const doc = await Counter.findOneAndUpdate(
    { _id: "journal_cursor" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
}

/* ==========================================================================
   SETTINGS
   ========================================================================== */

export async function getSetting(k) {
  const doc = await Setting.findOne({ key: k });
  return doc ? doc.value : undefined;
}

export async function setSetting(k, v) {
  await Setting.findOneAndUpdate(
    { key: k },
    { $set: { value: String(v) } },
    { upsert: true }
  );
}

/* ==========================================================================
   TG ENTITIES
   ========================================================================== */

export async function saveTgEntity({ id, accessHash, title, username, className }) {
  if (!id) return;
  const cleanId = String(id).replace(/^-100/, "").replace(/^-/, "");
  await TgEntity.findOneAndUpdate(
    { id: cleanId },
    {
      $set: {
        ...(accessHash != null ? { access_hash: String(accessHash) } : {}),
        ...(title != null ? { title } : {}),
        ...(username != null ? { username } : {}),
        ...(className != null ? { class_name: className } : {}),
        updated_at: now(),
      },
      $setOnInsert: { id: cleanId },
    },
    { upsert: true }
  );
}

export async function getTgEntity(idOrUsername) {
  if (!idOrUsername) return null;
  const s = String(idOrUsername).trim().replace(/^@/, "");
  const cleanId = s.replace(/^-100/, "").replace(/^-/, "");
  const doc = await TgEntity.findOne({
    $or: [{ id: cleanId }, { username: { $regex: new RegExp(`^${escapeRegex(s)}$`, "i") } }],
  }).lean();
  return doc;
}

/* ==========================================================================
   VIRTUAL FILESYSTEM & HIERARCHY HELPERS
   ========================================================================== */

/** Sibling-unique name: "report.pdf" -> "report (2).pdf" on collision. */
export async function uniqueName(parentId, name, ownerId) {
  const exists = async (n) =>
    Node.findOne({
      parent_id: parentId,
      name: n,
      $or: [{ owner_id: ownerId }, { owner_id: null }],
      deleted_at: null,
    });
  if (!(await exists(name))) return name;
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let i = 2;
  while (await exists(`${base} (${i})${ext}`)) i++;
  return `${base} (${i})${ext}`;
}

export async function getNode(id) {
  return Node.findOne({ id }).lean();
}

export async function breadcrumb(id) {
  const trail = [];
  let cur = await getNode(id);
  while (cur) {
    trail.unshift({ id: cur.id, name: cur.name });
    cur = cur.parent_id ? await getNode(cur.parent_id) : null;
  }
  return trail;
}

export async function children(parentId, ownerId) {
  return Node.find({
    parent_id: parentId,
    $or: [{ owner_id: ownerId }, { owner_id: null }],
    deleted_at: null,
  })
    .select("id parent_id name type size mime created_at updated_at hash version deleted_at blob_id")
    .sort({ type: -1, name: 1 })
    .lean();
}

/** All node ids in a subtree (inclusive). */
export async function subtreeIds(id) {
  const result = [id];
  const queue = [id];
  while (queue.length) {
    const parentId = queue.shift();
    const kids = await Node.find({ parent_id: parentId }, { id: 1 }).lean();
    for (const k of kids) {
      result.push(k.id);
      queue.push(k.id);
    }
  }
  return result;
}

/** True if `maybeAncestorId` is an ancestor of (or equal to) `nodeId`. */
export async function isAncestor(maybeAncestorId, nodeId) {
  let cur = await getNode(nodeId);
  while (cur) {
    if (cur.id === maybeAncestorId) return true;
    cur = cur.parent_id ? await getNode(cur.parent_id) : null;
  }
  return false;
}

/** Folder used by the indexer for files posted directly in the channel. */
export async function ensureInboxFolder(ownerId) {
  let found = null;
  if (ownerId) {
    found = await Node.findOne({
      parent_id: "root",
      type: "folder",
      name: "Telegram Inbox",
      owner_id: ownerId,
      deleted_at: null,
    }).lean();
  }
  if (!found) {
    found = await Node.findOne({
      parent_id: "root",
      type: "folder",
      name: "Telegram Inbox",
      $or: [{ owner_id: ownerId || null }, { owner_id: null }],
      deleted_at: null,
    }).lean();
  }
  if (found) return found;

  const id = uid();
  const t = now();
  await new Node({
    id,
    parent_id: "root",
    name: "Telegram Inbox",
    type: "folder",
    size: 0,
    version: 1,
    owner_id: ownerId || null,
    created_at: t,
    updated_at: t,
  }).save();

  await appendJournal({
    userId: ownerId || "system",
    nodeId: id,
    action: "CREATE",
    parentId: "root",
    name: "Telegram Inbox",
    type: "folder",
    size: 0,
    version: 1,
    createdAt: t,
  });

  return getNode(id);
}

export async function getIndexedMessageIds(ownerId) {
  // Get all non-deleted file node ids for this owner
  const nodes = await Node.find({
    type: "file",
    deleted_at: null,
    $or: ownerId
      ? [{ owner_id: ownerId }, { owner_id: null }]
      : [{ owner_id: null }, { owner_id: { $exists: true } }],
  }, { id: 1 }).lean();

  const nodeIds = nodes.map((n) => n.id);
  const chunks = await Chunk.find({ file_id: { $in: nodeIds } }, { msg_id: 1 }).lean();
  return new Set(chunks.map((r) => r.msg_id));
}

/* ==========================================================================
   JOURNAL & SYNC HELPERS
   ========================================================================== */

export async function appendJournal({
  userId,
  nodeId,
  action,
  parentId,
  name,
  type,
  size = 0,
  hash = null,
  version = 1,
  clientModifiedAt = null,
  deviceId = null,
  createdAt = now(),
}) {
  const cursor = await nextJournalCursor();
  await new SyncJournal({
    cursor,
    user_id: userId,
    node_id: nodeId,
    action,
    parent_id: parentId,
    name,
    type,
    size,
    hash,
    version,
    client_modified_at: clientModifiedAt,
    device_id: deviceId,
    created_at: createdAt,
  }).save();
  return cursor;
}

export async function getJournalHead(userId) {
  const row = await SyncJournal.findOne({
    $or: [{ user_id: userId }, { user_id: "system" }],
  })
    .sort({ cursor: -1 })
    .select("cursor")
    .lean();
  return row ? row.cursor : 0;
}

/** Coalesced delta feed: returns latest state per node with cursor > afterCursor. */
export async function getDelta({ userId, cursor = 0, limit = 500 }) {
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const rows = await SyncJournal.find({
    $or: [{ user_id: userId }, { user_id: "system" }],
    cursor: { $gt: Number(cursor) },
  })
    .sort({ cursor: 1 })
    .limit(lim + 1)
    .lean();

  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;

  const nodeMap = new Map();
  let maxCursor = Number(cursor);
  for (const r of page) {
    if (r.cursor > maxCursor) maxCursor = r.cursor;
    nodeMap.set(r.node_id, r);
  }

  if (page.length === 0) {
    maxCursor = await getJournalHead(userId);
  }

  const changes = Array.from(nodeMap.values()).map((r) => ({
    cursor: r.cursor,
    nodeId: r.node_id,
    action: r.action,
    parentId: r.parent_id,
    name: r.name,
    type: r.type,
    size: r.size,
    hash: r.hash,
    version: r.version,
    deleted: r.action === "DELETE",
    clientModifiedAt: r.client_modified_at,
    deviceId: r.device_id,
  }));

  return { cursor: maxCursor, hasMore, changes };
}

/** Snapshot for initial sync and 410 resync. */
export async function getSnapshot({ userId, afterNodeId = null, limit = 500 }) {
  const headCursor = await getJournalHead(userId);
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 1000);

  const filter = {
    $or: [{ owner_id: userId }, { owner_id: null }],
    deleted_at: null,
    id: { $ne: "root" },
  };

  if (afterNodeId) {
    filter.id = { ...filter.id, $gt: afterNodeId };
  }

  const rows = await Node.find(filter)
    .select("id parent_id name type size mime hash version client_modified_at created_at updated_at")
    .sort({ id: 1 })
    .limit(lim + 1)
    .lean();

  const hasMore = rows.length > lim;
  const nodes = hasMore ? rows.slice(0, lim) : rows;

  return {
    snapshotCursor: headCursor,
    hasMore,
    nodes: nodes.map((n) => ({
      nodeId: n.id,
      parentId: n.parent_id,
      name: n.name,
      type: n.type,
      size: n.size,
      mime: n.mime,
      hash: n.hash,
      version: n.version,
      clientModifiedAt: n.client_modified_at,
      updatedAt: n.updated_at,
    })),
  };
}

/* ==========================================================================
   BLOB & DEDUPLICATION HELPERS
   ========================================================================== */

export async function findVerifiedBlob(userId, sha256, size) {
  if (!sha256 || !size) return null;
  return Blob.findOne({ user_id: userId, sha256, size, verified: true }).lean();
}

export async function getBlob(blobId) {
  return Blob.findOne({ id: blobId }).lean();
}

/* ==========================================================================
   NODE MUTATIONS (JOURNALED)
   ========================================================================== */

export async function createFolderNode({ parentId, name, ownerId, deviceId }) {
  const id = uid();
  const t = now();

  const safeName = await uniqueName(parentId, name, ownerId);
  await new Node({
    id,
    parent_id: parentId,
    name: safeName,
    type: "folder",
    size: 0,
    version: 1,
    owner_id: ownerId || null,
    created_at: t,
    updated_at: t,
  }).save();

  const cursor = await appendJournal({
    userId: ownerId || "system",
    nodeId: id,
    action: "CREATE",
    parentId,
    name: safeName,
    type: "folder",
    size: 0,
    version: 1,
    deviceId,
    createdAt: t,
  });

  return { node: await getNode(id), cursor };
}

export async function createFileNode({
  parentId,
  name,
  size,
  mime,
  ownerId,
  parts = [],
  hash = null,
  clientModifiedAt = null,
  deviceId = null,
  replaceNodeId = null,
  baseVersion = null,
  blobId = null,
}) {
  const t = now();
  let nodeId = replaceNodeId || uid();
  let targetBlobId = blobId;
  let version = 1;
  let action = "CREATE";

  if (replaceNodeId) {
    const existing = await getNode(replaceNodeId);
    if (!existing) throw Object.assign(new Error("Node to replace not found"), { status: 404 });
    if (baseVersion !== null && baseVersion !== undefined && existing.version !== Number(baseVersion)) {
      throw Object.assign(new Error("Node changed since baseVersion"), {
        status: 409,
        code: "VERSION_CONFLICT",
        current: { version: existing.version, hash: existing.hash },
      });
    }
    version = (existing.version || 1) + 1;
    action = "UPDATE";
    parentId = parentId || existing.parent_id;
    name = name || existing.name;
  }

  // Dedup or new blob
  if (!targetBlobId) {
    targetBlobId = uid();
    await new Blob({
      id: targetBlobId,
      user_id: ownerId || "system",
      sha256: hash,
      size,
      verified: Boolean(hash),
      created_at: t,
    }).save();

    // Insert chunks pointing to targetBlobId (clear prior chunks when replacing an existing node)
    if (replaceNodeId) {
      await Chunk.deleteMany({ file_id: nodeId });
    }
    for (let i = 0; i < parts.length; i++) {
      await new Chunk({
        file_id: nodeId,
        idx: i,
        msg_id: parts[i].msg_id,
        size: parts[i].size,
        blob_id: targetBlobId,
      }).save();
    }
  } else {
    // Reusing existing blob — copy chunk mappings
    const existingChunks = await Chunk.find({ blob_id: targetBlobId }).sort({ idx: 1 }).lean();
    for (const c of existingChunks) {
      await Chunk.findOneAndUpdate(
        { file_id: nodeId, idx: c.idx },
        { $set: { file_id: nodeId, idx: c.idx, msg_id: c.msg_id, size: c.size, blob_id: targetBlobId } },
        { upsert: true }
      );
    }
  }

  // Save version history
  await FileVersion.findOneAndUpdate(
    { node_id: nodeId, version },
    {
      $set: {
        node_id: nodeId,
        version,
        blob_id: targetBlobId,
        size,
        hash,
        client_modified_at: clientModifiedAt,
        device_id: deviceId,
        created_at: t,
      },
    },
    { upsert: true }
  );

  // Upsert node
  if (replaceNodeId) {
    await Node.updateOne(
      { id: nodeId },
      {
        $set: {
          size,
          mime: mime || null,
          hash,
          version,
          client_modified_at: clientModifiedAt,
          blob_id: targetBlobId,
          updated_at: t,
          deleted_at: null,
        },
      }
    );
  } else {
    const safeName = await uniqueName(parentId, name, ownerId);
    await new Node({
      id: nodeId,
      parent_id: parentId,
      name: safeName,
      type: "file",
      size,
      mime: mime || null,
      owner_id: ownerId || null,
      hash,
      version,
      client_modified_at: clientModifiedAt,
      blob_id: targetBlobId,
      created_at: t,
      updated_at: t,
    }).save();
  }

  const finalNode = await getNode(nodeId);

  const cursor = await appendJournal({
    userId: ownerId || "system",
    nodeId,
    action,
    parentId: finalNode.parent_id,
    name: finalNode.name,
    type: "file",
    size: finalNode.size,
    hash: finalNode.hash,
    version: finalNode.version,
    clientModifiedAt: finalNode.client_modified_at,
    deviceId,
    createdAt: t,
  });

  return { node: finalNode, cursor };
}

export async function trashNode(id, ownerId, deviceId, ifMatchVersion = null) {
  const node = await getNode(id);
  if (!node || node.id === "root") throw Object.assign(new Error("Node not found"), { status: 404 });
  if (ifMatchVersion !== null && ifMatchVersion !== undefined && node.version !== Number(ifMatchVersion)) {
    throw Object.assign(new Error("Version conflict on delete"), {
      status: 409,
      code: "VERSION_CONFLICT",
      current: { version: node.version },
    });
  }

  const t = now();
  const ids = await subtreeIds(node.id);

  // Soft delete all nodes in subtree
  await Node.updateMany({ id: { $in: ids } }, { $set: { deleted_at: t, updated_at: t } });

  const fresh = await getNode(node.id);
  const cursor = await appendJournal({
    userId: ownerId || "system",
    nodeId: node.id,
    action: "DELETE",
    parentId: fresh.parent_id,
    name: fresh.name,
    type: fresh.type,
    size: fresh.size,
    hash: fresh.hash,
    version: fresh.version,
    deviceId,
    createdAt: t,
  });

  return { ok: true, trashed: ids.length, cursor };
}

export async function restoreNode(id, ownerId, deviceId) {
  const node = await getNode(id);
  if (!node || node.id === "root") throw Object.assign(new Error("Node not found"), { status: 404 });
  if (!node.deleted_at) return { node, cursor: await getJournalHead(ownerId) };

  const t = now();

  // If parent is trashed or missing, restore to root
  let parentId = node.parent_id;
  const parent = parentId ? await getNode(parentId) : null;
  if (!parent || parent.deleted_at) {
    parentId = "root";
  }

  const safeName = await uniqueName(parentId, node.name, ownerId);
  const newVersion = (node.version || 1) + 1;

  await Node.updateOne(
    { id: node.id },
    { $set: { parent_id: parentId, name: safeName, deleted_at: null, version: newVersion, updated_at: t } }
  );

  // Also restore descendants if it was a folder
  if (node.type === "folder") {
    const ids = await subtreeIds(node.id);
    await Node.updateMany({ id: { $in: ids } }, { $set: { deleted_at: null, updated_at: t } });
  }

  const freshNode = await getNode(node.id);

  const cursor = await appendJournal({
    userId: ownerId || "system",
    nodeId: node.id,
    action: "RESTORE",
    parentId: freshNode.parent_id,
    name: freshNode.name,
    type: freshNode.type,
    size: freshNode.size,
    hash: freshNode.hash,
    version: freshNode.version,
    deviceId,
    createdAt: t,
  });

  return { node: freshNode, cursor };
}

export async function updateNode({ id, name, parentId, ownerId, deviceId, ifMatchVersion = null }) {
  const node = await getNode(id);
  if (!node || node.id === "root") throw Object.assign(new Error("Node not found"), { status: 404 });
  if (ifMatchVersion !== null && ifMatchVersion !== undefined && node.version !== Number(ifMatchVersion)) {
    throw Object.assign(new Error("Version conflict on update"), {
      status: 409,
      code: "VERSION_CONFLICT",
      current: { version: node.version },
    });
  }

  const t = now();
  let action = "UPDATE";
  let targetParentId = node.parent_id;
  let targetName = node.name;

  if (parentId !== undefined && parentId !== node.parent_id) {
    const target = await getNode(parentId);
    if (!target || target.type !== "folder" || target.deleted_at) {
      throw Object.assign(new Error("Target folder not found"), { status: 404 });
    }
    if (node.type === "folder" && (await isAncestor(node.id, target.id))) {
      throw Object.assign(new Error("Cannot move a folder into itself"), { status: 400 });
    }
    targetParentId = target.id;
    action = "MOVE";
  }

  if (name !== undefined) {
    const clean = String(name).trim().replace(/[/\\]/g, "-");
    if (!clean) throw Object.assign(new Error("Name required"), { status: 400 });
    targetName = clean;
  }

  const safeName = await uniqueName(targetParentId, targetName, ownerId);
  const newVersion = (node.version || 1) + 1;

  await Node.updateOne(
    { id: node.id },
    { $set: { parent_id: targetParentId, name: safeName, version: newVersion, updated_at: t } }
  );

  const freshNode = await getNode(node.id);

  const cursor = await appendJournal({
    userId: ownerId || "system",
    nodeId: node.id,
    action,
    parentId: freshNode.parent_id,
    name: freshNode.name,
    type: freshNode.type,
    size: freshNode.size,
    hash: freshNode.hash,
    version: freshNode.version,
    deviceId,
    createdAt: t,
  });

  return { node: freshNode, cursor };
}

export async function getFileVersions(nodeId) {
  return FileVersion.find({ node_id: nodeId })
    .select("version blob_id size hash client_modified_at device_id created_at")
    .sort({ version: -1 })
    .lean();
}

export async function getTrash(ownerId) {
  return Node.find({
    $or: [{ owner_id: ownerId }, { owner_id: null }],
    deleted_at: { $ne: null },
  })
    .select("id parent_id name type size mime hash version deleted_at updated_at")
    .sort({ deleted_at: -1 })
    .lean();
}

/* ==========================================================================
   DEVICE REGISTRATION & SSE TICKETS
   ========================================================================== */

export async function registerDevice({ id, userId, name, platform, appVersion }) {
  const t = now();
  const devId = id || uid();
  await Device.findOneAndUpdate(
    { id: devId },
    {
      $set: {
        name: name || "Unnamed Device",
        platform: platform || "other",
        app_version: appVersion || null,
        last_seen_at: t,
      },
      $setOnInsert: {
        id: devId,
        user_id: userId,
        last_cursor: 0,
        created_at: t,
      },
    },
    { upsert: true, new: true }
  );
  return Device.findOne({ id: devId }).lean();
}

export async function updateDeviceCursor(deviceId, cursor) {
  await Device.updateOne({ id: deviceId }, { $set: { last_cursor: Number(cursor), last_seen_at: now() } });
}

export async function getDevices(userId) {
  return Device.find({ user_id: userId, revoked_at: null }).sort({ last_seen_at: -1 }).lean();
}

export async function revokeDevice(deviceId, userId) {
  await Device.updateOne({ id: deviceId, user_id: userId }, { $set: { revoked_at: now() } });
  return { ok: true };
}

export async function createSSETicket(userId) {
  const ticket = crypto.randomBytes(24).toString("hex");
  await new SseTicket({ ticket, user_id: userId, created_at: now() }).save();
  return ticket;
}

export async function verifyAndConsumeSSETicket(ticket) {
  const t = now();
  const row = await SseTicket.findOne({ ticket, created_at: { $gt: t - 60000 } }).lean();
  if (!row) return null;
  await SseTicket.deleteOne({ ticket });
  return row.user_id;
}

/* ==========================================================================
   SHARE LINKS
   ========================================================================== */

export async function createShare(fileId) {
  const id = uid();
  await new Share({ id, file_id: fileId, created_at: now() }).save();
  return id;
}

export async function getShare(shareId) {
  return Share.findOne({ id: shareId }).lean();
}

/* ==========================================================================
   DROP / UPLOAD LINKS (Send a link)
   ========================================================================== */

export async function generateDropCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const exists = await DropLink.findOne({ code: { $regex: new RegExp(`^${escapeRegex(code)}$`, "i") } });
    if (!exists) return code;
  }
  return String(Math.floor(10000 + Math.random() * 90000));
}

async function populateDropLink(link) {
  if (!link) return null;
  const obj = link.toObject ? link.toObject() : { ...link };
  const user = await User.findOne({ id: obj.owner_id }, { handle: 1 }).lean();
  const node = await Node.findOne({ id: obj.folder_id }, { name: 1 }).lean();
  obj.owner_handle = user?.handle || null;
  obj.folder_name = node?.name || null;
  return obj;
}

export async function createDropLink({ folderId, ownerId, code, password, title }) {
  const folder = await getNode(folderId);
  if (!folder || folder.type !== "folder" || folder.deleted_at) {
    throw new Error("Target folder not found");
  }
  if (folder.owner_id && folder.owner_id !== ownerId) {
    throw new Error("Folder does not belong to you");
  }

  let finalCode = (code || "").trim().replace(/^#+/, "");
  if (finalCode) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(finalCode)) {
      throw new Error("Key must be 1–32 letters, numbers, hyphens, or underscores");
    }
    const existing = await DropLink.findOne({ code: { $regex: new RegExp(`^${escapeRegex(finalCode)}$`, "i") } });
    if (existing) {
      throw new Error(`The code or link "${finalCode}" is already in use. Please choose another.`);
    }
  } else {
    finalCode = await generateDropCode();
  }

  const id = uid();
  const passwordHash = password && password.trim() ? bcrypt.hashSync(password.trim(), 10) : null;
  const t = now();

  const link = await new DropLink({
    id,
    code: finalCode,
    folder_id: folderId,
    owner_id: ownerId,
    title: title ? String(title).trim() : null,
    password_hash: passwordHash,
    is_active: true,
    upload_count: 0,
    created_at: t,
    updated_at: t,
  }).save();

  return populateDropLink(link);
}

export async function getDropLinkById(id) {
  const link = await DropLink.findOne({ id }).lean();
  if (!link) return null;
  return populateDropLink(link);
}

export async function getDropLinkByCode(code) {
  const clean = String(code || "").trim().replace(/^#+/, "");
  if (!clean) return null;
  const link = await DropLink.findOne({ code: { $regex: new RegExp(`^${escapeRegex(clean)}$`, "i") } }).lean();
  if (!link) return null;
  return populateDropLink(link);
}

export async function getDropLinksByFolder(folderId, ownerId) {
  const links = await DropLink.find({ folder_id: folderId, owner_id: ownerId }).sort({ created_at: -1 }).lean();
  return Promise.all(links.map(populateDropLink));
}

export async function getDropLinksByOwner(ownerId) {
  const links = await DropLink.find({ owner_id: ownerId }).sort({ updated_at: -1, created_at: -1 }).lean();
  return Promise.all(links.map(populateDropLink));
}

export async function updateDropLink(id, ownerId, { code, password, is_active, title }) {
  const existing = await DropLink.findOne({ id, owner_id: ownerId }).lean();
  if (!existing) throw new Error("Drop link not found");

  let newCode = existing.code;
  const cleanNewCode = code !== undefined ? String(code).trim().replace(/^#+/, "") : "";
  if (cleanNewCode && cleanNewCode !== existing.code) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(cleanNewCode)) {
      throw new Error("Key must be 1–32 letters, numbers, hyphens, or underscores");
    }
    const conflict = await DropLink.findOne({
      code: { $regex: new RegExp(`^${escapeRegex(cleanNewCode)}$`, "i") },
      id: { $ne: id },
    });
    if (conflict) {
      throw new Error(`The code or link "${cleanNewCode}" is already in use.`);
    }
    newCode = cleanNewCode;
  }

  let newPasswordHash = existing.password_hash;
  if (password !== undefined) {
    newPasswordHash = password && password.trim() ? bcrypt.hashSync(password.trim(), 10) : null;
  }

  const newActive = is_active !== undefined ? Boolean(is_active) : existing.is_active;
  const newTitle = title !== undefined ? (title ? String(title).trim() : null) : existing.title;

  await DropLink.updateOne(
    { id, owner_id: ownerId },
    {
      $set: {
        code: newCode,
        password_hash: newPasswordHash,
        is_active: newActive,
        title: newTitle,
        updated_at: now(),
      },
    }
  );

  return getDropLinkById(id);
}

export async function deleteDropLink(id, ownerId) {
  const res = await DropLink.deleteOne({ id, owner_id: ownerId });
  return { ok: res.deletedCount > 0 };
}

export async function incrementDropLinkUploadCount(id) {
  await DropLink.updateOne({ id }, { $inc: { upload_count: 1 }, $set: { updated_at: now() } });
}


