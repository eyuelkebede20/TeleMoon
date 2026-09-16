import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "telemoon-migration-"));
process.env.DATA_DIR = testDataDir;
process.env.JWT_SECRET = "migration-test-secret-that-is-not-used-in-production";
process.env.NODE_ENV = "test";
process.env.TG_CHANNEL_ID = "-1007654321";

const legacy = new Database(path.join(testDataDir, "telemoon.db"));
legacy.exec(`
  CREATE TABLE users(
    id TEXT PRIMARY KEY,
    handle TEXT UNIQUE NOT NULL,
    pass_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE nodes(
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    mime TEXT,
    owner_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE uploads(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    size INTEGER NOT NULL,
    mime TEXT,
    chunk_size INTEGER NOT NULL,
    user_id TEXT,
    storage_id TEXT,
    created_at INTEGER NOT NULL
  );
  INSERT INTO users VALUES ('legacy-user', 'legacy', 'unused', 1);
  INSERT INTO nodes VALUES ('legacy-file', 'root', 'legacy.txt', 'file', 0, 'text/plain', NULL, 1, 1);
  INSERT INTO uploads VALUES ('legacy-upload', 'pending.txt', 'root', 10, 'text/plain', 5, 'legacy-user', NULL, 2);
`);
legacy.close();

const { q } = await import("../src/db.js");

after(() => fs.rmSync(testDataDir, { recursive: true, force: true }));

test("legacy installations assign the oldest user as owner", () => {
  const user = q(`SELECT role FROM users WHERE id='legacy-user'`).get();
  assert.equal(user.role, "owner");
});

test("legacy ownerless files are claimed instead of remaining globally visible", () => {
  const file = q(`SELECT owner_id,storage_id FROM nodes WHERE id='legacy-file'`).get();
  assert.equal(file.owner_id, "legacy-user");
  assert.ok(file.storage_id);
  const storage = q(`SELECT * FROM storage_connections WHERE id=?`).get(file.storage_id);
  assert.equal(storage.telegram_channel_id, "-1007654321");
});

test("legacy upload sessions gain resumable state without losing progress", () => {
  const upload = q(`SELECT status,updated_at,last_modified,storage_id FROM uploads WHERE id='legacy-upload'`).get();
  assert.equal(upload.status, "active");
  assert.equal(upload.updated_at, 2);
  assert.equal(upload.last_modified, null);
  assert.ok(upload.storage_id);
});
