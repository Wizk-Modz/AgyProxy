import { resolve } from "node:path";

// Cấu hình môi trường và máy chủ proxy
export const CONFIG = {
  port: parseInt(process.env.PORT || "8080", 10),
  host: process.env.HOST || "0.0.0.0",
  accountsFilePath: resolve(process.cwd(), process.env.ACCOUNTS_FILE || "data/accounts.json"),
  strikeWindowMs: 60_000,
  strikeThreshold: 3,
  strikeBlockMs: 15 * 60_000,
  defaultCooldownMs: 60_000,
};
