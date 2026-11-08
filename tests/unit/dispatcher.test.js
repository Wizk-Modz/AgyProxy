import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  pickSequentialAccount,
  executeWithSequentialFallback,
} from "../../src/services/accountDispatcher.js";
import {
  recordAccountError,
  recordAccountSuccess,
  isAccountAvailable,
  resetQuotaTrackerState,
  parseResetTimeFromError,
} from "../../src/services/quotaTracker.js";

const mockAccounts = [
  { id: "acc-1", name: "Tài khoản 1", priority: 1, isActive: true },
  { id: "acc-2", name: "Tài khoản 2", priority: 2, isActive: true },
  { id: "acc-3", name: "Tài khoản 3", priority: 3, isActive: true },
];

beforeEach(() => {
  resetQuotaTrackerState();
});

test("quotaTracker - trích xuất mốc thời gian quotaResetTimeStamp từ lỗi của Google", () => {
  const futureIso = new Date(Date.now() + 100_000).toISOString();
  const errorJson = JSON.stringify({
    error: {
      code: 429,
      details: [{ metadata: { quotaResetTimeStamp: futureIso } }],
    },
  });
  const ms = parseResetTimeFromError(errorJson);
  assert.equal(ms, new Date(futureIso).getTime());
});

test("accountDispatcher - giữ cố định tài khoản 1 khi còn hạn ngạch", () => {
  const chosen1 = pickSequentialAccount(mockAccounts);
  const chosen2 = pickSequentialAccount(mockAccounts);
  const chosen3 = pickSequentialAccount(mockAccounts);

  assert.equal(chosen1?.id, "acc-1");
  assert.equal(chosen2?.id, "acc-1");
  assert.equal(chosen3?.id, "acc-1");
});

test("accountDispatcher - chỉ chuyển sang tài khoản 2 khi tài khoản 1 bị lỗi 429", () => {
  // Ban đầu chọn acc-1
  assert.equal(pickSequentialAccount(mockAccounts)?.id, "acc-1");

  // acc-1 gặp lỗi 429 hết hạn ngạch
  recordAccountError("acc-1", 429, null, Date.now() + 60_000);
  assert.equal(isAccountAvailable("acc-1"), false);

  // Sau khi acc-1 bị khóa, hệ thống chọn acc-2
  const nextChosen = pickSequentialAccount(mockAccounts);
  assert.equal(nextChosen?.id, "acc-2");

  // Tiếp tục giữ acc-2 cho các request sau
  const nextAgain = pickSequentialAccount(mockAccounts);
  assert.equal(nextAgain?.id, "acc-2");
});

test("executeWithSequentialFallback - tự động chuyển tài khoản khi upstream trả về 429", async () => {
  const calledAccounts = [];

  const result = await executeWithSequentialFallback(mockAccounts, async (account) => {
    calledAccounts.push(account.id);
    if (account.id === "acc-1") {
      const err = new Error("Rate limit");
      err.status = 429;
      err.resetAtMs = Date.now() + 10_000;
      throw err;
    }
    return { data: "thành công từ " + account.id };
  });

  assert.deepEqual(calledAccounts, ["acc-1", "acc-2"]);
  assert.equal(result.data, "thành công từ acc-2");

  // Request tiếp theo trực tiếp dùng acc-2 mà không gọi lại acc-1
  const nextResult = await executeWithSequentialFallback(mockAccounts, async (account) => {
    return { data: "thành công từ " + account.id };
  });
  assert.equal(nextResult.data, "thành công từ acc-2");
});

test("executeWithSequentialFallback - không chuyển tài khoản khi gặp lỗi client 400", async () => {
  const calledAccounts = [];

  await assert.rejects(
    async () => {
      await executeWithSequentialFallback(mockAccounts, async (account) => {
        calledAccounts.push(account.id);
        const err = new Error("Bad Request");
        err.status = 400;
        throw err;
      });
    },
    { message: "Bad Request" }
  );

  // Chỉ gọi acc-1 và dừng lại ngay lập tức
  assert.deepEqual(calledAccounts, ["acc-1"]);
});
