import { test } from "node:test";
import assert from "node:assert/strict";
import { rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  loadAccounts,
  saveAccounts,
  upsertAccount,
  getActiveAccounts,
  removeAccount,
  getAccountById,
  buildOAuthUrl,
} from "../../src/services/accountManager.js";

const TEST_FILE = resolve(process.env.HOME || "/tmp", "tmp", "test_accounts.json");

test("accountManager - khởi tạo file trống khi file không tồn tại", async () => {
  await rm(TEST_FILE, { force: true });
  const accounts = await loadAccounts(TEST_FILE);
  assert.deepEqual(accounts, []);
});

test("accountManager - thêm và cập nhật tài khoản", async () => {
  await rm(TEST_FILE, { force: true });

  const acc1 = await upsertAccount(
    {
      name: "Tài khoản 1",
      email: "acc1@gmail.com",
      refreshToken: "token_1",
      priority: 1,
    },
    TEST_FILE
  );

  assert.equal(acc1.name, "Tài khoản 1");
  assert.equal(acc1.priority, 1);
  assert.equal(acc1.isActive, true);

  const acc2 = await upsertAccount(
    {
      name: "Tài khoản 2",
      email: "acc2@gmail.com",
      refreshToken: "token_2",
      priority: 2,
    },
    TEST_FILE
  );

  const list = await getActiveAccounts(TEST_FILE);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, acc1.id);
  assert.equal(list[1].id, acc2.id);

  // Cập nhật tài khoản 1
  const updatedAcc1 = await upsertAccount(
    {
      id: acc1.id,
      name: "Tài khoản 1 Đã Đổi Tên",
      refreshToken: "token_1_new",
    },
    TEST_FILE
  );

  assert.equal(updatedAcc1.name, "Tài khoản 1 Đã Đổi Tên");
  assert.equal(updatedAcc1.refreshToken, "token_1_new");

  const byId = await getAccountById(acc1.id, TEST_FILE);
  assert.equal(byId?.name, "Tài khoản 1 Đã Đổi Tên");
});

test("accountManager - xóa tài khoản", async () => {
  const accounts = await loadAccounts(TEST_FILE);
  const targetId = accounts[0].id;

  const deleted = await removeAccount(targetId, TEST_FILE);
  assert.equal(deleted, true);

  const listAfter = await loadAccounts(TEST_FILE);
  assert.equal(listAfter.length, accounts.length - 1);
  assert.equal(listAfter.some((a) => a.id === targetId), false);

  await rm(TEST_FILE, { force: true });
});

test("accountManager - sinh đường dẫn Google OAuth hợp lệ", () => {
  const url = buildOAuthUrl("http://localhost:8080/oauth/callback", "state123");
  assert.ok(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth"));
  assert.ok(url.includes("client_id="));
  assert.ok(url.includes("state=state123"));
  assert.ok(url.includes("access_type=offline"));
});
