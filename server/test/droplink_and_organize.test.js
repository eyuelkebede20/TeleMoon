import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import express from "express";
import telegram from "telegram";
import bigInt from "big-integer";
import { api } from "../src/routes.js";
import { cfg } from "../src/config.js";
import {
  connectDB, User, Node, Chunk, Upload, UploadPart, Blob, FileVersion,
  SyncJournal, DropLink, TgEntity, createFolderNode, createFileNode,
} from "../src/db.js";
import { tg } from "../src/telegram.js";

const { Api } = telegram;

console.log("Running Drop Link (Upload Key) & Auto-Organize tests...");

await connectDB();
await fsp.mkdir(path.join(cfg.dataDir, "tmp"), { recursive: true });

const suffix = Math.random().toString(36).slice(2, 8);
const handle = `droptest_${suffix}`;
const smallKey1 = `k${suffix.slice(0, 2)}`; // 3-char slug created with leading '#'
const singleCharKey = suffix[0]; // 1-char slug
const pinKey = `${Math.floor(1000 + Math.random() * 9000)}`; // 4-digit PIN key
const testChanId = `888777${Math.floor(1000 + Math.random() * 8999)}`;

let createdUserId = null;

const app = express();
app.use(express.json());
app.use("/api", api);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const baseUrl = `http://localhost:${server.address().port}/api`;

