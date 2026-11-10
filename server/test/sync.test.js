import assert from "node:assert";
import bcrypt from "bcryptjs";
import {
  db, createFolderNode, createFileNode, updateNode, trashNode,
  restoreNode, getDelta, getSnapshot, findVerifiedBlob,
  createDropLink, getDropLinkByCode, getDropLinkById,
  updateDropLink, deleteDropLink,
} from "../src/db.js";
import {
  learnPublicUrl, getKeepAliveStatus, updateKeepAliveConfig, stopKeepAlive,
} from "../src/keepalive.js";

console.log("Running server sync engine tests...");

const userId = "test-user-" + Date.now();

// 1. Create Folder
const folder1 = createFolderNode({
  parentId: "root",
  name: "Documents",
  ownerId: userId,
  deviceId: "test-dev-1",
});
assert.ok(folder1.node.id, "Folder created");
assert.equal(folder1.node.version, 1, "Folder version starts at 1");
assert.ok(folder1.cursor > 0, "Folder cursor assigned");

// 2. Create File
const file1 = createFileNode({
  parentId: folder1.node.id,
  name: "Report.txt",
  size: 1024,
  mime: "text/plain",
  ownerId: userId,
  parts: [{ msg_id: 1001, size: 1024 }],
  hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  clientModifiedAt: 1700000000000,
  deviceId: "test-dev-1",
});
assert.ok(file1.node.id, "File created");
assert.equal(file1.node.version, 1, "File version starts at 1");
assert.equal(file1.node.size, 1024);
assert.ok(file1.cursor > folder1.cursor, "File cursor monotonically increases");

// 3. Test Delta Feed
const delta1 = getDelta({ userId, cursor: 0, limit: 10 });
assert.ok(delta1.changes.length >= 2, "Delta contains at least folder and file");
const deltaFile = delta1.changes.find((c) => c.nodeId === file1.node.id);
assert.ok(deltaFile, "Delta includes file");
assert.equal(deltaFile.action, "CREATE");
assert.equal(deltaFile.version, 1);

// 4. Test Deduplication
const verifiedBlob = findVerifiedBlob(userId, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", 1024);
assert.ok(verifiedBlob, "Blob was indexed and verified");

const dedupFile = createFileNode({
  parentId: folder1.node.id,
  name: "Report_Copy.txt",
  size: 1024,
  mime: "text/plain",
  ownerId: userId,
  hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  blobId: verifiedBlob.id,
  deviceId: "test-dev-2",
});
assert.equal(dedupFile.node.blob_id, verifiedBlob.id, "Deduplication reused existing blob!");

// 5. Test Update with Optimistic Locking
const updatedFile = updateNode({
  id: file1.node.id,
  name: "Report_Renamed.txt",
  ownerId: userId,
  deviceId: "test-dev-1",
  ifMatchVersion: 1,
});
assert.equal(updatedFile.node.name, "Report_Renamed.txt");
assert.equal(updatedFile.node.version, 2, "Version bumped on update");

// Test Version Conflict
assert.throws(() => {
  updateNode({
    id: file1.node.id,
    name: "Report_Stale.txt",
    ownerId: userId,
    deviceId: "test-dev-1",
    ifMatchVersion: 1, // Stale version! Current is 2
  });
}, (err) => err.code === "VERSION_CONFLICT", "Throws VERSION_CONFLICT on stale update");

// 6. Test Soft Delete
const trashed = trashNode(file1.node.id, userId, "test-dev-1", 2);
assert.ok(trashed.ok, "File soft-deleted");

const deltaAfterTrash = getDelta({ userId, cursor: updatedFile.cursor, limit: 10 });
const trashChange = deltaAfterTrash.changes.find((c) => c.nodeId === file1.node.id);
assert.ok(trashChange, "Trash emitted in delta");
assert.equal(trashChange.action, "DELETE");
assert.equal(trashChange.deleted, true);

// 7. Test Restore
const restored = restoreNode(file1.node.id, userId, "test-dev-1");
assert.equal(restored.node.deleted_at, null, "File restored");
assert.equal(restored.node.version, 3, "Version bumped on restore");

// 8. Test Drop Links (Send a Link)
const drop1 = createDropLink({
  folderId: folder1.node.id,
  ownerId: userId,
  title: "Client Drop",
});
assert.ok(drop1.id, "Drop link created");
assert.ok(/^\d{4,5}$/.test(drop1.code), "Generated 4-digit code: " + drop1.code);
assert.equal(drop1.folder_id, folder1.node.id);
assert.equal(drop1.owner_id, userId);

// Query by code
const foundDrop = getDropLinkByCode(drop1.code);
assert.ok(foundDrop, "Drop link found by 4-digit code");
assert.equal(foundDrop.id, drop1.id);

// Custom slug & Password PIN
const customSlug = "qq-" + Date.now();
const drop2 = createDropLink({
  folderId: folder1.node.id,
  ownerId: userId,
  code: customSlug,
  password: "1234",
  title: "Secret Inbound",
});
assert.equal(drop2.code, customSlug);
assert.ok(drop2.password_hash, "Password hash generated");
assert.ok(bcrypt.compareSync("1234", drop2.password_hash), "Password matches hash");

// Update drop link
const updatedDrop = updateDropLink(drop2.id, userId, {
  title: "Updated Title",
  is_active: 0,
});
assert.equal(updatedDrop.title, "Updated Title");
assert.equal(updatedDrop.is_active, 0, "Deactivated drop link");

// Delete drop link
const delRes = deleteDropLink(drop1.id, userId);
assert.equal(delRes.ok, true, "Deleted drop link");
assert.equal(getDropLinkById(drop1.id), undefined);

// 9. Test Keep-Alive / Auto-Ping Engine
learnPublicUrl("http://localhost:3000"); // should be ignored
assert.ok(!getKeepAliveStatus().targetUrl?.includes("localhost"), "Localhost was not learned");

learnPublicUrl("https://telemoon.ethiodeploy.com");
const kaStatus = getKeepAliveStatus();
assert.equal(kaStatus.targetUrl, "https://telemoon.ethiodeploy.com/api/ping", "Learned and normalized public URL");

updateKeepAliveConfig({ enabled: true, intervalMin: 5, url: "https://my-drive.up.railway.app" });
const kaUpdated = getKeepAliveStatus();
assert.equal(kaUpdated.targetUrl, "https://my-drive.up.railway.app/api/ping", "Custom URL configured");
assert.equal(kaUpdated.intervalMin, 5, "Interval updated to 5m");
assert.equal(kaUpdated.enabled, true);
stopKeepAlive();

console.log("All server sync engine, drop link & keep-alive tests PASSED successfully!");
