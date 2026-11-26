import assert from "node:assert";
import http from "node:http";
import express from "express";
import telegram from "telegram";
import bigInt from "big-integer";
import { api } from "../src/routes.js";
import {
  connectDB, User, TgEntity, Setting, getSetting, escapeRegex,
} from "../src/db.js";
import {
  tg, normalizeChannelRef, setChannel, connectByLink, listDialogs, resolvePeer,
} from "../src/telegram.js";

const { Api } = telegram;

console.log("Running Telegram linking, entity hydration, and sync removal tests...");

// 1. Pure unit tests for normalizeChannelRef (no DB or network required)
{
  const r1 = normalizeChannelRef("https://t.me/c/3836770302/35");
  assert.deepEqual(r1, { type: "id", cleanId: "3836770302", ref: "-1003836770302" });

  const r2 = normalizeChannelRef("https://t.me/c/3836770302/12/35?single");
  assert.deepEqual(r2, { type: "id", cleanId: "3836770302", ref: "-1003836770302" });

  const r3 = normalizeChannelRef("https://telegram.me/c/3836770302");
  assert.deepEqual(r3, { type: "id", cleanId: "3836770302", ref: "-1003836770302" });

  const r4 = normalizeChannelRef("tg://privatepost?channel=3836770302&post=35");
  assert.deepEqual(r4, { type: "id", cleanId: "3836770302", ref: "-1003836770302" });

  const r5 = normalizeChannelRef("https://web.telegram.org/k/#-1003836770302");
  assert.deepEqual(r5, { type: "id", cleanId: "3836770302", ref: "-1003836770302" });

  const r6 = normalizeChannelRef("3836770302");
  assert.deepEqual(r6, { type: "id", cleanId: "3836770302", ref: "-1003836770302" });

  const r7 = normalizeChannelRef("-1003836770302");
  assert.deepEqual(r7, { type: "id", cleanId: "3836770302", ref: "-1003836770302" });

  const r8 = normalizeChannelRef("https://t.me/+AbCdEfGh1234");
  assert.equal(r8.type, "invite");
  assert.equal(r8.hash, "AbCdEfGh1234");

  const r9 = normalizeChannelRef("https://t.me/my_storage_group/42");
  assert.deepEqual(r9, { type: "username", username: "my_storage_group", ref: "@my_storage_group" });

  const r10 = normalizeChannelRef("https://t.me/c/not_a_number/test");
  assert.equal(r10.type, "other");

  assert.equal(escapeRegex("a+b(1)[test]?"), "a\\+b\\(1\\)\\[test\\]\\?");
}

await connectDB();

const prevChannelSetting = await getSetting("channel");
const testChanId = "9998887771";
const testChanId2 = "9998887772";
const missingChanId = "9998887779";
const testHandle = "linktest_" + Math.random().toString(36).slice(2, 8);
let createdUserId = null;

const app = express();
app.use(express.json());
app.use("/api", api);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const baseUrl = `http://localhost:${server.address().port}/api`;

async function req(method, path, body = null, token = null) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

