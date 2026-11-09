// Trạng thái cục bộ của giao diện Web UI
const state = {
  accounts: [],
  status: null,
  models: [],
  activeTab: "dashboard",
  countdownTimer: null,
};

// Hiển thị thông báo toast nổi trên góc màn hình
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${type === "success" ? "✅" : "⚠️"}</span> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

// Chống chèn mã độc HTML
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Chuyển đổi tab điều hướng
function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-content").forEach((pane) => {
    pane.classList.toggle("active", pane.id === `tab-${tabName}`);
  });
}

// Tải thông tin trạng thái hệ thống
async function fetchStatus() {
  try {
    const res = await fetch("/api/status");
    if (!res.ok) return;
    state.status = await res.json();
    renderStatusMetrics();
  } catch {
    // Lỗi mạng tạm thời
  }
}

// Tải danh sách tài khoản từ API
async function fetchAccounts() {
  try {
    const res = await fetch("/api/accounts");
    if (!res.ok) return;
    const data = await res.json();
    state.accounts = (data.accounts || []).sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
    renderAccounts();
    renderStatusMetrics();
  } catch {
    // Lỗi mạng tạm thời
  }
}

// Tải danh sách model có sẵn
async function fetchModels() {
  try {
    const res = await fetch("/v1/models");
    if (!res.ok) return;
    const data = await res.json();
    state.models = data.data || [];
    renderModelSelect();
  } catch {
    // Lỗi mạng tạm thời
  }
}

