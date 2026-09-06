import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { cfg } from "./config.js";

fs.mkdirSync(cfg.dataDir, { recursive: true });
fs.mkdirSync(path.join(cfg.dataDir, "tmp"), { recursive: true });

export const db = new Database(path.join(cfg.dataDir, "telemoon.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  handle TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes(
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('folder','file')),
  size INTEGER NOT NULL DEFAULT 0,
  mime TEXT,
  owner_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
CREATE TABLE IF NOT EXISTS chunks(
  file_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  msg_id INTEGER NOT NULL,
  size INTEGER NOT NULL,
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
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS upload_parts(
  upload_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  msg_id INTEGER NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY(upload_id, idx)
);
`);

export const now = () => Date.now();
export const uid = () => nanoid(12);
export const q = (sql) => db.prepare(sql);

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

export const getSetting = (k) =>
  q(`SELECT value FROM settings WHERE key=?`).get(k)?.value;
export const setSetting = (k, v) =>
  q(`INSERT INTO settings(key,value) VALUES (?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(k, String(v));

// Root of the virtual filesystem
q(`INSERT OR IGNORE INTO nodes(id,parent_id,name,type,size,created_at,updated_at)
   VALUES ('root', NULL, 'Home', 'folder', 0, ?, ?)`).run(now(), now());

/** Sibling-unique name: "report.pdf" -> "report (2).pdf" on collision. */
export function uniqueName(parentId, name) {
  const exists = (n) =>
    q(`SELECT 1 FROM nodes WHERE parent_id=? AND name=?`).get(parentId, n);
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

export function breadcrumb(id) {
  const trail = [];
  let cur = getNode(id);
  while (cur) {
    trail.unshift({ id: cur.id, name: cur.name });
    cur = cur.parent_id ? getNode(cur.parent_id) : null;
  }
  return trail;
}

export function children(parentId) {
  return q(
    `SELECT id,parent_id,name,type,size,mime,created_at,updated_at
     FROM nodes WHERE parent_id=?
     ORDER BY type='folder' DESC, name COLLATE NOCASE`
  ).all(parentId);
}

/** All node ids in a subtree (inclusive). */
export function subtreeIds(id) {
  return q(
    `WITH RECURSIVE d(id) AS (
       SELECT id FROM nodes WHERE id=?
       UNION ALL
       SELECT n.id FROM nodes n JOIN d ON n.parent_id = d.id
     ) SELECT id FROM d`
  )
    .all(id)
    .map((r) => r.id);
}

/** True if `maybeAncestorId` is an ancestor of (or equal to) `nodeId`. */
export function isAncestor(maybeAncestorId, nodeId) {
  let cur = getNode(nodeId);
  while (cur) {
    if (cur.id === maybeAncestorId) return true;
    cur = cur.parent_id ? getNode(cur.parent_id) : null;
  }
  return false;
}

/** Folder used by the indexer for files posted directly in the channel. */
export function ensureInboxFolder() {
  const found = q(
    `SELECT * FROM nodes WHERE parent_id='root' AND type='folder' AND name=?`
  ).get("Telegram Inbox");
  if (found) return found;
  const id = uid();
  q(`INSERT INTO nodes(id,parent_id,name,type,size,created_at,updated_at)
     VALUES (?,?,?,?,0,?,?)`).run(id, "root", "Telegram Inbox", "folder", now(), now());
  return getNode(id);
}

export function createFileNode({ parentId, name, size, mime, ownerId, parts }) {
  const id = uid();
  const t = now();
  const tx = db.transaction(() => {
    q(`INSERT INTO nodes(id,parent_id,name,type,size,mime,owner_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`).run(
      id, parentId, uniqueName(parentId, name), "file", size, mime || null, ownerId || null, t, t
    );
    const ins = q(`INSERT INTO chunks(file_id,idx,msg_id,size) VALUES (?,?,?,?)`);
    parts.forEach((p, i) => ins.run(id, i, p.msg_id, p.size));
  });
  tx();
  return getNode(id);
}
