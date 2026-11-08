// Ánh xạ finishReason từ Gemini sang chuẩn OpenAI
export function mapFinishReason(geminiReason, hasToolCalls = false) {
  if (hasToolCalls) return "tool_calls";
  switch (geminiReason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
      return "content_filter";
    case "RECITATION":
      return "content_filter";
    default:
      return "stop";
  }
}

// Chuyển đổi phản hồi JSON không stream của Antigravity sang định dạng OpenAI
export function antigravityToOpenAIResponse(agResponse, requestedModel = "gemini-4-argon") {
  const response = agResponse?.response || agResponse;
  const candidate = response?.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  let content = "";
  let reasoningContent = "";
  const toolCalls = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.thought === true) {
      reasoningContent += part.text || "";
    } else if (part.text !== undefined) {
      content += part.text;
    } else if (part.functionCall) {
      toolCalls.push({
        id: `call_${Date.now()}_${i}`,
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {}),
        },
      });
    }
  }

  const usageMeta = response?.usageMetadata || {};
  const promptTokens = usageMeta.promptTokenCount || 0;
  const completionTokens = usageMeta.candidatesTokenCount || 0;
  const finishReason = mapFinishReason(candidate?.finishReason, toolCalls.length > 0);

  return {
    id: response?.responseId || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || null,
          ...(reasoningContent && { reasoning_content: reasoningContent }),
          ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: usageMeta.totalTokenCount || promptTokens + completionTokens,
    },
  };
}

// Xử lý một đoạn chunk SSE từ Antigravity và tạo các SSE chunk dạng OpenAI
export function translateAntigravitySSEChunk(chunkJson, state, requestedModel = "gemini-4-argon") {
  const response = chunkJson?.response || chunkJson;
  const candidate = response?.candidates?.[0];
  if (!candidate) return [];

  const chunks = [];
  const messageId = state.id || (state.id = response?.responseId || `chatcmpl-${Date.now()}`);
  const created = state.created || (state.created = Math.floor(Date.now() / 1000));

  // Gửi chunk mở đầu chứa role: assistant nếu chưa gửi
  if (!state.roleSent) {
    state.roleSent = true;
    chunks.push({
      id: messageId,
      object: "chat.completion.chunk",
      created,
      model: requestedModel,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    });
  }

  const parts = candidate.content?.parts || [];
  for (const part of parts) {
    if (part.thought === true && part.text) {
      chunks.push({
        id: messageId,
        object: "chat.completion.chunk",
        created,
        model: requestedModel,
        choices: [{ index: 0, delta: { reasoning_content: part.text }, finish_reason: null }],
      });
    } else if (part.text) {
      chunks.push({
        id: messageId,
        object: "chat.completion.chunk",
        created,
        model: requestedModel,
        choices: [{ index: 0, delta: { content: part.text }, finish_reason: null }],
      });
    } else if (part.functionCall) {
      const callIndex = state.toolCallIndex || 0;
      state.toolCallIndex = callIndex + 1;
      state.hasToolCalls = true;
      chunks.push({
        id: messageId,
        object: "chat.completion.chunk",
        created,
        model: requestedModel,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: callIndex,
                  id: `call_${Date.now()}_${callIndex}`,
                  type: "function",
                  function: {
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args || {}),
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
    }
  }

  // Xử lý khi hoàn tất kết quả finish_reason
  if (candidate.finishReason) {
    const reason = mapFinishReason(candidate.finishReason, state.hasToolCalls);
    chunks.push({
      id: messageId,
      object: "chat.completion.chunk",
      created,
      model: requestedModel,
      choices: [{ index: 0, delta: {}, finish_reason: reason }],
    });
  }

  return chunks;
}
