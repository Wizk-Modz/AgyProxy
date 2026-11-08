import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { createProxyApp } from "../../src/server.js";

const TEST_ACCOUNTS_FILE = resolve(process.env.HOME || "/tmp", "tmp", "integration_accounts.json");
let server;
let serverUrl;

before(async () => {
  await rm(TEST_ACCOUNTS_FILE, { force: true });
  server = createProxyApp(TEST_ACCOUNTS_FILE);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      serverUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(TEST_ACCOUNTS_FILE, { force: true });
});

test("server - GET /health trả về trạng thái ok", async () => {
  const res = await fetch(`${serverUrl}/health`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, "ok");
  assert.equal(typeof json.activeAccounts, "number");
});

test("server - GET /v1/models trả về danh sách model chuẩn OpenAI", async () => {
  const res = await fetch(`${serverUrl}/v1/models`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.object, "list");
  assert.ok(Array.isArray(json.data));
  assert.ok(json.data.some((m) => m.id === "gemini-4-argon"));
  assert.ok(json.data.some((m) => m.id === "claude-3-7-sonnet"));
});

test("server - POST /v1/chat/completions khi chưa có tài khoản trả về 503", async () => {
  const res = await fetch(`${serverUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemini-4-argon",
      messages: [{ role: "user", content: "Xin chào" }],
    }),
  });
  assert.equal(res.status, 503);
  const json = await res.json();
  assert.ok(json.error?.message.includes("Chưa cấu hình tài khoản"));
});

test("server - CRUD tài khoản qua API /api/accounts", async () => {
  // 1. Thêm tài khoản mới
  const addRes = await fetch(`${serverUrl}/api/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Tài khoản Test",
      email: "test@example.com",
      refreshToken: "sample_refresh_token",
      priority: 1,
    }),
  });
  assert.equal(addRes.status, 201);
  const addJson = await addRes.json();
  assert.ok(addJson.account.id);
  const accountId = addJson.account.id;

  // 2. Lấy danh sách tài khoản
  const listRes = await fetch(`${serverUrl}/api/accounts`);
  assert.equal(listRes.status, 200);
  const listJson = await listRes.json();
  assert.equal(listJson.accounts.length, 1);
  assert.equal(listJson.accounts[0].name, "Tài khoản Test");
  assert.equal(listJson.accounts[0].isLocked, false);

  // 3. Xóa tài khoản
  const delRes = await fetch(`${serverUrl}/api/accounts/${accountId}`, {
    method: "DELETE",
  });
  assert.equal(delRes.status, 200);

  // Kiểm tra danh sách sau xóa
  const listAfter = await (await fetch(`${serverUrl}/api/accounts`)).json();
  assert.equal(listAfter.accounts.length, 0);
});

test("server - GET /api/oauth/url sinh URL đăng nhập Google OAuth", async () => {
  const res = await fetch(`${serverUrl}/api/oauth/url`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.url.startsWith("https://accounts.google.com/o/oauth2/v2/auth"));
  assert.ok(json.url.includes("client_id="));
});
