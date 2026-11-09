import { CONFIG } from "../config/index.js";

// Bộ nhớ lưu trạng thái khóa và số lần lỗi của từng tài khoản
const accountLocks = new Map();
const strikeCounts = new Map();

// Trích xuất mốc thời gian hồi hạn ngạch từ phản hồi lỗi của Google
export function parseResetTimeFromError(errorBody) {
  if (!errorBody) return null;
  try {
    const json = typeof errorBody === "string" ? JSON.parse(errorBody) : errorBody;
    const details = Array.isArray(json?.error?.details) ? json.error.details : [];
    for (const d of details) {
      if (d?.metadata?.quotaResetTimeStamp) {
        const ms = new Date(d.metadata.quotaResetTimeStamp).getTime();
        if (!isNaN(ms) && ms > Date.now()) return ms;
      }
      if (typeof d?.retryDelay === "string") {
        const sec = parseFloat(d.retryDelay);
        if (!isNaN(sec) && sec > 0) {
          const ms = Date.now() + Math.round(sec * 1000);
          if (ms > Date.now()) return ms;
        }
      }
    }
  } catch {
    // Bỏ qua lỗi parse JSON không hợp lệ
  }
  return null;
}

// Ghi nhận lỗi 429 hoặc 409 để tạm khóa tài khoản
export function recordAccountError(accountId, status, errorBody = null, explicitResetMs = null) {
  const now = Date.now();
  const resetAtMs = explicitResetMs || parseResetTimeFromError(errorBody);

  if (resetAtMs && resetAtMs > now) {
    accountLocks.set(accountId, {
      blockedUntil: resetAtMs,
      reason: `Hết hạn ngạch (status: ${status}), mở khóa lúc ${new Date(resetAtMs).toISOString()}`,
    });
    return resetAtMs;
  }

  // Quản lý cơ chế strike ngắt mạch khi không có thời gian hồi cụ thể
  const strikeInfo = strikeCounts.get(accountId) || { count: 0, windowStart: now };
  if (now - strikeInfo.windowStart > CONFIG.strikeWindowMs) {
    strikeInfo.count = 1;
    strikeInfo.windowStart = now;
  } else {
    strikeInfo.count += 1;
  }
  strikeCounts.set(accountId, strikeInfo);

  const blockDuration = strikeInfo.count >= CONFIG.strikeThreshold ? CONFIG.strikeBlockMs : CONFIG.defaultCooldownMs;
  const blockedUntil = now + blockDuration;
  accountLocks.set(accountId, {
    blockedUntil,
    reason: `Giới hạn tần suất (${strikeInfo.count} lần lỗi trong cửa sổ giám sát)`,
  });
  return blockedUntil;
}

// Xóa trạng thái lỗi và đặt lại số strike khi gửi request thành công
export function recordAccountSuccess(accountId) {
  strikeCounts.delete(accountId);
  const lock = accountLocks.get(accountId);
  if (lock && Date.now() >= lock.blockedUntil) {
    accountLocks.delete(accountId);
  }
}

// Kiểm tra xem tài khoản có đang trong trạng thái sẵn sàng nhận request hay không
export function isAccountAvailable(accountId) {
  const lock = accountLocks.get(accountId);
  if (!lock) return true;
  if (Date.now() >= lock.blockedUntil) {
    accountLocks.delete(accountId);
    return true;
  }
  return false;
}

// Lấy thông tin thời điểm mở khóa của tài khoản
export function getAccountLockInfo(accountId) {
  const lock = accountLocks.get(accountId);
  if (!lock) return null;
  if (Date.now() >= lock.blockedUntil) {
    accountLocks.delete(accountId);
    return null;
  }
  return lock;
}

// Xóa trạng thái khóa và số lần strike của một tài khoản cụ thể
export function clearAccountLock(accountId) {
  accountLocks.delete(accountId);
  strikeCounts.delete(accountId);
}

// Xóa toàn bộ trạng thái bộ nhớ đệm phục vụ kiểm thử
export function resetQuotaTrackerState() {
  accountLocks.clear();
  strikeCounts.clear();
}
