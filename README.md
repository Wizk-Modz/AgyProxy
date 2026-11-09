# AgyProxy

Proxy Google Antigravity (Cloud Code Assist) đa tài khoản với cơ chế điều phối tuần tự (Sequential Fill-First) và tương thích chuẩn OpenAI API.

## Tính Năng Nổi Bật

- **Tương thích chuẩn OpenAI API**: Hỗ trợ đầy đủ `/v1/chat/completions` (cả Streaming SSE và Non-streaming) và `/v1/models`.
- **Hỗ trợ Antigravity Model Catalog**: Gemini 4 Argon, Gemini 3.8/3.7 Flash, Claude Sonnet 5.5, Claude 3.7 Sonnet, Claude Opus 5.5, Claude 3.5 Sonnet, GPT-OSS 120B.
- **Điều phối tuần tự (Sequential Fill-First)**:
  - Cố định trên một tài khoản chính (Ưu tiên #1) xuyên suốt các request.
  - Tuyệt đối không xoay vòng luân chuyển liên tục giữa các request.
  - Chỉ khi tài khoản hiện tại hết hạn ngạch (lỗi 429/409 hoặc 0%), hệ thống mới chuyển sang tài khoản kế tiếp (#2, #3...).
  - Tự động quay lại tài khoản ưu tiên cao hơn khi mốc thời gian hồi phục hạn ngạch (`resetAt`) đã qua.
- **Biên dịch giao thức thông minh**:
  - Tự động chuyển đổi định dạng OpenAI sang Google Antigravity envelope.
  - Làm sạch prompt, loại bỏ tiền tố thương hiệu đối thủ tránh bị phía Google gắn cờ 429 giả lập.
  - Tách nội dung suy luận (`thought: true`) thành `reasoning_content` chuẩn OpenAI.
  - Hỗ trợ Tool Calling / Function Calling với chữ ký suy luận Gemini 3+.
- **Giao diện Web UI trực quan**:
  - Tích hợp sẵn dashboard giám sát tài khoản, thời gian đếm ngược mở khóa khi dính 429.
  - Hỗ trợ đổi thứ tự ưu tiên (▲ ▼), bật/tắt, mở khóa thủ công và đăng nhập Google OAuth 1-click.
  - Chat Playground kiểm tra trực tiếp phản hồi, suy luận (thought/reasoning) và streaming SSE.
  - Không cần build step, 0 external dependencies, tương thích cả desktop và thiết bị di động (Termux browser).
- **Thuần Node.js native**: 0 external dependencies, khởi động tức thì, hoạt động mượt mà trên Linux và Termux (Android).

---

## Cài Đặt & Sử Dụng

### 1. Khởi động máy chủ Proxy & Truy cập Web UI

```bash
# Cổng mặc định là 8080
npm start

# Hoặc tùy chỉnh cổng
PORT=9000 npm start
```

Sau khi khởi động, mở trình duyệt truy cập:
👉 **`http://localhost:8080/`** (hoặc `http://localhost:8080/ui`)

Giao diện Web UI gồm 4 tab:
1. **Tổng quan (Dashboard)**: Thống kê số lượng tài khoản, tài khoản đang được chọn phục vụ liên tục (#1).
2. **Quản lý tài khoản (Accounts)**: Đăng nhập Google OAuth, thêm Refresh Token thủ công, đổi độ ưu tiên, mở khóa thủ công.
3. **Playground**: Trình gửi câu hỏi kiểm tra trực tiếp model (Gemini 2.5 Pro, Flash, Claude 3.7 Sonnet, v.v.), xem reasoning/suy luận.
4. **Hướng dẫn kết nối**: Sao chép 1-click mẫu cấu hình cho Cline, Cursor, OpenAI Python/Node.js SDK, curl.

### 2. Quản lý tài khoản bằng CLI

```bash
# Xem danh sách tài khoản và trạng thái hạn ngạch
node src/cli.js list

# Thêm tài khoản qua refresh token (ưu tiên #1, #2, ...)
node src/cli.js add --token "1//04..." --name "Acc 1" --priority 1
node src/cli.js add --token "1//05..." --name "Acc 2" --priority 2

# Tạo đường dẫn đăng nhập Google OAuth trên trình duyệt
node src/cli.js oauth

# Xóa tài khoản
node src/cli.js remove acc-id
```

---

## Cấu Hình Trong AI Client

### Cursor / Continue / Cline / OpenCode

- **Base URL**: `http://localhost:8080/v1`
- **API Key**: Bất kỳ chuỗi nào (ví dụ: `sk-agyproxy`)
- **Model đề xuất**:
  - `claude-3-7-sonnet` (hoặc `claude-sonnet-5-5-high`)
  - `claude-3-5-sonnet` (hoặc `claude-sonnet-4-6`)
  - `gemini-4-argon` (hoặc `gemini-4-argon-high`)
  - `gemini-3.8-flash` (hoặc `gemini-3.7-flash`)

---

## Kiểm Thử (Tests)

Dự án sử dụng test runner `node:test` và `node:assert` tích hợp sẵn trong Node.js (0 dependency):

```bash
npm test
```
