import { PROMPT_REWRITES } from "../config/constants.js";

// Làm sạch nội dung văn bản prompt, loại bỏ các tiền tố nhận diện đối thủ
export function cleanPromptText(text) {
  if (typeof text !== "string") return text;
  let cleaned = text;
  for (const { from, to } of PROMPT_REWRITES) {
    cleaned = cleaned.replaceAll(from, to);
  }
  return cleaned;
}

// Chuẩn hóa tên hàm cho phù hợp với quy tắc của Gemini API
export function sanitizeFunctionName(name) {
  if (!name || typeof name !== "string") return "_function";
  let s = name.replace(/[^a-zA-Z0-9_.:\-]/g, "_");
  if (!/^[a-zA-Z_]/.test(s)) s = `_${s}`;
  return s.slice(0, 64);
}

// Làm sạch lược đồ JSON tham số hàm để loại bỏ các trường không tương thích
export function cleanJSONSchemaForAntigravity(schema) {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: { reason: { type: "string" } } };
  }
  const copy = structuredClone(schema);
  delete copy.$schema;
  delete copy.$id;
  delete copy.title;
  delete copy.definitions;
  delete copy.$defs;
  return copy;
}
