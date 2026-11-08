import { createHash } from "node:crypto";
import {
  SUPPORTED_MODELS,
  MODEL_ALIAS_MAP,
  DEFAULT_THINKING_SIGNATURE,
} from "../config/constants.js";
import {
  cleanPromptText,
  sanitizeFunctionName,
  cleanJSONSchemaForAntigravity,
} from "./promptCleaner.js";

// Phân giải tên model từ client sang định dạng upstream của Antigravity
export function resolveUpstreamModel(clientModel = "") {
  let clean = clientModel.trim();
  if (clean.startsWith("ag/")) clean = clean.slice(3);
  if (clean.startsWith("antigravity/")) clean = clean.slice(12);

  if (MODEL_ALIAS_MAP[clean]) {
    return MODEL_ALIAS_MAP[clean];
  }

  const found = SUPPORTED_MODELS.find((m) => m.id === clean);
  if (found) {
    return found.upstreamModelId || found.id;
  }

  return clean;
}

// Tạo chuỗi UUID từ chuỗi seed phục vụ định danh phiên làm việc
export function uuidFromSeed(seed) {
  const bytes = createHash("sha256").update(String(seed || "antigravity")).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Chuyển đổi chuỗi ID sang giá trị số nguyên cho sessionId của Google
export function toNumericSessionId(id) {
  if (typeof id === "number") return id;
  if (!id) return Math.floor(Math.random() * 1000000);
  const hash = createHash("md5").update(String(id)).digest();
  return hash.readUInt32BE(0);
}

// Tạo định danh requestId chuẩn định dạng của agent Antigravity
export function buildIdeRequestId(sessionId, model, contentCount = 1) {
  const conversationId = uuidFromSeed(`antigravity:conversation:${sessionId}`);
  const trajectoryId = uuidFromSeed(`antigravity:trajectory:${sessionId}:${model}:agent`);
  const step = Math.max(1, contentCount * 2 - 1);
  return `agent/${conversationId}/${Date.now()}/${trajectoryId}/${step}`;
}

// Đóng gói request chuẩn OpenAI sang gói tin envelope của Antigravity
export function buildAntigravityEnvelope(openaiBody, account) {
  const upstreamModel = resolveUpstreamModel(openaiBody.model);
  const messages = Array.isArray(openaiBody.messages) ? openaiBody.messages : [];

  let systemInstruction = null;
  const contents = [];

  for (const msg of messages) {
    const role = msg.role;

    if (role === "system" || role === "developer") {
      const text = typeof msg.content === "string" ? cleanPromptText(msg.content) : "";
      if (text) {
        systemInstruction = { parts: [{ text }] };
      }
      continue;
    }

    if (role === "user") {
      const parts = [];
      if (typeof msg.content === "string") {
        parts.push({ text: cleanPromptText(msg.content) });
      } else if (Array.isArray(msg.content)) {
        for (const item of msg.content) {
          if (item.type === "text" && item.text) {
            parts.push({ text: cleanPromptText(item.text) });
          } else if (item.type === "image_url" && item.image_url?.url) {
            const url = item.image_url.url;
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              parts.push({
                inlineData: {
                  mimeType: match[1],
                  data: match[2],
                },
              });
            }
          }
        }
      }
      if (parts.length > 0) {
        contents.push({ role: "user", parts });
      }
      continue;
    }

    if (role === "assistant") {
      const parts = [];
      if (msg.content) {
        parts.push({ text: msg.content });
      }
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          let args = {};
          try {
            args = typeof tc.function?.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function?.arguments || {};
          } catch {
            args = {};
          }
          parts.push({
            functionCall: {
              name: sanitizeFunctionName(tc.function?.name),
              args,
            },
            thoughtSignature: DEFAULT_THINKING_SIGNATURE,
          });
        }
      }
      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
      continue;
    }

    if (role === "tool") {
      const name = sanitizeFunctionName(msg.name || "tool_result");
      let content = msg.content;
      try {
        content = typeof content === "string" ? JSON.parse(content) : content;
      } catch {
        // Giữ nguyên chuỗi nếu không phải JSON
      }
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name,
              response: { content },
            },
          },
        ],
      });
    }
  }

  // Chuyển đổi công cụ tools
  let tools = undefined;
  let toolConfig = undefined;
  if (Array.isArray(openaiBody.tools) && openaiBody.tools.length > 0) {
    const declarations = [];
    for (const tool of openaiBody.tools) {
      if (tool.type === "function" && tool.function) {
        declarations.push({
          name: sanitizeFunctionName(tool.function.name),
          description: tool.function.description || "",
          parameters: cleanJSONSchemaForAntigravity(tool.function.parameters),
        });
      }
    }
    if (declarations.length > 0) {
      tools = [{ functionDeclarations: declarations }];
      toolConfig = { functionCallingConfig: { mode: "VALIDATED" } };
    }
  }

  // Cấu hình sinh nội dung generationConfig
  const generationConfig = {
    temperature: openaiBody.temperature ?? 1.0,
    topP: openaiBody.top_p ?? 0.95,
  };
  const maxTokens = openaiBody.max_tokens ?? openaiBody.max_completion_tokens;
  if (maxTokens) {
    generationConfig.maxOutputTokens = Math.min(maxTokens, 64000);
  }

  const rawSessionId = account.id || account.email || "session_agyproxy";
  const sessionId = toNumericSessionId(rawSessionId);
  const requestId = buildIdeRequestId(sessionId, upstreamModel, contents.length);

  return {
    project: account.projectId || "",
    model: upstreamModel,
    userAgent: "antigravity",
    requestId,
    request: {
      sessionId,
      contents,
      ...(systemInstruction && { systemInstruction }),
      generationConfig,
      ...(tools && { tools }),
      ...(toolConfig && { toolConfig }),
    },
  };
}