let exitCode = 0;
try {
  const chanEnt = new Api.Channel({
    id: bigInt(testChanId),
    title: "Test Private Vault",
    accessHash: bigInt("1234567890123"),
    date: 1700000000,
    megagroup: true,
    photo: new Api.ChatPhotoEmpty(),
  });
  const archivedEnt = new Api.Channel({
    id: bigInt(testChanId2),
    title: "Archived Private Vault",
    accessHash: bigInt("2234567890123"),
    date: 1700000000,
    megagroup: true,
    photo: new Api.ChatPhotoEmpty(),
  });

  // 2. Test InputPeerChannel hydration from MongoDB TgEntity cache (previously crashed with "private user chats aren't supported")
  await TgEntity.findOneAndUpdate(
    { id: testChanId },
    {
      $set: {
        id: testChanId,
        access_hash: "1234567890123",
        title: "Test Private Vault",
        class_name: "Channel",
        updated_at: Date.now(),
      },
    },
    { upsert: true }
  );

  tg.mode = "user";
  tg.ready = false;
  tg.channel = null;
  tg.client = {
    getEntity: async (peer) => {
      if (peer?.className === "InputPeerChannel" && peer.channelId.toString() === testChanId) {
        return chanEnt;
      }
      throw new Error("CHANNEL_INVALID");
    },
    getDialogs: async () => [],
    getInputEntity: async () => {
      throw new Error("Could not find input entity");
    },
  };

  const linked1 = await connectByLink(`https://t.me/c/${testChanId}/35`);
  assert.equal(linked1.id, `-100${testChanId}`);
  assert.equal(linked1.title, "Test Private Vault");
  assert.equal(tg.ready, true, "tg.ready becomes true after linking");
  assert.equal(tg.channel.id.toString(), testChanId);

  // 3. Test archived chats resolution when getEntity fails and main dialogs don't contain it
  tg.channel = null;
  tg.ready = false;
  tg.client = {
    getEntity: async () => {
      throw new Error("CHANNEL_INVALID");
    },
    getDialogs: async (params = {}) => {
      if (params.archived) {
        return [{ id: bigInt(`-100${testChanId2}`), entity: archivedEnt }];
      }
      return [{ id: bigInt(`-100${testChanId}`), entity: chanEnt }];
    },
    getInputEntity: async () => {
      throw new Error("Could not find input entity");
    },
  };

  const linked2 = await connectByLink(`https://t.me/c/${testChanId2}/35`);
  assert.equal(linked2.id, `-100${testChanId2}`);
  assert.equal(linked2.title, "Archived Private Vault");
  assert.equal(tg.ready, true);

  // Also test listDialogs returns both active and archived deduplicated
  const allDialogs = await listDialogs();
  assert.ok(allDialogs.some((d) => d.id === `-100${testChanId}`), "Active dialog included");
  assert.ok(allDialogs.some((d) => d.id === `-100${testChanId2}`), "Archived dialog included");

  // 4. Test resolvePeer MUST NOT fall back to tg.channel or fabricate InputPeerChat for inaccessible channels
  await assert.rejects(
    async () => {
      await connectByLink(`https://t.me/c/${missingChanId}/35`);
    },
    (e) => e.status === 400 && e.message.includes(`-100${missingChanId}`),
    "Must reject cleanly instead of linking wrong channel or fabricating InputPeerChat"
  );
  await assert.rejects(
    async () => {
      await resolvePeer(`-100${missingChanId}`);
    },
    (e) => e.status === 400,
    "resolvePeer must never return tg.channel for an unrelated missing channel"
  );

  // 5. HTTP integration tests for /api/tg/connect, /api/user/channel, /api/tg/sync removal, and /api/search
  const signup = await req("POST", "/auth/signup", { handle: testHandle, password: "password123!" });
  assert.equal(signup.status, 201);
  const token = signup.data.token;
  createdUserId = signup.data.user.id;

  const connOk = await req("POST", "/tg/connect", { link: `https://t.me/c/${testChanId}/35` }, token);
  assert.equal(connOk.status, 200);
  assert.equal(connOk.data.id, `-100${testChanId}`);
  const userAfterConn = await User.findOne({ id: createdUserId }).lean();
  assert.equal(userAfterConn.channel_id, `-100${testChanId}`);

  const connFail = await req("POST", "/tg/connect", { link: `https://t.me/c/${missingChanId}/35` }, token);
  assert.equal(connFail.status, 400, "Inaccessible link returns clean 400 error, never 500 or setSetting error");
  assert.ok(!/setSetting/i.test(connFail.data.error), "No ReferenceError: setSetting is not defined");

  const chanEndpoint = await req(
    "POST",
    "/user/channel",
    { channel_id: `https://t.me/c/${testChanId2}/35` },
    token
  );
  assert.equal(chanEndpoint.status, 200);
  assert.equal(chanEndpoint.data.channel_id, `-100${testChanId2}`);
  assert.equal(chanEndpoint.data.title, "Archived Private Vault");

  const syncRemoved = await req("POST", "/tg/sync", {}, token);
  assert.equal(syncRemoved.status, 404, "/api/tg/sync endpoint is completely removed");

  const searchSafe = await req("GET", "/search?q=" + encodeURIComponent("doc(1)+[final]"), null, token);
  assert.equal(searchSafe.status, 200, "Search with regex special chars succeeds cleanly");

  console.log("All Telegram linking, entity hydration, and sync removal tests PASSED successfully!");
} catch (err) {
  console.error("Test failed:", err);
  exitCode = 1;
} finally {
  // Clean up test data and restore settings
  await TgEntity.deleteMany({ id: { $in: [testChanId, testChanId2, missingChanId] } }).catch(() => {});
  if (createdUserId) {
    await User.deleteOne({ id: createdUserId }).catch(() => {});
  }
  if (prevChannelSetting !== undefined) {
    await Setting.findOneAndUpdate(
      { key: "channel" },
      { $set: { value: prevChannelSetting } },
      { upsert: true }
    ).catch(() => {});
  } else {
    await Setting.deleteOne({ key: "channel" }).catch(() => {});
  }
  tg.client = null;
  tg.channel = null;
  tg.ready = false;
  server.close();
  process.exit(exitCode);
}
