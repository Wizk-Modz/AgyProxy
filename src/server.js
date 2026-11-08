import { createServer } from "node:http";
import { CONFIG } from "./config/index.js";
import {
  ANTIGRAVITY_BASE_URL,
  ANTIGRAVITY_USER_AGENT,
  ANTIGRAVITY_IDE_VERSION,
  SUPPORTED_MODELS,
} from "./config/constants.js";
import {
  getActiveAccounts,
  loadAccounts,
  ensureValidToken,
  upsertAccount,
  removeAccount,
  buildOAuthUrl,
  exchangeOAuthCode,
} from "./services/accountManager.js";
import {
  executeWithSequentialFallback,
  getEarliestResetTime,
} from "./services/accountDispatcher.js";
import { getAccountLockInfo } from "./services/quotaTracker.js";
import { buildAntigravityEnvelope } from "./translator/requestTranslator.js";
import {
  antigravityToOpenAIResponse,
  translateAntigravitySSEChunk,
} from "./translator/responseTranslator.js";

// Đọc toàn bộ body dạng chuỗi JSON từ HTTP request
export async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 20 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body vượt quá kích thước cho phép (20MB)"));
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error(`JSON không hợp lệ: ${err.message}`));
      }
    });
    req.on("error", reject);
  });
}

// Trả về phản hồi dạng JSON cho client
export function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

// Xử lý gửi request tới upstream Antigravity và chuyển đổi phản hồi
export async function handleChatCompletion(req, res, body, accountsFilePath = CONFIG.accountsFilePath) {
  const accounts = await getActiveAccounts(accountsFilePath);
  if (accounts.length === 0) {
    return sendJson(res, 503, {
      error: {
        message: "Chưa cấu hình tài khoản Google Antigravity nào. Vui lòng thêm tài khoản trước khi gọi API.",
        type: "service_unavailable",
      },
    });
  }

  const isStream = body.stream === true;
  const requestedModel = body.model || "gemini-4-argon";

  try {
    await executeWithSequentialFallback(accounts, async (account) => {
      const validAccount = await ensureValidToken(account, accountsFilePath);
      const envelope = buildAntigravityEnvelope(body, validAccount);

      const action = isStream ? "streamGenerateContent?alt=sse" : "generateContent";
      const upstreamUrl = `${ANTIGRAVITY_BASE_URL}/v1internal:${action}`;

      const upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validAccount.accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": ANTIGRAVITY_USER_AGENT,
          "X-Client-Name": "antigravity",
          "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
        },
        body: JSON.stringify(envelope),
      });

      if (upstreamRes.status === 429 || upstreamRes.status === 409) {
        const errorText = await upstreamRes.text().catch(() => "");
        const err = new Error(`Lỗi hạn ngạch upstream (${upstreamRes.status}): ${errorText.slice(0, 300)}`);
        err.status = upstreamRes.status;
        err.responseBody = errorText;
        throw err;
      }

      if (!upstreamRes.ok) {
        const errorText = await upstreamRes.text().catch(() => "");
        const err = new Error(`Upstream trả về lỗi (${upstreamRes.status}): ${errorText.slice(0, 300)}`);
        err.status = upstreamRes.status;
        throw err;
      }

      if (!isStream) {
        const data = await upstreamRes.json();
        const openAIResponse = antigravityToOpenAIResponse(data, requestedModel);
        return sendJson(res, 200, openAIResponse);
      }

      // Xử lý luồng SSE streaming
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sseState = {};
      const reader = upstreamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const chunkJson = JSON.parse(jsonStr);
            const openAIChunks = translateAntigravitySSEChunk(chunkJson, sseState, requestedModel);
            for (const ch of openAIChunks) {
              res.write(`data: ${JSON.stringify(ch)}\n\n`);
            }
          } catch {
            // Bỏ qua dòng không parse được JSON
          }
        }
      }

      // Xử lý nốt buffer còn lại
      if (buffer.trim().startsWith("data:")) {
        try {
          const chunkJson = JSON.parse(buffer.trim().slice(5).trim());
          const openAIChunks = translateAntigravitySSEChunk(chunkJson, sseState, requestedModel);
          for (const ch of openAIChunks) {
            res.write(`data: ${JSON.stringify(ch)}\n\n`);
          }
        } catch {
          // Bỏ qua
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    });
  } catch (err) {
    if (res.headersSent) {
      res.end();
      return;
    }
    const status = err.status || 500;
    return sendJson(res, status, {
      error: {
        message: err.message,
        type: status === 429 ? "insufficient_quota" : "api_error",
        earliest_reset: err.earliestReset ? new Date(err.earliestReset).toISOString() : null,
      },
    });
  }
}

