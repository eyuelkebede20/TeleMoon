import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { cfg } from "./config.js";

fs.mkdirSync(cfg.dataDir, { recursive: true });
const tmpDir = path.join(cfg.dataDir, "tmp");
fs.mkdirSync(tmpDir, { recursive: true });
try {
  for (const file of fs.readdirSync(tmpDir)) {
    fs.rmSync(path.join(tmpDir, file), { recursive: true, force: true });
  }
} catch (e) {
  console.warn("[db] tmp cleanup warning:", e.message);
}

export const db = new Database(path.join(cfg.dataDir, "telemoon.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  handle TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS storage_connections(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  telegram_channel_id TEXT NOT NULL UNIQUE,
  channel_title TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_storage_user_status ON storage_connections(user_id,status);
CREATE TABLE IF NOT EXISTS pairing_codes(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes(
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('folder','file')),
  size INTEGER NOT NULL DEFAULT 0,
  mime TEXT,
  owner_id TEXT,
  storage_id TEXT,
  deleted_at INTEGER,
  trash_root_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
CREATE TABLE IF NOT EXISTS chunks(
  file_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  msg_id INTEGER NOT NULL,
  size INTEGER NOT NULL,
  storage_id TEXT,
  PRIMARY KEY(file_id, idx)
);
CREATE TABLE IF NOT EXISTS uploads(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT,
  chunk_size INTEGER NOT NULL,
  user_id TEXT,
  storage_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  node_id TEXT,
  last_modified INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS upload_parts(
  upload_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  msg_id INTEGER NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY(upload_id, idx)
);
CREATE TABLE IF NOT EXISTS shares(
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deletion_queue(
  storage_id TEXT NOT NULL,
  msg_id INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(storage_id,msg_id)
);
`);

export const now = () => Date.now();
export const uid = () => nanoid(12);
export const q = (sql) => db.prepare(sql);

function ensureColumn(table, column, definition) {
  const columns = q(`PRAGMA table_info(${table})`).all().map((entry) => entry.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn("nodes", "storage_id", "TEXT");
ensureColumn("nodes", "deleted_at", "INTEGER");
ensureColumn("nodes", "trash_root_id", "TEXT");
ensureColumn("nodes", "encrypted", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("chunks", "storage_id", "TEXT");
ensureColumn("uploads", "storage_id", "TEXT");
ensureColumn("uploads", "status", "TEXT NOT NULL DEFAULT 'active'");
ensureColumn("uploads", "node_id", "TEXT");
ensureColumn("uploads", "last_modified", "INTEGER");
ensureColumn("uploads", "updated_at", "INTEGER");
ensureColumn("uploads", "encrypted", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("shares", "expires_at", "INTEGER");
q(`UPDATE uploads SET updated_at=created_at WHERE updated_at IS NULL`).run();
q(`CREATE INDEX IF NOT EXISTS idx_nodes_owner_deleted ON nodes(owner_id,deleted_at)`).run();
q(`CREATE INDEX IF NOT EXISTS idx_nodes_trash_root ON nodes(owner_id,trash_root_id)`).run();
q(`CREATE INDEX IF NOT EXISTS idx_uploads_user_status ON uploads(user_id,status)`).run();
q(`CREATE INDEX IF NOT EXISTS idx_shares_file ON shares(file_id)`).run();
q(`CREATE INDEX IF NOT EXISTS idx_deletion_attempts ON deletion_queue(attempts,created_at)`).run();

// Migration: pre-handle DBs stored email+name; handle = sanitized email
// local part ("Tola.Wakga@x.com" -> "tola_wakga"), deduped on collision.
const userCols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
if (userCols.includes("email")) {
  const old = db.prepare(`SELECT * FROM users`).all();
  db.exec(`
    CREATE TABLE users_new(
      id TEXT PRIMARY KEY,
      handle TEXT UNIQUE NOT NULL,
      pass_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')),
      created_at INTEGER NOT NULL
    );
  `);
  const taken = new Set();
  const ins = db.prepare(`INSERT INTO users_new(id,handle,pass_hash,created_at) VALUES (?,?,?,?)`);
  for (const u of old) {
    let h = u.email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "_");
    while (h.length < 3) h += "_";
    h = h.slice(0, 32);
    let base = h, i = 2;
    while (taken.has(h)) h = `${base.slice(0, 30)}${i++}`;
    taken.add(h);
    ins.run(u.id, h, u.pass_hash, u.created_at);
    console.log(`[migrate] ${u.email} -> @${h}`);
  }
  db.exec(`DROP TABLE users; ALTER TABLE users_new RENAME TO users;`);
}

// The oldest account owns deployment-wide Telegram configuration. Existing
// installations are upgraded in place and keep all legacy files under that
// account rather than exposing ownerless nodes to every signed-in user.
const currentUserCols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
if (!currentUserCols.includes("role")) {
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'`);
}
q(`UPDATE users SET role='member' WHERE role NOT IN ('owner','member') OR role IS NULL`).run();
const existingOwner = q(`SELECT id FROM users WHERE role='owner' ORDER BY created_at LIMIT 1`).get();
if (!existingOwner) {
  const oldest = q(`SELECT id FROM users ORDER BY created_at, rowid LIMIT 1`).get();
  if (oldest) q(`UPDATE users SET role='owner' WHERE id=?`).run(oldest.id);
}

export const getSetting = (k) =>
  q(`SELECT value FROM settings WHERE key=?`).get(k)?.value;
export const setSetting = (k, v) =>
  q(`INSERT INTO settings(key,value) VALUES (?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(k, String(v));

// Root of the virtual filesystem
q(`INSERT OR IGNORE INTO nodes(id,parent_id,name,type,size,created_at,updated_at)
   VALUES ('root', NULL, 'Home', 'folder', 0, ?, ?)`).run(now(), now());

export function storageOwnerId() {
  return q(`SELECT id FROM users WHERE role='owner' ORDER BY created_at, rowid LIMIT 1`).get()?.id || null;
}

export function claimLegacyNodes(ownerId) {
  if (!ownerId) return;
  q(`UPDATE nodes SET owner_id=? WHERE id!='root' AND owner_id IS NULL`).run(ownerId);
}

claimLegacyNodes(storageOwnerId());

export function getStorage(storageId) {
  return q(`SELECT * FROM storage_connections WHERE id=?`).get(storageId);
}

export function getActiveStorage(userId) {
  return q(
    `SELECT * FROM storage_connections WHERE user_id=? AND status='active' ORDER BY updated_at DESC LIMIT 1`
  ).get(userId);
}

export function getStorageByChannel(channelId) {
  return q(`SELECT * FROM storage_connections WHERE telegram_channel_id=?`).get(String(channelId));
}

export function activateStorage(userId, channelId, title) {
  const normalizedChannel = String(channelId);
  const existing = getStorageByChannel(normalizedChannel);
  if (existing && existing.user_id !== userId) {
    const error = new Error("this Telegram channel is already paired with another account");
    error.status = 409;
    throw error;
  }
  const t = now();
  let storageId = existing?.id || uid();
  db.transaction(() => {
    q(`UPDATE storage_connections SET status='archived',updated_at=? WHERE user_id=? AND status='active'`)
      .run(t, userId);
    if (existing) {
      q(`UPDATE storage_connections SET channel_title=?,status='active',updated_at=? WHERE id=?`)
        .run(title || existing.channel_title, t, existing.id);
    } else {
      q(`INSERT INTO storage_connections(id,user_id,telegram_channel_id,channel_title,status,created_at,updated_at)
         VALUES (?,?,?,?, 'active',?,?)`).run(storageId, userId, normalizedChannel, title || null, t, t);
    }
  })();
  return getStorage(storageId);
}

// Upgrade the old single-channel setting into the owner's first immutable
// storage connection. Existing chunks retain that storage id forever, so a
// later channel switch cannot strand them.
export function claimLegacyStorage(ownerId) {
  const legacyChannelId = getSetting("channel") || cfg.channel;
  if (!ownerId || !legacyChannelId || getActiveStorage(ownerId)) return null;
  const legacyStorage = activateStorage(ownerId, legacyChannelId, "Legacy Telegram storage");
  q(`UPDATE nodes SET storage_id=? WHERE owner_id=? AND storage_id IS NULL
     AND (type='file' OR (type='folder' AND name LIKE 'Telegram Inbox%'))`)
    .run(legacyStorage.id, ownerId);
  q(`UPDATE chunks SET storage_id=? WHERE storage_id IS NULL AND file_id IN
     (SELECT id FROM nodes WHERE owner_id=?)`).run(legacyStorage.id, ownerId);
  q(`UPDATE uploads SET storage_id=? WHERE storage_id IS NULL AND user_id=?`)
    .run(legacyStorage.id, ownerId);
  return legacyStorage;
}

claimLegacyStorage(storageOwnerId());

/** Sibling-unique name: "report.pdf" -> "report (2).pdf" on collision. */
export function uniqueName(parentId, name, ownerId) {
  const exists = (n) =>
    q(`SELECT 1 FROM nodes WHERE parent_id=? AND name=? AND owner_id IS ? AND deleted_at IS NULL`)
      .get(parentId, n, ownerId);
  if (!exists(name)) return name;
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let i = 2;
  while (exists(`${base} (${i})${ext}`)) i++;
  return `${base} (${i})${ext}`;
}

export function getNode(id) {
  return q(`SELECT * FROM nodes WHERE id=?`).get(id);
}

export function getOwnedNode(id, ownerId, { allowRoot = true, includeDeleted = false } = {}) {
  if (allowRoot && id === "root") return getNode(id);
  return q(`SELECT * FROM nodes WHERE id=? AND owner_id=? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`)
    .get(id, ownerId);
}

export function breadcrumb(id, ownerId) {
  const trail = [];
  let cur = getOwnedNode(id, ownerId);
  while (cur) {
    trail.unshift({ id: cur.id, name: cur.name });
    cur = cur.parent_id ? getOwnedNode(cur.parent_id, ownerId) : null;
  }
  return trail;
}

export function children(parentId, ownerId) {
  return q(
    `SELECT id,parent_id,name,type,size,mime,storage_id,encrypted,created_at,updated_at
     FROM nodes WHERE parent_id=? AND owner_id=?
     AND deleted_at IS NULL
     ORDER BY type='folder' DESC, name COLLATE NOCASE`
  ).all(parentId, ownerId);
}

/** All node ids in a subtree (inclusive). */
export function subtreeIds(id, ownerId, { includeDeleted = false } = {}) {
  const visible = includeDeleted ? "" : "AND deleted_at IS NULL";
  return q(
    `WITH RECURSIVE d(id) AS (
       SELECT id FROM nodes WHERE id=? AND owner_id=? ${visible}
       UNION ALL
       SELECT n.id FROM nodes n JOIN d ON n.parent_id = d.id WHERE n.owner_id=? ${visible}
     ) SELECT id FROM d`
  )
    .all(id, ownerId, ownerId)
    .map((r) => r.id);
}

/** True if `maybeAncestorId` is an ancestor of (or equal to) `nodeId`. */
export function isAncestor(maybeAncestorId, nodeId, ownerId) {
  let cur = getOwnedNode(nodeId, ownerId);
  while (cur) {
    if (cur.id === maybeAncestorId) return true;
    cur = cur.parent_id ? getOwnedNode(cur.parent_id, ownerId) : null;
  }
  return false;
}

/** Folder used by the indexer for files posted directly in the channel. */
export function ensureInboxFolder(ownerId, storageId) {
  const found = q(
    `SELECT * FROM nodes WHERE parent_id='root' AND type='folder' AND name LIKE 'Telegram Inbox%'
     AND owner_id=? AND storage_id=? AND deleted_at IS NULL
     ORDER BY created_at LIMIT 1`
  ).get(ownerId, storageId);
  if (found) return found;
  const id = uid();
  q(`INSERT INTO nodes(id,parent_id,name,type,size,owner_id,storage_id,created_at,updated_at)
     VALUES (?,?,?,?,0,?,?,?,?)`).run(
       id, "root", uniqueName("root", "Telegram Inbox", ownerId), "folder", ownerId, storageId, now(), now()
     );
  return getNode(id);
}

export function createFileNode({ parentId, name, size, mime, ownerId, storageId, encrypted = 0, parts }) {
  const id = uid();
  const t = now();
  const tx = db.transaction(() => {
    q(`INSERT INTO nodes(id,parent_id,name,type,size,mime,owner_id,storage_id,encrypted,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, parentId, uniqueName(parentId, name, ownerId), "file", size, mime || null,
      ownerId || null, storageId || null, encrypted ? 1 : 0, t, t
    );
    const ins = q(`INSERT INTO chunks(file_id,idx,msg_id,size,storage_id) VALUES (?,?,?,?,?)`);
    parts.forEach((p, i) => ins.run(id, i, p.msg_id, p.size, p.storage_id || storageId || null));
  });
  tx();
  return getNode(id);
}

export function createShare(fileId, expiresAt = null) {
  const id = uid();
  q(`INSERT INTO shares(id,file_id,created_at,expires_at) VALUES (?,?,?,?)`).run(id, fileId, now(), expiresAt);
  return id;
}

export function getShare(shareId) {
  return q(`SELECT * FROM shares WHERE id=?`).get(shareId);
}

export function getNodeShares(fileId) {
  return q(`SELECT id,file_id,created_at,expires_at FROM shares WHERE file_id=? ORDER BY created_at DESC`).all(fileId);
}

export function deleteShare(shareId, ownerId) {
  const share = getShare(shareId);
  if (!share) return false;
  const node = getOwnedNode(share.file_id, ownerId, { allowRoot: false, includeDeleted: true });
  if (!node) return false;
  q(`DELETE FROM shares WHERE id=?`).run(shareId);
  return true;
}
