import { resolve } from "node:path";
import { existsSync } from "node:fs";

// Xác định đường dẫn lưu trữ tài khoản cho môi trường cục bộ hoặc cài đặt toàn cục
function resolveAccountsPath() {
  if (process.env.ACCOUNTS_FILE) {
    return resolve(process.cwd(), process.env.ACCOUNTS_FILE);
  }
  const localPath = resolve(process.cwd(), "data/accounts.json");
  if (existsSync(localPath)) {
    return localPath;
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
  return resolve(homeDir, ".agyproxy", "accounts.json");
}

// Cấu hình môi trường và máy chủ proxy
export const CONFIG = {
  port: parseInt(process.env.PORT || "8080", 10),
  host: process.env.HOST || "0.0.0.0",
  accountsFilePath: resolveAccountsPath(),
  strikeWindowMs: 60_000,
  strikeThreshold: 3,
  strikeBlockMs: 15 * 60_000,
  defaultCooldownMs: 60_000,
};
