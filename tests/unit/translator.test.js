import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanPromptText,
  sanitizeFunctionName,
  cleanJSONSchemaForAntigravity,
} from "../../src/translator/promptCleaner.js";
import {
  resolveUpstreamModel,
  buildAntigravityEnvelope,
} from "../../src/translator/requestTranslator.js";
import {
  antigravityToOpenAIResponse,
  translateAntigravitySSEChunk,
  mapFinishReason,
} from "../../src/translator/responseTranslator.js";

test("promptCleaner - loại bỏ các tiền tố nhận diện đối thủ", () => {
  const original = "You are a Claude agent, built on Anthropic's Claude Agent SDK.\nx-anthropic-billing-header: test\nXin chào!";
  const cleaned = cleanPromptText(original);
  assert.ok(!cleaned.includes("Claude Agent SDK"));
  assert.ok(!cleaned.includes("x-anthropic-billing-header"));
  assert.ok(cleaned.includes("Xin chào!"));
});

test("promptCleaner - chuẩn hóa tên hàm cho Gemini", () => {
  assert.equal(sanitizeFunctionName("my tool (run)!"), "my_tool__run__");
  assert.equal(sanitizeFunctionName("123badName"), "_123badName");
  assert.equal(sanitizeFunctionName(""), "_function");
});

test("promptCleaner - làm sạch schema JSON của tham số hàm", () => {
  const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: { path: { type: "string" } },
  };
  const cleaned = cleanJSONSchemaForAntigravity(schema);
  assert.equal(cleaned.$schema, undefined);
  assert.equal(cleaned.type, "object");
});

test("requestTranslator - ánh xạ đúng tên model sang upstream ID", () => {
  assert.equal(resolveUpstreamModel("claude-3-7-sonnet"), "claude-sonnet-5-5-high(high)");
  assert.equal(resolveUpstreamModel("claude-3-5-sonnet"), "claude-sonnet-4-6");
  assert.equal(resolveUpstreamModel("gemini-4-argon"), "gemini-4-argon-high(high)");
  assert.equal(resolveUpstreamModel("ag/gemini-3.8-flash"), "gemini-3.8-flash-medium(medium)");
});

test("requestTranslator - đóng gói đúng cấu trúc envelope của Antigravity", () => {
  const openaiReq = {
    model: "claude-3-7-sonnet",
    messages: [
      { role: "system", content: "Bạn là trợ lý." },
      { role: "user", content: "Viết hàm tính tổng" },
      { role: "assistant", content: "Đây là hàm:" },
    ],
    temperature: 0.7,
    max_tokens: 2048,
  };
  const account = { id: "acc-1", email: "user@gmail.com", projectId: "test-proj-123" };

  const envelope = buildAntigravityEnvelope(openaiReq, account);

  assert.equal(envelope.project, "test-proj-123");
  assert.equal(envelope.model, "claude-sonnet-5-5-high(high)");
  assert.equal(envelope.userAgent, "antigravity");
  assert.ok(envelope.requestId.startsWith("agent/"));
  // Không được chứa requestType: agent trên chat path
  assert.equal(envelope.requestType, undefined);

  assert.equal(envelope.request.systemInstruction.parts[0].text, "Bạn là trợ lý.");
  assert.equal(envelope.request.contents.length, 2);
  assert.equal(envelope.request.contents[0].role, "user");
  assert.equal(envelope.request.contents[0].parts[0].text, "Viết hàm tính tổng");
  assert.equal(envelope.request.contents[1].role, "model");
  assert.equal(envelope.request.generationConfig.temperature, 0.7);
  assert.equal(envelope.request.generationConfig.maxOutputTokens, 2048);
});

test("responseTranslator - chuyển đổi phản hồi non-streaming có suy luận và tool_calls", () => {
  const agResp = {
    response: {
      responseId: "resp-123",
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: "Tôi đang suy nghĩ..." },
              { text: "Kết quả là 42" },
              { functionCall: { name: "save_file", args: { file: "test.txt" } } },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 15,
        candidatesTokenCount: 30,
        totalTokenCount: 45,
      },
    },
  };

  const res = antigravityToOpenAIResponse(agResp, "gemini-4-argon");

  assert.equal(res.id, "resp-123");
  assert.equal(res.choices[0].message.content, "Kết quả là 42");
  assert.equal(res.choices[0].message.reasoning_content, "Tôi đang suy nghĩ...");
  assert.equal(res.choices[0].message.tool_calls.length, 1);
  assert.equal(res.choices[0].message.tool_calls[0].function.name, "save_file");
  assert.equal(res.choices[0].finish_reason, "tool_calls");
  assert.equal(res.usage.prompt_tokens, 15);
  assert.equal(res.usage.completion_tokens, 30);
});

test("responseTranslator - chuyển đổi SSE chunks streaming", () => {
  const state = {};
  const chunk1 = {
    response: {
      candidates: [{ content: { parts: [{ thought: true, text: "Suy nghĩ" }] } }],
    },
  };
  const stream1 = translateAntigravitySSEChunk(chunk1, state, "gemini-4-argon");

  // Chunk mở đầu có vai trò role: assistant và chunk delta suy luận
  assert.equal(stream1.length, 2);
  assert.equal(stream1[0].choices[0].delta.role, "assistant");
  assert.equal(stream1[1].choices[0].delta.reasoning_content, "Suy nghĩ");

  const chunk2 = {
    response: {
      candidates: [{ content: { parts: [{ text: "Nội dung" }] }, finishReason: "STOP" }],
    },
  };
  const stream2 = translateAntigravitySSEChunk(chunk2, state, "gemini-4-argon");
  assert.equal(stream2.length, 2);
  assert.equal(stream2[0].choices[0].delta.content, "Nội dung");
  assert.equal(stream2[1].choices[0].finish_reason, "stop");
});
