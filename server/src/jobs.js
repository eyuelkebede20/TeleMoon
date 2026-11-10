import path from "node:path";
import fs from "node:fs";
import { db, q, now } from "./db.js";
import { cfg } from "./config.js";
import { deleteMessages } from "./telegram.js";
import { startKeepAlive } from "./keepalive.js";

/**
 * Blob Garbage Collection job.
 * Finds unreferenced blobs and removes them after a 30-day grace period.
 */
export async function runBlobGC({ dryRun = false, graceDays = 30 } = {}) {
  const graceMs = graceDays * 24 * 60 * 60 * 1000;
  const cutoff = now() - graceMs;

  // Step 1: Mark newly unreferenced blobs with unreferenced_at = now()
  const unrefBlobs = q(`
    SELECT b.id, b.unreferenced_at
    FROM blobs b
    WHERE b.id NOT IN (SELECT blob_id FROM nodes WHERE blob_id IS NOT NULL AND deleted_at IS NULL)
      AND b.id NOT IN (SELECT blob_id FROM file_versions WHERE blob_id IS NOT NULL)
  `).all();

  let newlyMarked = 0;
  for (const b of unrefBlobs) {
    if (!b.unreferenced_at) {
      if (!dryRun) {
        q(`UPDATE blobs SET unreferenced_at = ? WHERE id = ?`).run(now(), b.id);
      }
      newlyMarked++;
    }
  }

  // Step 2: Clear unreferenced_at for blobs that became referenced again
  const reRefBlobs = q(`
    SELECT b.id
    FROM blobs b
    WHERE b.unreferenced_at IS NOT NULL
      AND (
        b.id IN (SELECT blob_id FROM nodes WHERE blob_id IS NOT NULL AND deleted_at IS NULL)
        OR b.id IN (SELECT blob_id FROM file_versions WHERE blob_id IS NOT NULL)
      )
  `).all();

  for (const b of reRefBlobs) {
    if (!dryRun) {
      q(`UPDATE blobs SET unreferenced_at = NULL WHERE id = ?`).run(b.id);
    }
  }

  // Step 3: Find eligible blobs older than grace period
  const eligibleBlobs = q(`
    SELECT id FROM blobs
    WHERE unreferenced_at IS NOT NULL AND unreferenced_at < ?
  `).all(cutoff);

  if (dryRun) {
    console.log(`[gc:dryRun] unreferenced: ${unrefBlobs.length}, newlyMarked: ${newlyMarked}, eligibleToDelete: ${eligibleBlobs.length}`);
    return { dryRun: true, unreferenced: unrefBlobs.length, newlyMarked, eligible: eligibleBlobs.length };
  }

  let deletedBlobsCount = 0;
  let deletedMsgsCount = 0;

  for (const b of eligibleBlobs) {
    // Re-verify inside a transaction
    let msgIdsToDelete = [];
    const tx = db.transaction(() => {
      const isReferenced = q(`
        SELECT 1 FROM (
          SELECT blob_id FROM nodes WHERE blob_id = ? AND deleted_at IS NULL
          UNION ALL
          SELECT blob_id FROM file_versions WHERE blob_id = ?
        ) LIMIT 1
      `).get(b.id, b.id);

      if (isReferenced) return; // rescued

      const chunkRows = q(`SELECT msg_id FROM chunks WHERE blob_id = ?`).all(b.id);
      msgIdsToDelete = chunkRows.map((r) => r.msg_id);

      q(`DELETE FROM chunks WHERE blob_id = ?`).run(b.id);
      q(`DELETE FROM blobs WHERE id = ?`).run(b.id);
      deletedBlobsCount++;
    });

    tx();

    if (msgIdsToDelete.length > 0) {
      deletedMsgsCount += msgIdsToDelete.length;
      try {
        await deleteMessages(msgIdsToDelete);
      } catch (err) {
        console.warn(`[gc] deleteMessages failed for blob ${b.id}:`, err.message);
      }
    }
  }

  console.log(`[gc] deleted ${deletedBlobsCount} blobs and ${deletedMsgsCount} Telegram messages.`);
  return { deletedBlobs: deletedBlobsCount, deletedMessages: deletedMsgsCount };
}

/**
 * Creates a consistent SQLite backup using VACUUM INTO.
 */
export async function createDBSnapshot() {
  const snapshotDir = path.join(cfg.dataDir, "snapshots");
  fs.mkdirSync(snapshotDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destPath = path.join(snapshotDir, `telemoon_${timestamp}.db`);

  try {
    db.backup(destPath);
    console.log(`[snapshot] created DB snapshot at ${destPath}`);

    // Prune old snapshots, keep last 7
    const files = fs.readdirSync(snapshotDir)
      .filter((f) => f.startsWith("telemoon_") && f.endsWith(".db"))
      .sort();
    if (files.length > 7) {
      for (const f of files.slice(0, files.length - 7)) {
        fs.unlinkSync(path.join(snapshotDir, f));
      }
    }
    return destPath;
  } catch (err) {
    console.error(`[snapshot error]`, err.message);
    throw err;
  }
}

/**
 * Start background maintenance schedules.
 */
export function startBackgroundJobs() {
  // Auto-ping keep-alive (prevents cloud container idle sleep)
  startKeepAlive();

  // Run GC daily (24h)
  setInterval(() => {
    runBlobGC().catch((e) => console.error("[gc scheduled error]", e.message));
  }, 24 * 60 * 60 * 1000);

  // Run DB snapshot daily
  setInterval(() => {
    createDBSnapshot().catch((e) => console.error("[snapshot scheduled error]", e.message));
  }, 24 * 60 * 60 * 1000);

  // Initial dry-run GC check 10 seconds after boot
  setTimeout(() => {
    runBlobGC({ dryRun: true }).catch(() => {});
  }, 10000);
}
