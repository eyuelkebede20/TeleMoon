import { now, Blob, Chunk, Node, FileVersion } from "./db.js";
import { deleteMessages } from "./telegram.js";
import { startKeepAlive } from "./keepalive.js";

/**
 * Blob Garbage Collection job.
 * Finds unreferenced blobs and removes them after a 30-day grace period.
 */
export async function runBlobGC({ dryRun = false, graceDays = 30 } = {}) {
  const graceMs = graceDays * 24 * 60 * 60 * 1000;
  const cutoff = now() - graceMs;

  // Step 1: Find blob ids that are referenced by live nodes or file_versions
  const referencedByNodes = await Node.distinct("blob_id", { blob_id: { $ne: null }, deleted_at: null });
  const referencedByVersions = await FileVersion.distinct("blob_id", { blob_id: { $ne: null } });
  const referencedSet = new Set([...referencedByNodes, ...referencedByVersions]);

  // Step 2: Get all blobs
  const allBlobs = await Blob.find({}, { id: 1, unreferenced_at: 1 }).lean();

  let newlyMarked = 0;
  const reRefIds = [];

  for (const b of allBlobs) {
    const isReferenced = referencedSet.has(b.id);
    if (!isReferenced && !b.unreferenced_at) {
      // Mark newly unreferenced
      if (!dryRun) {
        await Blob.updateOne({ id: b.id }, { $set: { unreferenced_at: now() } });
      }
      newlyMarked++;
    } else if (isReferenced && b.unreferenced_at) {
      // Clear unreferenced_at for blobs that became referenced again
      reRefIds.push(b.id);
    }
  }

  if (!dryRun && reRefIds.length > 0) {
    await Blob.updateMany({ id: { $in: reRefIds } }, { $set: { unreferenced_at: null } });
  }

  // Step 3: Find eligible blobs older than grace period
  const eligibleBlobs = await Blob.find({
    unreferenced_at: { $ne: null, $lt: cutoff },
  }, { id: 1 }).lean();

  const unrefBlobs = allBlobs.filter((b) => !referencedSet.has(b.id));

  if (dryRun) {
    console.log(`[gc:dryRun] unreferenced: ${unrefBlobs.length}, newlyMarked: ${newlyMarked}, eligibleToDelete: ${eligibleBlobs.length}`);
    return { dryRun: true, unreferenced: unrefBlobs.length, newlyMarked, eligible: eligibleBlobs.length };
  }

  let deletedBlobsCount = 0;
  let deletedMsgsCount = 0;

  for (const b of eligibleBlobs) {
    // Re-verify blob is still unreferenced
    const stillReferencedByNode = await Node.findOne({ blob_id: b.id, deleted_at: null }, { _id: 1 }).lean();
    const stillReferencedByVersion = stillReferencedByNode ? null : await FileVersion.findOne({ blob_id: b.id }, { _id: 1 }).lean();

    if (stillReferencedByNode || stillReferencedByVersion) continue; // rescued

    const chunkRows = await Chunk.find({ blob_id: b.id }, { msg_id: 1 }).lean();
    const msgIdsToDelete = chunkRows.map((r) => r.msg_id);

    await Chunk.deleteMany({ blob_id: b.id });
    await Blob.deleteOne({ id: b.id });
    deletedBlobsCount++;

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
 * MongoDB backup is managed by Atlas — no manual snapshot needed.
 */
export async function createDBSnapshot() {
  console.log("[snapshot] MongoDB backup is managed by Atlas. No manual snapshot required.");
  return null;
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

  // Run DB snapshot daily (no-op for MongoDB Atlas)
  setInterval(() => {
    createDBSnapshot().catch((e) => console.error("[snapshot scheduled error]", e.message));
  }, 24 * 60 * 60 * 1000);

  // Initial dry-run GC check 10 seconds after boot
  setTimeout(() => {
    runBlobGC({ dryRun: true }).catch(() => {});
  }, 10000);
}