// Khởi tạo máy chủ HTTP định tuyến các yêu cầu API
export function createProxyApp(accountsFilePath = CONFIG.accountsFilePath) {
  return createServer(async (req, res) => {
    // Thêm CORS headers cho các ứng dụng client
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const path = parsedUrl.pathname;

    try {
      // 1. Kiểm tra trạng thái máy chủ
      if (req.method === "GET" && (path === "/" || path === "/health")) {
        const accounts = await getActiveAccounts(accountsFilePath);
        return sendJson(res, 200, {
          status: "ok",
          version: "0.1.0",
          activeAccounts: accounts.length,
        });
      }

      // 2. Danh sách Model theo chuẩn OpenAI
      if (req.method === "GET" && path === "/v1/models") {
        return sendJson(res, 200, {
          object: "list",
          data: SUPPORTED_MODELS.map((m) => ({
            id: m.id,
            object: "model",
            created: 1700000000,
            owned_by: "antigravity",
          })),
        });
      }

      // 3. API Chat Completions chuẩn OpenAI
      if (req.method === "POST" && path === "/v1/chat/completions") {
        const body = await readJsonBody(req);
        return await handleChatCompletion(req, res, body, accountsFilePath);
      }

      // 4. API Quản lý danh sách tài khoản
      if (req.method === "GET" && path === "/api/accounts") {
        const accounts = await loadAccounts(accountsFilePath);
        const list = accounts.map((acc) => {
          const lock = getAccountLockInfo(acc.id);
          return {
            id: acc.id,
            name: acc.name,
            email: acc.email,
            priority: acc.priority,
            isActive: acc.isActive,
            projectId: acc.projectId,
            isLocked: !!lock,
            lockedUntil: lock?.blockedUntil ? new Date(lock.blockedUntil).toISOString() : null,
            lockReason: lock?.reason || null,
          };
        });
        return sendJson(res, 200, { accounts: list });
      }

      // 5. API Thêm hoặc cập nhật tài khoản
      if (req.method === "POST" && path === "/api/accounts") {
        const body = await readJsonBody(req);
        if (!body.refreshToken) {
          return sendJson(res, 400, { error: "Yêu cầu cung cấp refreshToken" });
        }
        const created = await upsertAccount(body, accountsFilePath);
        return sendJson(res, 201, {
          account: {
            id: created.id,
            name: created.name,
            email: created.email,
            priority: created.priority,
          },
        });
      }

      // 6. API Xóa tài khoản
      if (req.method === "DELETE" && path.startsWith("/api/accounts/")) {
        const id = path.slice("/api/accounts/".length);
        const ok = await removeAccount(id, accountsFilePath);
        return sendJson(res, ok ? 200 : 404, { success: ok });
      }

      // 7. API Tạo URL Google OAuth đăng nhập
      if (req.method === "GET" && path === "/api/oauth/url") {
        const redirectUri = parsedUrl.searchParams.get("redirect_uri") || `http://${req.headers.host || "localhost:8080"}/oauth/callback`;
        const state = parsedUrl.searchParams.get("state") || "";
        const url = buildOAuthUrl(redirectUri, state);
        return sendJson(res, 200, { url });
      }

      // 8. Endpoint callback nhận authorization code từ Google OAuth
      if (req.method === "GET" && path === "/oauth/callback") {
        const code = parsedUrl.searchParams.get("code");
        if (!code) {
          return sendJson(res, 400, { error: "Thiếu tham số code từ Google OAuth" });
        }
        const redirectUri = `http://${req.headers.host || "localhost:8080"}/oauth/callback`;
        const account = await exchangeOAuthCode(code, redirectUri, accountsFilePath);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h2>Thành công!</h2><p>Đã liên kết tài khoản Antigravity (${account.email || account.name}) với độ ưu tiên #${account.priority}. Bạn có thể đóng tab này.</p>`);
        return;
      }

      // Tuyến đường không tồn tại
      return sendJson(res, 404, { error: "Endpoint không tồn tại" });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  });
}

// Hàm khởi chạy độc lập khi chạy trực tiếp file server.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createProxyApp();
  app.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`[AgyProxy] Server đang chạy tại http://${CONFIG.host}:${CONFIG.port}`);
    console.log(`[AgyProxy] Endpoint OpenAI: http://${CONFIG.host}:${CONFIG.port}/v1/chat/completions`);
    console.log(`[AgyProxy] Endpoint Models: http://${CONFIG.host}:${CONFIG.port}/v1/models`);
  });
}