async function req(method, urlPath, body = null, headers = {}) {
  const h = { ...headers };
  let payload;
  if (body !== null && !(body instanceof Buffer) && !(body instanceof Uint8Array)) {
    h["Content-Type"] = h["Content-Type"] || "application/json";
    payload = JSON.stringify(body);
  } else {
    payload = body ?? undefined;
  }
  const res = await fetch(`${baseUrl}${urlPath}`, { method, headers: h, body: payload });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

let exitCode = 0;
try {
  // Mock tg.client online WITHOUT global tg.ready/tg.channel (multi-user per-owner peer mode)
  let nextMsgId = 90001;
  const fakeEntity = new Api.Channel({
    id: bigInt(testChanId),
    title: "Drop Key Test Channel",
    accessHash: bigInt("445566778899"),
    date: 1700000000,
    megagroup: true,
    photo: new Api.ChatPhotoEmpty(),
  });

  tg.client = {
    getEntity: async (ref) => {
      if (String(ref).includes(testChanId) || ref?.channelId?.toString?.() === testChanId) {
        return fakeEntity;
      }
      throw new Error("Entity not found");
    },
    getInputEntity: async (ref) => {
      if (String(ref).includes(testChanId) || ref?.channelId?.toString?.() === testChanId) {
        return new Api.InputPeerChannel({
          channelId: fakeEntity.id,
          accessHash: fakeEntity.accessHash,
        });
      }
      throw new Error("InputEntity not found");
    },
    invoke: async () => ({}),
    getDialogs: async () => [{ entity: fakeEntity }],
    sendFile: async () => ({ id: nextMsgId++ }),
  };
  tg.mode = "user";
  tg.ready = false;
  tg.channel = null;
  tg.error = null;

  const authHeader = (tok) => ({ Authorization: `Bearer ${tok}` });

  // 1. Signup user (initially NO channel linked)
  const signup = await req("POST", "/auth/signup", { handle, password: "password123!" });
  assert.equal(signup.status, 201);
  const token = signup.data.token;
  createdUserId = signup.data.user.id;

  // Create test subfolder
  const { node: dropFolder } = await createFolderNode({
    parentId: "root",
    name: `DropBox_${suffix}`,
    ownerId: createdUserId,
  });

  // 2. Create 1-char key on root, '#'-prefixed key on subfolder, and password-protected 4-digit PIN key
  const create1 = await req(
    "POST",
    "/folders/root/drop-links",
    { code: singleCharKey, title: "Quick Root Key" },
    authHeader(token)
  );
  // 1-char random key could theoretically collide if unlucky, handle retry or assert valid if unique
  if (create1.ok) {
    assert.equal(create1.data.dropLink.code, singleCharKey);
  }

  const create2 = await req(
    "POST",
    `/folders/${dropFolder.id}/drop-links`,
    { code: `#${smallKey1}`, title: "No Pass Key" },
    authHeader(token)
  );
  assert.equal(create2.status, 200);
  assert.equal(create2.data.dropLink.code, smallKey1, "Leading '#' must be stripped");

  const createPin = await req(
    "POST",
    `/folders/${dropFolder.id}/drop-links`,
    { code: pinKey, password: " 4242 ", title: "PIN Key" },
    authHeader(token)
  );
  assert.equal(createPin.status, 200);
  assert.equal(createPin.data.dropLink.code, pinKey);

  // 3. Verify GET /api/drop-links lists owner's keys across folders
  const allKeys = await req("GET", "/drop-links", null, authHeader(token));
  assert.equal(allKeys.status, 200);
  assert.ok(allKeys.data.dropLinks.some((k) => k.code === smallKey1 && k.folder_name === dropFolder.name));
  assert.ok(allKeys.data.dropLinks.some((k) => k.code === pinKey));

  // 4. Public GET /api/drop/:code before owner links storage channel -> storageReady === false
  const infoBefore = await req("GET", `/drop/${encodeURIComponent("#" + smallKey1)}`);
  assert.equal(infoBefore.status, 200);
  assert.equal(infoBefore.data.code, smallKey1);
  assert.equal(infoBefore.data.storageReady, false);
  assert.ok(infoBefore.data.ticket, "Passwordless key issues drop ticket right away");

  // Root drop info should say Home (Drive Root) if created
  if (create1.ok) {
    const rootInfo = await req("GET", `/drop/${encodeURIComponent(singleCharKey)}`);
    assert.equal(rootInfo.status, 200);
    assert.equal(rootInfo.data.folderName, "Home (Drive Root)");
  }

  // Attempting part upload before owner links channel must fail clearly with 400 (never 500 or false global ready block)
  const payloadBytes = Buffer.from("hello telemoon upload key!");
  const payloadHash = crypto.createHash("sha256").update(payloadBytes).digest("hex");
  const initBefore = await req(
    "POST",
    `/drop/${smallKey1}/uploads`,
    { name: "hello.txt", size: payloadBytes.length, mime: "text/plain", hash: payloadHash },
    { "X-Drop-Ticket": infoBefore.data.ticket }
  );
  assert.equal(initBefore.status, 200);
  const putBefore = await req(
    "PUT",
    `/drop/${smallKey1}/uploads/${initBefore.data.id}/parts/0`,
    payloadBytes,
    {
      "Content-Type": "application/octet-stream",
      "X-Drop-Ticket": infoBefore.data.ticket,
      "X-Part-SHA256": payloadHash,
    }
  );
  assert.equal(putBefore.status, 400);
  assert.match(putBefore.data.error, /not linked a Telegram storage channel/i);

  // 5. Verify PIN password with surrounding whitespace & rejection on bad PIN
  const infoPin = await req("GET", `/drop/${pinKey}`);
  assert.equal(infoPin.status, 200);
  assert.equal(infoPin.data.hasPassword, true);
  assert.equal(infoPin.data.ticket, null);

  const badVerify = await req("POST", `/drop/${pinKey}/verify`, { password: "wrong" });
  assert.equal(badVerify.status, 401);

  const goodVerify = await req("POST", `/drop/${pinKey}/verify`, { password: "4242" });
  assert.equal(goodVerify.status, 200);
  assert.ok(goodVerify.data.ticket);

  // 6. Owner links channel via t.me/c/ link while global tg.ready REMAINS false
  const linkRes = await req(
    "POST",
    "/tg/connect",
    { link: `https://t.me/c/${testChanId}/10` },
    authHeader(token)
  );
  assert.equal(linkRes.status, 200);

  // Re-fetch public drop info -> storageReady must now be true even though global tg.ready === false!
  tg.ready = false;
  tg.channel = null;
  const infoReady = await req("GET", `/drop/${pinKey}`);
  assert.equal(infoReady.status, 200);
  assert.equal(infoReady.data.storageReady, true);

  // Full drop upload using verified ticket even when tg.ready === false
  const initAfter = await req(
    "POST",
    `/drop/${pinKey}/uploads`,
    { name: "photo.png", size: payloadBytes.length, mime: "image/png", hash: payloadHash },
    { "X-Drop-Ticket": goodVerify.data.ticket }
  );
  assert.equal(initAfter.status, 200);
  assert.equal(initAfter.data.dedup, false);

  const putAfter = await req(
    "PUT",
    `/drop/${pinKey}/uploads/${initAfter.data.id}/parts/0`,
    payloadBytes,
    {
      "Content-Type": "application/octet-stream",
      "X-Drop-Ticket": goodVerify.data.ticket,
      "X-Part-SHA256": payloadHash,
    }
  );
  assert.equal(putAfter.status, 200);
  assert.ok(putAfter.data.msgId);

  const compAfter = await req(
    "POST",
    `/drop/${pinKey}/uploads/${initAfter.data.id}/complete`,
    {},
    { "X-Drop-Ticket": goodVerify.data.ticket }
  );
  assert.equal(compAfter.status, 200);
  assert.equal(compAfter.data.ok, true);
  assert.equal(compAfter.data.node.name, "photo.png");

  const updatedPinDoc = await DropLink.findOne({ code: pinKey }).lean();
  assert.equal(updatedPinDoc.upload_count, 1);

  // 7. Auto-organize files inside dropFolder into Images, Code, Documents
  await createFileNode({
    parentId: dropFolder.id,
    name: "app.dart",
    size: 120,
    mime: "text/plain",
    ownerId: createdUserId,
    parts: [{ msg_id: 90901, size: 120 }],
  });
  await createFileNode({
    parentId: dropFolder.id,
    name: "invoice.pdf",
    size: 240,
    mime: "application/pdf",
    ownerId: createdUserId,
    parts: [{ msg_id: 90902, size: 240 }],
  });

  const orgRes = await req(
    "POST",
    `/folders/${dropFolder.id}/auto-organize`,
    {},
    authHeader(token)
  );
  assert.equal(orgRes.status, 200);
  assert.equal(orgRes.data.ok, true);
  assert.equal(orgRes.data.organized, 3);
  assert.ok(orgRes.data.categories.includes("Images"));
  assert.ok(orgRes.data.categories.includes("Code"));
  assert.ok(orgRes.data.categories.includes("Documents"));

  const folderChildren = await Node.find({ parent_id: dropFolder.id, deleted_at: null }).lean();
  assert.ok(folderChildren.every((c) => c.type === "folder"), "All loose files were moved into category folders");

  console.log("All Drop Link & Auto-Organize tests PASSED successfully!");
} catch (err) {
  console.error("Test failed:", err);
  exitCode = 1;
} finally {
  if (createdUserId) {
    const userNodes = await Node.find({ owner_id: createdUserId }, { id: 1 }).lean();
    const nodeIds = userNodes.map((n) => n.id);
    const userUploads = await Upload.find({ user_id: createdUserId }, { id: 1 }).lean();
    const uploadIds = userUploads.map((u) => u.id);
    await Chunk.deleteMany({ file_id: { $in: nodeIds } }).catch(() => {});
    await FileVersion.deleteMany({ node_id: { $in: nodeIds } }).catch(() => {});
    await UploadPart.deleteMany({ upload_id: { $in: uploadIds } }).catch(() => {});
    await Upload.deleteMany({ user_id: createdUserId }).catch(() => {});
    await Blob.deleteMany({ user_id: createdUserId }).catch(() => {});
    await SyncJournal.deleteMany({ user_id: createdUserId }).catch(() => {});
    await DropLink.deleteMany({ owner_id: createdUserId }).catch(() => {});
    await Node.deleteMany({ owner_id: createdUserId }).catch(() => {});
    await User.deleteOne({ id: createdUserId }).catch(() => {});
  }
  await TgEntity.deleteMany({ id: testChanId }).catch(() => {});
  tg.client = null;
  tg.channel = null;
  tg.ready = false;
  server.close();
  process.exit(exitCode);
}
