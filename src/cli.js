#!/usr/bin/env node

import { CONFIG } from "./config/index.js";
import {
  loadAccounts,
  upsertAccount,
  removeAccount,
  buildOAuthUrl,
} from "./services/accountManager.js";
import { getAccountLockInfo } from "./services/quotaTracker.js";
import { createProxyApp } from "./server.js";

// Phân tích các tham số dòng lệnh đầu vào
function parseArgs(args) {
  const options = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { options, positional };
}

// In bảng hướng dẫn sử dụng công cụ CLI
function printHelp() {
  console.log(`
AgyProxy CLI - Quản lý Proxy Antigravity đa tài khoản

Sử dụng:
  node src/cli.js list                            Liệt kê danh sách tài khoản và trạng thái hạn ngạch
  node src/cli.js add --token <refresh_token>     Thêm tài khoản mới qua refresh token
                      [--name <tên>]
                      [--priority <số>]
                      [--project <projectId>]
  node src/cli.js remove <id>                     Xóa tài khoản theo mã ID
  node src/cli.js oauth [--port <cổng>]           Tạo URL đăng nhập Google OAuth
  node src/cli.js start [--port <cổng>]           Khởi động máy chủ proxy
  `);
}

// Xử lý các lệnh từ giao diện dòng lệnh
async function main() {
  const rawArgs = process.argv.slice(2);
  const command = rawArgs[0];
  const { options, positional } = parseArgs(rawArgs.slice(1));

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "list") {
    const accounts = await loadAccounts();
    if (accounts.length === 0) {
      console.log("Chưa có tài khoản nào được lưu. Dùng `add` hoặc `oauth` để thêm tài khoản.");
      return;
    }
    console.log(`\nDanh sách tài khoản Antigravity (${accounts.length} tài khoản):`);
    console.log("-".repeat(70));
    console.log("Ưu tiên | ID | Tên / Email | Trạng thái | Hạn ngạch");
    console.log("-".repeat(70));

    const sorted = [...accounts].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
    for (const acc of sorted) {
      const lock = getAccountLockInfo(acc.id);
      const statusStr = acc.isActive !== false ? "Hoạt động" : "Tạm ngắt";
      const quotaStr = lock ? `Tạm khóa đến ${new Date(lock.blockedUntil).toLocaleTimeString()}` : "Sẵn sàng";
      console.log(`  #${acc.priority ?? 999}   | ${acc.id} | ${acc.name || acc.email} | ${statusStr} | ${quotaStr}`);
    }
    console.log("-".repeat(70));
    return;
  }

  if (command === "add") {
    const token = options.token;
    if (!token) {
      console.error("Lỗi: Thiếu tham số bắt buộc --token <refresh_token>");
      process.exit(1);
    }
    const acc = await upsertAccount({
      name: options.name || "Antigravity Account",
      email: options.email || "",
      refreshToken: token,
      projectId: options.project || "",
      priority: options.priority ? parseInt(options.priority, 10) : undefined,
    });
    console.log(`Đã thêm thành công tài khoản [${acc.id}] với độ ưu tiên #${acc.priority}`);
    return;
  }

  if (command === "remove") {
    const id = positional[0];
    if (!id) {
      console.error("Lỗi: Thiếu ID tài khoản cần xóa. Ví dụ: node src/cli.js remove acc-1");
      process.exit(1);
    }
    const ok = await removeAccount(id);
    if (ok) {
      console.log(`Đã xóa tài khoản [${id}]`);
    } else {
      console.error(`Không tìm thấy tài khoản có ID [${id}]`);
    }
    return;
  }

  if (command === "oauth") {
    const port = options.port || CONFIG.port;
    const redirectUri = `http://localhost:${port}/oauth/callback`;
    const url = buildOAuthUrl(redirectUri);
    console.log("\nMở đường dẫn sau trong trình duyệt để đăng nhập cấp quyền Google Antigravity:");
    console.log("\n" + url + "\n");
    return;
  }

  if (command === "start") {
    const port = options.port ? parseInt(options.port, 10) : CONFIG.port;
    const app = createProxyApp();
    app.listen(port, CONFIG.host, () => {
      console.log(`[AgyProxy] Server đang chạy tại http://${CONFIG.host}:${port}`);
      console.log(`[AgyProxy] Endpoint OpenAI: http://${CONFIG.host}:${port}/v1/chat/completions`);
      console.log(`[AgyProxy] Endpoint Models: http://${CONFIG.host}:${port}/v1/models`);
    });
    return;
  }

  console.error(`Lệnh không hợp lệ: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error("Lỗi CLI:", err.message);
  process.exit(1);
});
