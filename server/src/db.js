import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { nanoid } from "nanoid";
import { cfg } from "./config.js";

fs.mkdirSync(cfg.dataDir, { recursive: true });
fs.mkdirSync(path.join(cfg.dataDir, "tmp"), { recursive: true });

export const db = new Database(path.join(cfg.dataDir, "telemoon.db"));
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

export const now = () => Date.now();
export const uid = () => nanoid(12);
export const q = (sql) => db.prepare(sql);

/* ==========================================================================
   SCHEMA INITIALIZATION & MIGRATIONS
   ========================================================================== */

function initBaseTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      handle TEXT UNIQUE NOT NULL,
      pass_hash TEXT NOT NULL,
      channel_id TEXT,
      telegram_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nodes (
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
    CREATE TABLE IF NOT EXISTS chunks (
      file_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      msg_id INTEGER NOT NULL,
      size INTEGER NOT NULL,
      PRIMARY KEY(file_id, idx)
    );
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime TEXT,
      chunk_size INTEGER NOT NULL,
      user_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS upload_parts (
      upload_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      msg_id INTEGER NOT NULL,
      size INTEGER NOT NULL,
      PRIMARY KEY(upload_id, idx)
    );
    CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

function runMigrations() {
  initBaseTables();

  let version = db.pragma("user_version", { simple: true }) || 0;

  if (version < 1) {
    db.transaction(() => {
      // Step 1: Add columns to nodes
      const nodeCols = db.prepare(`PRAGMA table_info(nodes)`).all().map((c) => c.name);
      if (!nodeCols.includes("hash")) db.exec(`ALTER TABLE nodes ADD COLUMN hash TEXT;`);
      if (!nodeCols.includes("version")) db.exec(`ALTER TABLE nodes ADD COLUMN version INTEGER NOT NULL DEFAULT 1;`);
      if (!nodeCols.includes("client_modified_at")) db.exec(`ALTER TABLE nodes ADD COLUMN client_modified_at INTEGER;`);
      if (!nodeCols.includes("deleted_at")) db.exec(`ALTER TABLE nodes ADD COLUMN deleted_at INTEGER;`);
      if (!nodeCols.includes("blob_id")) db.exec(`ALTER TABLE nodes ADD COLUMN blob_id TEXT;`);

      // Step 2: Add columns to chunks
      const chunkCols = db.prepare(`PRAGMA table_info(chunks)`).all().map((c) => c.name);
      if (!chunkCols.includes("blob_id")) db.exec(`ALTER TABLE chunks ADD COLUMN blob_id TEXT;`);

      // Step 3: Add columns to uploads & upload_parts
      const uploadCols = db.prepare(`PRAGMA table_info(uploads)`).all().map((c) => c.name);
      if (!uploadCols.includes("hash")) db.exec(`ALTER TABLE uploads ADD COLUMN hash TEXT;`);
      if (!uploadCols.includes("base_version")) db.exec(`ALTER TABLE uploads ADD COLUMN base_version INTEGER;`);
      if (!uploadCols.includes("replace_node_id")) db.exec(`ALTER TABLE uploads ADD COLUMN replace_node_id TEXT;`);
      if (!uploadCols.includes("on_name_conflict")) db.exec(`ALTER TABLE uploads ADD COLUMN on_name_conflict TEXT;`);
      if (!uploadCols.includes("client_modified_at")) db.exec(`ALTER TABLE uploads ADD COLUMN client_modified_at INTEGER;`);
      if (!uploadCols.includes("device_id")) db.exec(`ALTER TABLE uploads ADD COLUMN device_id TEXT;`);

      const partCols = db.prepare(`PRAGMA table_info(upload_parts)`).all().map((c) => c.name);
      if (!partCols.includes("part_hash")) db.exec(`ALTER TABLE upload_parts ADD COLUMN part_hash TEXT;`);

      // Step 4: Create blobs and file_versions
      db.exec(`
        CREATE TABLE IF NOT EXISTS blobs (
          id              TEXT PRIMARY KEY,
          user_id         TEXT NOT NULL,
          sha256          TEXT,
          size            INTEGER NOT NULL,
          verified        INTEGER NOT NULL DEFAULT 0,
          created_at      INTEGER NOT NULL,
          unreferenced_at INTEGER
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_blobs_dedup
          ON blobs(user_id, sha256, size) WHERE sha256 IS NOT NULL AND verified = 1;

        CREATE TABLE IF NOT EXISTS file_versions (
          node_id            TEXT NOT NULL,
          version            INTEGER NOT NULL,
          blob_id            TEXT NOT NULL,
          size               INTEGER NOT NULL,
          hash               TEXT,
          client_modified_at INTEGER,
          device_id          TEXT,
          created_at         INTEGER NOT NULL,
          PRIMARY KEY (node_id, version)
        );
      `);

      // Step 5: Create sync_journal and devices
      db.exec(`
        CREATE TABLE IF NOT EXISTS sync_journal (
          cursor             INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id            TEXT NOT NULL,
          node_id            TEXT NOT NULL,
          action             TEXT NOT NULL CHECK (action IN ('CREATE','UPDATE','MOVE','DELETE','RESTORE')),
          parent_id          TEXT,
          name               TEXT NOT NULL,
          type               TEXT NOT NULL CHECK (type IN ('file','folder')),
          size               INTEGER NOT NULL DEFAULT 0,
          hash               TEXT,
          version            INTEGER NOT NULL,
          client_modified_at INTEGER,
          device_id          TEXT,
          created_at         INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_journal_user_cursor ON sync_journal(user_id, cursor);
        CREATE INDEX IF NOT EXISTS idx_journal_user_node   ON sync_journal(user_id, node_id, cursor);

        CREATE TABLE IF NOT EXISTS devices (
          id           TEXT PRIMARY KEY,
          user_id      TEXT NOT NULL,
          name         TEXT NOT NULL,
          platform     TEXT NOT NULL CHECK (platform IN ('windows','android','ios','web','other')),
          app_version  TEXT,
          last_cursor  INTEGER NOT NULL DEFAULT 0,
          last_seen_at INTEGER NOT NULL,
          created_at   INTEGER NOT NULL,
          revoked_at   INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

        CREATE TABLE IF NOT EXISTS sse_tickets (
          ticket     TEXT PRIMARY KEY,
          user_id    TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS idempotency_keys (
          key        TEXT PRIMARY KEY,
          user_id    TEXT NOT NULL,
          response   TEXT NOT NULL,
          status     INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);

      // Step 6: Backfill existing files into blobs & file_versions
      const existingFiles = db.prepare(`SELECT * FROM nodes WHERE type = 'file' AND blob_id IS NULL`).all();
      for (const f of existingFiles) {
        const blobId = uid();
        const userId = f.owner_id || "system";
        db.prepare(`
          INSERT INTO blobs(id, user_id, sha256, size, verified, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(blobId, userId, f.hash || null, f.size || 0, f.hash ? 1 : 0, f.created_at || now());

        db.prepare(`UPDATE chunks SET blob_id = ? WHERE file_id = ?`).run(blobId, f.id);
        db.prepare(`
          INSERT OR IGNORE INTO file_versions(node_id, version, blob_id, size, hash, client_modified_at, created_at)
          VALUES (?, 1, ?, ?, ?, ?, ?)
        `).run(f.id, blobId, f.size || 0, f.hash || null, f.client_modified_at || null, f.created_at || now());
        db.prepare(`UPDATE nodes SET blob_id = ?, version = 1 WHERE id = ?`).run(blobId, f.id);
      }

      // Step 7: Seed journal if empty
      const journalCount = db.prepare(`SELECT COUNT(*) as c FROM sync_journal`).get().c;
      if (journalCount === 0) {
        const allNodes = db.prepare(`SELECT * FROM nodes WHERE id != 'root' AND deleted_at IS NULL ORDER BY created_at ASC`).all();
        const insJournal = db.prepare(`
          INSERT INTO sync_journal (user_id, node_id, action, parent_id, name, type, size, hash, version, client_modified_at, created_at)
          VALUES (?, ?, 'CREATE', ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const n of allNodes) {
          insJournal.run(
            n.owner_id || "system",
            n.id,
            n.parent_id || "root",
            n.name,
            n.type,
            n.size || 0,
            n.hash || null,
            n.version || 1,
            n.client_modified_at || null,
            n.created_at || now()
          );
        }
      }

      db.pragma("user_version = 1");
    })();
    console.log("[db] Migration to version 1 complete.");
  }
}

runMigrations();

// Root of the virtual filesystem
q(`INSERT OR IGNORE INTO nodes(id,parent_id,name,type,size,version,created_at,updated_at)
   VALUES ('root', NULL, 'Home', 'folder', 0, 1, ?, ?)`).run(now(), now());

/* ==========================================================================
   SETTINGS & USER QUERIES
   ========================================================================== */

export const getSetting = (k) =>
  q(`SELECT value FROM settings WHERE key=?`).get(k)?.value;

export const setSetting = (k, v) =>
  q(`INSERT INTO settings(key,value) VALUES (?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(k, String(v));

/* ==========================================================================
   VIRTUAL FILESYSTEM & HIERARCHY HELPERS
   ========================================================================== */

/** Sibling-unique name: "report.pdf" -> "report (2).pdf" on collision. */
export function uniqueName(parentId, name, ownerId) {
  const exists = (n) =>
    q(`SELECT 1 FROM nodes WHERE parent_id=? AND name=? AND (owner_id=? OR owner_id IS NULL) AND deleted_at IS NULL`).get(parentId, n, ownerId);
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

export function children(parentId, ownerId) {
  return q(
    `SELECT id,parent_id,name,type,size,mime,created_at,updated_at,hash,version,deleted_at,blob_id
     FROM nodes WHERE parent_id=? AND (owner_id=? OR owner_id IS NULL) AND deleted_at IS NULL
     ORDER BY type='folder' DESC, name COLLATE NOCASE`
  ).all(parentId, ownerId);
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
export function ensureInboxFolder(ownerId) {
  let found;
  if (ownerId) {
    found = q(
      `SELECT * FROM nodes WHERE parent_id='root' AND type='folder' AND name=? AND owner_id=? AND deleted_at IS NULL`
    ).get("Telegram Inbox", ownerId);
  }
  if (!found) {
    found = q(
      `SELECT * FROM nodes WHERE parent_id='root' AND type='folder' AND name=? AND (owner_id=? OR owner_id IS NULL) AND deleted_at IS NULL`
    ).get("Telegram Inbox", ownerId || null);
  }
  if (found) return found;
  const id = uid();
  const t = now();
  const tx = db.transaction(() => {
    q(`INSERT INTO nodes(id,parent_id,name,type,size,version,owner_id,created_at,updated_at)
       VALUES (?,?,?,?,0,1,?,?,?)`).run(id, "root", "Telegram Inbox", "folder", ownerId || null, t, t);
    appendJournal({
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
  });
  tx();
  return getNode(id);
}

export function getIndexedMessageIds(ownerId) {
  const rows = q(`
    SELECT DISTINCT c.msg_id
    FROM chunks c
    JOIN nodes n ON c.file_id = n.id
    WHERE (? IS NULL OR n.owner_id = ? OR n.owner_id IS NULL)
  `).all(ownerId || null, ownerId || null);
  return new Set(rows.map((r) => r.msg_id));
}

/* ==========================================================================
   JOURNAL & SYNC HELPERS
   ========================================================================== */

export function appendJournal({
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
  const info = q(`
    INSERT INTO sync_journal (
      user_id, node_id, action, parent_id, name, type, size, hash,
      version, client_modified_at, device_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    nodeId,
    action,
    parentId,
    name,
    type,
    size,
    hash,
    version,
    clientModifiedAt,
    deviceId,
    createdAt
  );
  return Number(info.lastInsertRowid);
}

export function getJournalHead(userId) {
  const row = q(`
    SELECT cursor FROM sync_journal
    WHERE (user_id = ? OR user_id = 'system')
    ORDER BY cursor DESC LIMIT 1
  `).get(userId);
  return row ? row.cursor : 0;
}

/**
 * Coalesced delta feed: returns latest state per node with cursor > afterCursor.
 */
export function getDelta({ userId, cursor = 0, limit = 500 }) {
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const rows = q(`
    SELECT * FROM sync_journal
    WHERE (user_id = ? OR user_id = 'system') AND cursor > ?
    ORDER BY cursor ASC LIMIT ?
  `).all(userId, Number(cursor), lim + 1);

  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;

  // Coalesce: if multiple entries exist for the same node in this page, keep the latest
  const nodeMap = new Map();
  let maxCursor = Number(cursor);

  for (const r of page) {
    if (r.cursor > maxCursor) maxCursor = r.cursor;
    nodeMap.set(r.node_id, r);
  }

  // If no changes in page, head cursor is the current journal head
  if (page.length === 0) {
    maxCursor = getJournalHead(userId);
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

  return {
    cursor: maxCursor,
    hasMore,
    changes,
  };
}

/**
 * Snapshot for initial sync and 410 resync.
 */
export function getSnapshot({ userId, afterNodeId = null, limit = 500 }) {
  const headCursor = getJournalHead(userId);
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 1000);

  let query = `
    SELECT id, parent_id, name, type, size, mime, hash, version, client_modified_at, created_at, updated_at
    FROM nodes
    WHERE (owner_id = ? OR owner_id IS NULL) AND deleted_at IS NULL AND id != 'root'
  `;
  const params = [userId];

  if (afterNodeId) {
    query += ` AND id > ? `;
    params.push(afterNodeId);
  }

  query += ` ORDER BY id ASC LIMIT ? `;
  params.push(lim + 1);

  const rows = q(query).all(...params);
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

export function findVerifiedBlob(userId, sha256, size) {
  if (!sha256 || !size) return null;
  return q(`
    SELECT * FROM blobs
    WHERE user_id = ? AND sha256 = ? AND size = ? AND verified = 1
  `).get(userId, sha256, size);
}

export function getBlob(blobId) {
  return q(`SELECT * FROM blobs WHERE id = ?`).get(blobId);
}

/* ==========================================================================
   NODE MUTATIONS (TRANSACTIONAL + JOURNALED)
   ========================================================================== */

export function createFolderNode({ parentId, name, ownerId, deviceId }) {
  const id = uid();
  const t = now();
  let cursor;
  const tx = db.transaction(() => {
    const safeName = uniqueName(parentId, name, ownerId);
    q(`INSERT INTO nodes(id,parent_id,name,type,size,version,owner_id,created_at,updated_at)
       VALUES (?,?,?,?,0,1,?,?,?)`).run(id, parentId, safeName, "folder", ownerId || null, t, t);
    cursor = appendJournal({
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
  });
  tx();
  return { node: getNode(id), cursor };
}

export function createFileNode({
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
  let finalNode;
  let cursor;

  const tx = db.transaction(() => {
    if (replaceNodeId) {
      const existing = getNode(replaceNodeId);
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
      q(`
        INSERT INTO blobs(id, user_id, sha256, size, verified, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(targetBlobId, ownerId || "system", hash, size, hash ? 1 : 0, t);

      // Insert chunks pointing to targetBlobId
      const insChunk = q(`INSERT INTO chunks(file_id, idx, msg_id, size, blob_id) VALUES (?,?,?,?,?)`);
      parts.forEach((p, i) => insChunk.run(nodeId, i, p.msg_id, p.size, targetBlobId));
    } else {
      // Reusing existing blob (dedup hit or version restore)
      // Copy chunk mappings if needed
      const existingChunks = q(`SELECT * FROM chunks WHERE blob_id = ? ORDER BY idx`).all(targetBlobId);
      const insChunk = q(`INSERT OR REPLACE INTO chunks(file_id, idx, msg_id, size, blob_id) VALUES (?,?,?,?,?)`);
      existingChunks.forEach((c) => insChunk.run(nodeId, c.idx, c.msg_id, c.size, targetBlobId));
    }

    // Save version history
    q(`
      INSERT OR REPLACE INTO file_versions(node_id, version, blob_id, size, hash, client_modified_at, device_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(nodeId, version, targetBlobId, size, hash, clientModifiedAt, deviceId, t);

    // Upsert node
    if (replaceNodeId) {
      q(`
        UPDATE nodes SET
          size = ?, mime = ?, hash = ?, version = ?, client_modified_at = ?,
          blob_id = ?, updated_at = ?, deleted_at = NULL
        WHERE id = ?
      `).run(size, mime || null, hash, version, clientModifiedAt, targetBlobId, t, nodeId);
    } else {
      const safeName = uniqueName(parentId, name, ownerId);
      q(`
        INSERT INTO nodes(id, parent_id, name, type, size, mime, owner_id, hash, version, client_modified_at, blob_id, created_at, updated_at)
        VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(nodeId, parentId, safeName, size, mime || null, ownerId || null, hash, version, clientModifiedAt, targetBlobId, t, t);
    }

    finalNode = getNode(nodeId);

    cursor = appendJournal({
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
  });

  tx();
  return { node: finalNode, cursor };
}

export function trashNode(id, ownerId, deviceId, ifMatchVersion = null) {
  const node = getNode(id);
  if (!node || node.id === "root") throw Object.assign(new Error("Node not found"), { status: 404 });
  if (ifMatchVersion !== null && ifMatchVersion !== undefined && node.version !== Number(ifMatchVersion)) {
    throw Object.assign(new Error("Version conflict on delete"), {
      status: 409,
      code: "VERSION_CONFLICT",
      current: { version: node.version },
    });
  }

  const t = now();
  const ids = subtreeIds(node.id);
  const ph = ids.map(() => "?").join(",");
  let cursor;

  const tx = db.transaction(() => {
    // Soft delete all nodes in subtree
    q(`UPDATE nodes SET deleted_at = ?, updated_at = ? WHERE id IN (${ph})`).run(t, t, ...ids);

    const fresh = getNode(node.id);
    cursor = appendJournal({
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
  });

  tx();
  return { ok: true, trashed: ids.length, cursor };
}

export function restoreNode(id, ownerId, deviceId) {
  const node = getNode(id);
  if (!node || node.id === "root") throw Object.assign(new Error("Node not found"), { status: 404 });
  if (!node.deleted_at) return { node, cursor: getJournalHead(ownerId) };

  const t = now();
  let cursor;
  let freshNode;

  const tx = db.transaction(() => {
    // If parent is trashed or missing, restore to root
    let parentId = node.parent_id;
    const parent = getNode(parentId);
    if (!parent || parent.deleted_at) {
      parentId = "root";
    }

    const safeName = uniqueName(parentId, node.name, ownerId);
    const newVersion = (node.version || 1) + 1;

    q(`
      UPDATE nodes SET
        parent_id = ?, name = ?, deleted_at = NULL, version = ?, updated_at = ?
      WHERE id = ?
    `).run(parentId, safeName, newVersion, t, node.id);

    // Also restore descendants if it was a folder
    if (node.type === "folder") {
      const ids = subtreeIds(node.id);
      const ph = ids.map(() => "?").join(",");
      q(`UPDATE nodes SET deleted_at = NULL, updated_at = ? WHERE id IN (${ph})`).run(t, ...ids);
    }

    freshNode = getNode(node.id);

    cursor = appendJournal({
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
  });

  tx();
  return { node: freshNode, cursor };
}

export function updateNode({ id, name, parentId, ownerId, deviceId, ifMatchVersion = null }) {
  const node = getNode(id);
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
  let cursor;
  let freshNode;

  const tx = db.transaction(() => {
    if (parentId !== undefined && parentId !== node.parent_id) {
      const target = getNode(parentId);
      if (!target || target.type !== "folder" || target.deleted_at) {
        throw Object.assign(new Error("Target folder not found"), { status: 404 });
      }
      if (node.type === "folder" && isAncestor(node.id, target.id)) {
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

    const safeName = uniqueName(targetParentId, targetName, ownerId);
    const newVersion = (node.version || 1) + 1;

    q(`
      UPDATE nodes SET parent_id = ?, name = ?, version = ?, updated_at = ?
      WHERE id = ?
    `).run(targetParentId, safeName, newVersion, t, node.id);

    freshNode = getNode(node.id);

    cursor = appendJournal({
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
  });

  tx();
  return { node: freshNode, cursor };
}

export function getFileVersions(nodeId) {
  return q(`
    SELECT version, blob_id, size, hash, client_modified_at, device_id, created_at
    FROM file_versions
    WHERE node_id = ?
    ORDER BY version DESC
  `).all(nodeId);
}

export function getTrash(ownerId) {
  return q(`
    SELECT id, parent_id, name, type, size, mime, hash, version, deleted_at, updated_at
    FROM nodes
    WHERE (owner_id = ? OR owner_id IS NULL) AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `).all(ownerId);
}

/* ==========================================================================
   DEVICE REGISTRATION & SSE TICKETS
   ========================================================================== */

export function registerDevice({ id, userId, name, platform, appVersion }) {
  const t = now();
  const devId = id || uid();
  q(`
    INSERT INTO devices(id, user_id, name, platform, app_version, last_seen_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      platform = excluded.platform,
      app_version = excluded.app_version,
      last_seen_at = excluded.last_seen_at
  `).run(devId, userId, name || "Unnamed Device", platform || "other", appVersion || null, t, t);
  return q(`SELECT * FROM devices WHERE id = ?`).get(devId);
}

export function updateDeviceCursor(deviceId, cursor) {
  q(`UPDATE devices SET last_cursor = ?, last_seen_at = ? WHERE id = ?`).run(Number(cursor), now(), deviceId);
}

export function getDevices(userId) {
  return q(`SELECT * FROM devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC`).all(userId);
}

export function revokeDevice(deviceId, userId) {
  q(`UPDATE devices SET revoked_at = ? WHERE id = ? AND user_id = ?`).run(now(), deviceId, userId);
  return { ok: true };
}

export function createSSETicket(userId) {
  const ticket = crypto.randomBytes(24).toString("hex");
  q(`INSERT INTO sse_tickets(ticket, user_id, created_at) VALUES (?, ?, ?)`).run(ticket, userId, now());
  return ticket;
}

export function verifyAndConsumeSSETicket(ticket) {
  const t = now();
  const row = q(`SELECT * FROM sse_tickets WHERE ticket = ? AND created_at > ?`).get(ticket, t - 60000); // 1 min validity
  if (!row) return null;
  q(`DELETE FROM sse_tickets WHERE ticket = ?`).run(ticket);
  return row.user_id;
}

/* ==========================================================================
   SHARE LINKS
   ========================================================================== */

export function createShare(fileId) {
  const id = uid();
  q(`INSERT INTO shares(id,file_id,created_at) VALUES (?,?,?)`).run(id, fileId, now());
  return id;
}

export function getShare(shareId) {
  return q(`SELECT * FROM shares WHERE id=?`).get(shareId);
}