// Cập nhật các chỉ số tổng quan trên dashboard
function renderStatusMetrics() {
  const total = state.accounts.length;
  const active = state.accounts.filter((a) => a.isActive !== false);
  const locked = state.accounts.filter((a) => a.isLocked);
  const available = active.filter((a) => !a.isLocked);

  const elTotal = document.getElementById("metric-total");
  const elAvailable = document.getElementById("metric-available");
  const elLocked = document.getElementById("metric-locked");
  const elActiveAccount = document.getElementById("active-account-card");
  const headerStatus = document.getElementById("header-status-text");

  if (elTotal) elTotal.textContent = total;
  if (elAvailable) elAvailable.textContent = available.length;
  if (elLocked) elLocked.textContent = locked.length;
  if (headerStatus) {
    headerStatus.textContent = available.length > 0 ? `${available.length} sẵn sàng` : "Chưa có tài khoản";
  }

  if (elActiveAccount) {
    if (available.length > 0) {
      const top = available[0];
      elActiveAccount.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:700; font-size:1.05rem; color:#f1f5f9;">${escapeHtml(top.name || top.email)}</div>
            <div style="font-size:0.8rem; color:#94a3b8; font-family:var(--font-mono);">${escapeHtml(top.email || "Không có email")}</div>
            <div style="font-size:0.75rem; color:#64748b; font-family:var(--font-mono); margin-top:2px;">Project ID: ${escapeHtml(top.projectId || "Tự động")}</div>
          </div>
          <div style="text-align:right;">
            <span class="badge-priority">Ưu tiên #${top.priority}</span>
            <div style="margin-top:6px;"><span class="badge badge-success">Đang phục vụ liên tục</span></div>
          </div>
        </div>
      `;
    } else if (total > 0) {
      elActiveAccount.innerHTML = `
        <div style="color:#f59e0b;">
          ⚠️ Tất cả ${total} tài khoản hiện đang bị khóa do vượt hạn ngạch. Vui lòng chờ đến khi mở khóa hoặc mở khóa thủ công trong tab Quản lý tài khoản.
        </div>
      `;
    } else {
      elActiveAccount.innerHTML = `
        <div style="color:#94a3b8;">
          Chưa có tài khoản Antigravity nào. Hãy nhấn <strong>Thêm tài khoản</strong> để kết nối tài khoản Google.
        </div>
      `;
    }
  }
}

// Hiển thị danh sách tài khoản trong bảng quản lý
function renderAccounts() {
  const tbody = document.getElementById("accounts-tbody");
  const emptyState = document.getElementById("accounts-empty");
  if (!tbody) return;

  if (state.accounts.length === 0) {
    tbody.innerHTML = "";
    if (emptyState) emptyState.style.display = "block";
    return;
  }

  if (emptyState) emptyState.style.display = "none";

  const rows = state.accounts.map((acc, index) => {
    let statusBadge = '<span class="badge badge-success">Sẵn sàng</span>';
    let countdownText = "";
    let unlockBtn = "";

    if (acc.isLocked && acc.lockedUntil) {
      const until = new Date(acc.lockedUntil).getTime();
      const remainingSec = Math.max(0, Math.round((until - Date.now()) / 1000));
      const mm = String(Math.floor(remainingSec / 60)).padStart(2, "0");
      const ss = String(remainingSec % 60).padStart(2, "0");
      countdownText = `<div style="font-size:0.75rem; color:#ef4444; margin-top:4px;">Mở khóa sau: ${mm}:${ss}</div>`;
      statusBadge = '<span class="badge badge-danger">Hạn ngạch (429)</span>';
      unlockBtn = `<button class="btn btn-secondary btn-sm" onclick="unlockAccount('${acc.id}')" title="Mở khóa tài khoản ngay">🔓 Mở khóa</button>`;
    } else if (acc.isLocked) {
      statusBadge = '<span class="badge badge-warning">Đang khóa</span>';
      unlockBtn = `<button class="btn btn-secondary btn-sm" onclick="unlockAccount('${acc.id}')" title="Mở khóa tài khoản ngay">🔓 Mở khóa</button>`;
    }

    if (acc.isActive === false) {
      statusBadge = '<span class="badge" style="background:#334155;color:#94a3b8;">Tắt</span>';
    }

    const isFirst = index === 0;
    const isLast = index === state.accounts.length - 1;

    return `
      <tr>
        <td style="width: 80px;">
          <div style="display:flex; align-items:center; gap:4px;">
            <span class="badge-priority">#${acc.priority}</span>
            <div style="display:flex; flex-direction:column; gap:2px;">
              <button class="btn btn-secondary btn-icon" style="height:18px;width:18px;padding:0;font-size:10px;" ${isFirst ? "disabled" : ""} onclick="moveAccountPriority('${acc.id}', -1)" title="Tăng ưu tiên">▲</button>
              <button class="btn btn-secondary btn-icon" style="height:18px;width:18px;padding:0;font-size:10px;" ${isLast ? "disabled" : ""} onclick="moveAccountPriority('${acc.id}', 1)" title="Giảm ưu tiên">▼</button>
            </div>
          </div>
        </td>
        <td>
          <div class="account-identity">
            <span class="account-name">${escapeHtml(acc.name || acc.email || acc.id)}</span>
            <span class="account-email">${escapeHtml(acc.email || "Không có email")}</span>
          </div>
        </td>
        <td>
          <span class="account-project">${escapeHtml(acc.projectId || "Tự động phân bổ")}</span>
        </td>
        <td>
          <div>
            ${statusBadge}
            ${countdownText}
          </div>
        </td>
        <td>
          <label style="cursor:pointer; display:flex; align-items:center; gap:6px;">
            <input type="checkbox" ${acc.isActive !== false ? "checked" : ""} onchange="toggleAccountActive('${acc.id}', this.checked)">
            <span style="font-size:0.8rem; color:${acc.isActive !== false ? "#10b981" : "#94a3b8"};">${acc.isActive !== false ? "Bật" : "Tắt"}</span>
          </label>
        </td>
        <td>
          <div style="display:flex; gap:6px; align-items:center;">
            ${unlockBtn}
            <button class="btn btn-danger btn-sm" onclick="deleteAccount('${acc.id}', '${escapeHtml(acc.name || acc.email || acc.id)}')" title="Xóa tài khoản">🗑️ Xóa</button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = rows.join("");
}

// Cập nhật danh sách model trong dropdown
function renderModelSelect() {
  const select = document.getElementById("playground-model");
  if (!select) return;

  const popular = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-thinking", "claude-3-7-sonnet", "claude-3-5-sonnet"];
  const list = state.models.length > 0 ? state.models.map((m) => m.id) : popular;

  select.innerHTML = list
    .map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`)
    .join("");
}

// Thay đổi độ ưu tiên của tài khoản (lên hoặc xuống)
async function moveAccountPriority(accountId, delta) {
  const index = state.accounts.findIndex((a) => a.id === accountId);
  if (index === -1) return;
  const targetIndex = index + delta;
  if (targetIndex < 0 || targetIndex >= state.accounts.length) return;

  const current = state.accounts[index];
  const target = state.accounts[targetIndex];

  // Hoán đổi priority giữa hai tài khoản
  const tempPriority = current.priority;
  current.priority = target.priority;
  target.priority = tempPriority;

  if (current.priority === target.priority) {
    if (delta < 0) {
      current.priority = Math.max(1, target.priority - 1);
    } else {
      current.priority = target.priority + 1;
    }
  }

  // Cập nhật optimistic UI
  state.accounts.sort((a, b) => a.priority - b.priority);
  renderAccounts();

  try {
    await Promise.all([
      fetch(`/api/accounts/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: current.priority }),
      }),
      fetch(`/api/accounts/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: target.priority }),
      }),
    ]);
    showToast("Đã cập nhật thứ tự ưu tiên tài khoản");
    await fetchAccounts();
  } catch (err) {
    showToast(`Cập nhật thứ tự thất bại: ${err.message}`, "error");
    await fetchAccounts();
  }
}

// Bật hoặc tắt trạng thái hoạt động của tài khoản
async function toggleAccountActive(accountId, isActive) {
  try {
    const res = await fetch(`/api/accounts/${accountId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    if (!res.ok) throw new Error("Cập nhật thất bại");
    showToast(`Đã ${isActive ? "bật" : "tắt"} tài khoản`);
    await fetchAccounts();
  } catch (err) {
    showToast(err.message, "error");
    await fetchAccounts();
  }
}

