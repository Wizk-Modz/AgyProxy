import {
  isAccountAvailable,
  recordAccountError,
  recordAccountSuccess,
  getAccountLockInfo,
} from "./quotaTracker.js";

// Lựa chọn tài khoản ưu tiên cao nhất theo thứ tự tuần tự
export function pickSequentialAccount(accounts, excludeIds = new Set()) {
  const sorted = [...accounts].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  for (const account of sorted) {
    if (excludeIds.has(account.id)) continue;
    if (isAccountAvailable(account.id)) {
      return account;
    }
  }
  return null;
}

// Tìm mốc thời gian sớm nhất một trong các tài khoản sẽ mở khóa
export function getEarliestResetTime(accounts) {
  let earliest = null;
  for (const acc of accounts) {
    const lock = getAccountLockInfo(acc.id);
    if (lock && (!earliest || lock.blockedUntil < earliest)) {
      earliest = lock.blockedUntil;
    }
  }
  return earliest;
}

// Thực hiện gọi hàm xử lý với cơ chế cố định tài khoản và tự động chuyển khi gặp lỗi hạn ngạch
export async function executeWithSequentialFallback(accounts, executeFn) {
  const excludeIds = new Set();
  let lastError = null;

  while (true) {
    const account = pickSequentialAccount(accounts, excludeIds);
    if (!account) {
      const earliestReset = getEarliestResetTime(accounts);
      const resetMsg = earliestReset
        ? `Tài khoản sớm nhất sẽ mở khóa lúc ${new Date(earliestReset).toISOString()}`
        : "Không còn tài khoản khả dụng";
      const err = new Error(`Toàn bộ ${accounts.length} tài khoản Antigravity đều đã hết hạn ngạch. ${resetMsg}`);
      err.status = 429;
      err.earliestReset = earliestReset;
      err.lastError = lastError;
      throw err;
    }

    try {
      const result = await executeFn(account);
      recordAccountSuccess(account.id);
      return result;
    } catch (error) {
      lastError = error;
      const isRateLimit = error.status === 429 || error.status === 409 || error.isRateLimit;
      if (isRateLimit) {
        recordAccountError(account.id, error.status, error.responseBody, error.resetAtMs);
        excludeIds.add(account.id);
        continue;
      }
      throw error;
    }
  }
}
