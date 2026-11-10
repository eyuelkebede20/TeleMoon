import assert from "node:assert";
import http from "node:http";
import express from "express";
import { api } from "../src/routes.js";
import { q } from "../src/db.js";

console.log("Running server auth, session, and channel linking tests...");

const app = express();
app.use(express.json());
app.use("/api", api);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const baseUrl = `http://localhost:${port}/api`;

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

try {
  const testHandle = "user_" + Math.random().toString(36).slice(2, 8);
  const testPassword = "securePassword123!";
  const testTgId = "tg_" + testHandle;

  // 1. Test /api/public-status
  const pubStatus = await req("GET", "/public-status");
  assert.equal(pubStatus.status, 200, "/api/public-status returns 200");
  assert.ok(typeof pubStatus.data.users === "number", "Returns user count");
  assert.ok(pubStatus.data.botUsername, "Returns bot username");

  // 2. Test /api/auth/signup validation
  const badHandle = await req("POST", "/auth/signup", { handle: "a", password: testPassword });
  assert.equal(badHandle.status, 400, "Short handle rejected with 400");

  const badPass = await req("POST", "/auth/signup", { handle: testHandle, password: "123" });
  assert.equal(badPass.status, 400, "Short password rejected with 400");

  // 3. Test successful /api/auth/signup
  const signupRes = await req("POST", "/auth/signup", {
    handle: testHandle,
    password: testPassword,
    telegramId: testTgId,
  });
  assert.equal(signupRes.status, 201, "Valid signup returns 201 Created");
  assert.ok(signupRes.data.token, "Signup returns JWT token");
  assert.equal(signupRes.data.user.handle, testHandle);
  assert.equal(signupRes.data.user.channel_id, null, "New user has no channel yet");
  assert.equal(signupRes.data.user.telegram_id, testTgId);

  const userToken = signupRes.data.token;
  const userId = signupRes.data.user.id;

  // 4. Test duplicate signup prevention (must be distinct from login!)
  const dupSignup = await req("POST", "/auth/signup", {
    handle: testHandle,
    password: testPassword,
  });
  assert.equal(dupSignup.status, 409, "Duplicate handle rejected with 409 Conflict");

  // 5. Test /api/auth/login validation
  const noAccount = await req("POST", "/auth/login", {
    handle: "non_existent_" + Date.now(),
    password: testPassword,
  });
  assert.equal(noAccount.status, 404, "Login for non-existent handle returns 404");

  const wrongPass = await req("POST", "/auth/login", {
    handle: testHandle,
    password: "wrongPassword!",
  });
  assert.equal(wrongPass.status, 401, "Login with wrong password returns 401");

  // 6. Test successful /api/auth/login
  const loginRes = await req("POST", "/auth/login", {
    handle: testHandle,
    password: testPassword,
  });
  assert.equal(loginRes.status, 200, "Valid login returns 200 OK");
  assert.ok(loginRes.data.token, "Login returns valid JWT token");
  assert.equal(loginRes.data.user.id, userId);
  assert.equal(loginRes.data.user.handle, testHandle);

  // 7. Test /api/auth/me (Session verification & refresh)
  const unauthMe = await req("GET", "/auth/me");
  assert.equal(unauthMe.status, 401, "/auth/me returns 401 without token");

  const authMe = await req("GET", "/auth/me", null, userToken);
  assert.equal(authMe.status, 200, "/auth/me returns 200 with valid token");
  assert.equal(authMe.data.user.id, userId);
  assert.equal(authMe.data.user.handle, testHandle);
  assert.equal(authMe.data.user.channel_id, null);

  // 8. Test /api/user/channel (Channel linking & persistence)
  const testChannelId = "-1001234567890";
  const linkRes = await req("POST", "/user/channel", { channel_id: testChannelId }, userToken);
  assert.equal(linkRes.status, 200, "Channel linked successfully");
  assert.equal(linkRes.data.ok, true);
  assert.equal(linkRes.data.channel_id, testChannelId);

  // Verify DB was directly updated
  const userInDb = q("SELECT channel_id FROM users WHERE id=?").get(userId);
  assert.equal(userInDb.channel_id, testChannelId, "Channel persisted to SQLite users table");

  // Verify /api/auth/me returns fresh channel_id
  const freshMe = await req("GET", "/auth/me", null, userToken);
  assert.equal(freshMe.data.user.channel_id, testChannelId, "auth/me immediately reflects linked channel");

  // Verify subsequent login returns linked channel_id
  const secondLogin = await req("POST", "/auth/login", {
    handle: testHandle,
    password: testPassword,
  });
  assert.equal(secondLogin.data.user.channel_id, testChannelId, "Subsequent login reflects linked channel");

  // 9. Test /api/auth/logout
  const logoutRes = await req("POST", "/auth/logout");
  assert.equal(logoutRes.status, 200, "/api/auth/logout returns 200");
  assert.equal(logoutRes.data.ok, true);

  console.log("All server auth, session, and channel linking tests PASSED successfully!");
} finally {
  server.close();
  process.exit(0);
}