// Mở khóa tài khoản bị dính hạn ngạch thủ công
async function unlockAccount(accountId) {
  try {
    const res = await fetch(`/api/accounts/${accountId}/unlock`, { method: "POST" });
    if (!res.ok) throw new Error("Mở khóa thất bại");
    showToast("Đã mở khóa tài khoản thành công");
    await fetchAccounts();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Xóa tài khoản khỏi hệ thống
async function deleteAccount(accountId, name) {
  if (!confirm(`Bạn có chắc chắn muốn xóa tài khoản "${name}"?`)) return;
  try {
    const res = await fetch(`/api/accounts/${accountId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Xóa tài khoản thất bại");
    showToast("Đã xóa tài khoản thành công");
    await fetchAccounts();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Mở trang đăng nhập Google OAuth
async function startOAuthFlow() {
  try {
    const res = await fetch("/api/oauth/url");
    const data = await res.json();
    if (!data.url) throw new Error("Không lấy được đường dẫn OAuth");

    const w = 600;
    const h = 700;
    const left = window.screen.width / 2 - w / 2;
    const top = window.screen.height / 2 - h / 2;
    window.open(data.url, "GoogleOAuth", `width=${w},height=${h},top=${top},left=${left}`);
    showToast("Đã mở cửa sổ đăng nhập Google. Hãy hoàn tất cấp quyền.", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Đổi mã authorization code thủ công
async function submitManualCode() {
  const input = document.getElementById("oauth-manual-code");
  const code = input?.value.trim();
  if (!code) {
    showToast("Vui lòng nhập authorization code", "error");
    return;
  }

  try {
    const res = await fetch("/api/oauth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Đổi token thất bại");
    showToast(`Thành công! Đã thêm tài khoản ${data.account.email || data.account.name}`);
    if (input) input.value = "";
    closeAddModal();
    await fetchAccounts();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Lưu tài khoản bằng Refresh Token thủ công
async function submitManualRefreshToken(e) {
  e.preventDefault();
  const tokenInput = document.getElementById("manual-token");
  const nameInput = document.getElementById("manual-name");
  const priorityInput = document.getElementById("manual-priority");

  const refreshToken = tokenInput?.value.trim();
  const name = nameInput?.value.trim();
  const priority = priorityInput?.value ? parseInt(priorityInput.value, 10) : undefined;

  if (!refreshToken) {
    showToast("Vui lòng nhập Refresh Token", "error");
    return;
  }

  try {
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken, name, priority }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Thêm tài khoản thất bại");
    showToast(`Đã thêm tài khoản: ${data.account.name || data.account.id}`);
    if (tokenInput) tokenInput.value = "";
    if (nameInput) nameInput.value = "";
    closeAddModal();
    await fetchAccounts();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Mở modal thêm tài khoản
function openAddModal() {
  const modal = document.getElementById("add-account-modal");
  if (modal) modal.classList.add("active");
}

// Đóng modal thêm tài khoản
function closeAddModal() {
  const modal = document.getElementById("add-account-modal");
  if (modal) modal.classList.remove("active");
}

// Gửi yêu cầu kiểm tra tới API Chat Completions
async function runChatPlayground() {
  const model = document.getElementById("playground-model")?.value || "gemini-2.5-pro";
  const systemPrompt = document.getElementById("playground-system")?.value.trim();
  const userPrompt = document.getElementById("playground-user")?.value.trim();
  const isStream = document.getElementById("playground-stream")?.checked ?? true;
  const temperature = parseFloat(document.getElementById("playground-temp")?.value || "0.7");

  if (!userPrompt) {
    showToast("Vui lòng nhập câu hỏi của bạn", "error");
    return;
  }

  const btn = document.getElementById("playground-submit-btn");
  const reasoningBox = document.getElementById("playground-reasoning");
  const reasoningContent = document.getElementById("playground-reasoning-content");
  const responseBox = document.getElementById("playground-response");
  const statusInfo = document.getElementById("playground-status-info");

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Đang gửi...";
  }

  if (reasoningBox) reasoningBox.style.display = "none";
  if (reasoningContent) reasoningContent.textContent = "";
  if (responseBox) responseBox.textContent = "Đang chờ phản hồi từ Antigravity...";
  if (statusInfo) statusInfo.textContent = "";

  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: userPrompt });

  const startTime = Date.now();

  try {
    const res = await fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: isStream,
        temperature,
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error?.message || `Lỗi HTTP ${res.status}`);
    }

    if (!isStream) {
      const json = await res.json();
      const duration = Date.now() - startTime;
      const choice = json.choices?.[0];
      const thought = choice?.message?.reasoning_content || "";
      const text = choice?.message?.content || "(Không có nội dung trả về)";

      if (thought && reasoningBox && reasoningContent) {
        reasoningBox.style.display = "block";
        reasoningContent.textContent = thought;
      }
      if (responseBox) responseBox.textContent = text;
      if (statusInfo) {
        statusInfo.textContent = `200 OK • ${duration}ms • Model: ${json.model || model}`;
      }
    } else {
      if (responseBox) responseBox.textContent = "";
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullThought = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const chunkStr = trimmed.slice(5).trim();
          if (chunkStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(chunkStr);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.reasoning_content) {
              fullThought += delta.reasoning_content;
              if (reasoningBox && reasoningContent) {
                reasoningBox.style.display = "block";
                reasoningContent.textContent = fullThought;
              }
            }
            if (delta?.content) {
              fullContent += delta.content;
              if (responseBox) responseBox.textContent = fullContent;
            }
          } catch {
            // Bỏ qua dòng lỗi parse
          }
        }
      }

      const duration = Date.now() - startTime;
      if (statusInfo) {
        statusInfo.textContent = `Stream hoàn tất • ${duration}ms • Model: ${model}`;
      }
    }
  } catch (err) {
    if (responseBox) {
      responseBox.textContent = `Lỗi: ${err.message}`;
    }
    if (statusInfo) {
      statusInfo.textContent = `Thất bại • ${Date.now() - startTime}ms`;
    }
    showToast(err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🚀 Gửi yêu cầu";
    }
  }
}

// Sao chép nội dung văn bản vào clipboard
function copyToClipboard(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const text = el.innerText || el.textContent;
  navigator.clipboard.writeText(text).then(
    () => showToast("Đã sao chép vào bộ nhớ tạm"),
    () => showToast("Không thể sao chép văn bản", "error")
  );
}

// Cập nhật động đường dẫn baseURL trong phần hướng dẫn kết nối
function updateSetupBaseUrls() {
  const origin = window.location.origin;
  const baseUrlElements = document.querySelectorAll(".setup-base-url");
  baseUrlElements.forEach((el) => {
    el.textContent = `${origin}/v1`;
  });
}

// Lắng nghe thông báo hoàn tất từ popup OAuth Google
window.addEventListener("message", (event) => {
  if (event.data?.type === "AGY_OAUTH_SUCCESS") {
    showToast(`Đã thêm thành công tài khoản: ${event.data.email}`);
    closeAddModal();
    fetchAccounts();
  }
});

// Khởi tạo toàn bộ giao diện khi tải trang
document.addEventListener("DOMContentLoaded", () => {
  // Bắt sự kiện tab
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // Modal thêm tài khoản
  document.getElementById("btn-open-add")?.addEventListener("click", openAddModal);
  document.getElementById("btn-close-modal")?.addEventListener("click", closeAddModal);
  document.getElementById("btn-oauth-start")?.addEventListener("click", startOAuthFlow);
  document.getElementById("btn-oauth-submit-code")?.addEventListener("click", submitManualCode);
  document.getElementById("form-manual-token")?.addEventListener("submit", submitManualRefreshToken);

  // Tab con trong modal (OAuth vs Manual Token)
  document.querySelectorAll(".modal-subtab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".modal-subtab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const sub = btn.dataset.subtab;
      document.getElementById("subtab-oauth").style.display = sub === "oauth" ? "block" : "none";
      document.getElementById("subtab-manual").style.display = sub === "manual" ? "block" : "none";
    });
  });

  // Chat Playground
  document.getElementById("playground-submit-btn")?.addEventListener("click", runChatPlayground);

  // Cập nhật baseURL
  updateSetupBaseUrls();

  // Nạp dữ liệu ban đầu
  fetchAccounts();
  fetchStatus();
  fetchModels();

  // Polling chu kỳ 8s để cập nhật trạng thái hạn ngạch
  setInterval(() => {
    fetchAccounts();
    fetchStatus();
  }, 8000);

  // Đếm ngược từng giây cho các tài khoản đang bị khóa
  setInterval(() => {
    let hasLocked = false;
    state.accounts.forEach((acc) => {
      if (acc.isLocked && acc.lockedUntil) hasLocked = true;
    });
    if (hasLocked) renderAccounts();
  }, 1000);
});
