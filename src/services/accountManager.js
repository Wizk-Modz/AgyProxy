import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { CONFIG } from "../config/index.js";
import {
  GOOGLE_OAUTH_CONFIG,
  ANTIGRAVITY_USER_AGENT,
  getOAuthClientMetadata,
} from "../config/constants.js";

// Khởi tạo và nạp danh sách tài khoản từ file dữ liệu
export async function loadAccounts(filePath = CONFIG.accountsFilePath) {
  try {
    const raw = await readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

// Lưu toàn bộ danh sách tài khoản xuống file dữ liệu
export async function saveAccounts(accounts, filePath = CONFIG.accountsFilePath) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(accounts, null, 2), "utf-8");
}

// Lấy danh sách tài khoản đang hoạt động và sắp xếp theo thứ tự ưu tiên
export async function getActiveAccounts(filePath = CONFIG.accountsFilePath) {
  const accounts = await loadAccounts(filePath);
  return accounts
    .filter((acc) => acc.isActive !== false)
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
}

// Lấy thông tin tài khoản theo mã định danh
export async function getAccountById(id, filePath = CONFIG.accountsFilePath) {
  const accounts = await loadAccounts(filePath);
  return accounts.find((acc) => acc.id === id) || null;
}

// Thêm mới hoặc cập nhật thông tin tài khoản vào hệ thống
export async function upsertAccount(accountData, filePath = CONFIG.accountsFilePath) {
  const accounts = await loadAccounts(filePath);
  const now = Date.now();
  const id = accountData.id || `acc_${now}_${Math.random().toString(36).slice(2, 7)}`;
  const existingIndex = accounts.findIndex((a) => a.id === id || (a.email && a.email === accountData.email));

  const account = {
    id,
    name: accountData.name || accountData.email || id,
    email: accountData.email || "",
    refreshToken: accountData.refreshToken,
    accessToken: accountData.accessToken || "",
    expiresAt: accountData.expiresAt || 0,
    projectId: accountData.projectId || "",
    priority: accountData.priority ?? (existingIndex >= 0 ? accounts[existingIndex].priority : accounts.length + 1),
    isActive: accountData.isActive ?? true,
    createdAt: existingIndex >= 0 ? accounts[existingIndex].createdAt : now,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    accounts[existingIndex] = { ...accounts[existingIndex], ...account, updatedAt: now };
  } else {
    accounts.push(account);
  }

  await saveAccounts(accounts, filePath);
  return account;
}

// Xóa tài khoản khỏi danh sách lưu trữ
export async function removeAccount(id, filePath = CONFIG.accountsFilePath) {
  const accounts = await loadAccounts(filePath);
  const filtered = accounts.filter((acc) => acc.id !== id);
  if (filtered.length !== accounts.length) {
    await saveAccounts(filtered, filePath);
    return true;
  }
  return false;
}

// Làm mới access token của tài khoản từ Google OAuth API
export async function refreshAccountToken(account, filePath = CONFIG.accountsFilePath) {
  if (!account.refreshToken) {
    throw new Error(`Tài khoản ${account.id} không có refreshToken`);
  }

  const response = await fetch(GOOGLE_OAUTH_CONFIG.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      client_id: GOOGLE_OAUTH_CONFIG.clientId,
      client_secret: GOOGLE_OAUTH_CONFIG.clientSecret,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Làm mới token Google thất bại (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const now = Date.now();
  const updatedAccount = {
    ...account,
    accessToken: data.access_token,
    expiresAt: now + (data.expires_in || 3600) * 1000,
    refreshToken: data.refresh_token || account.refreshToken,
    updatedAt: now,
  };

  await upsertAccount(updatedAccount, filePath);
  return updatedAccount;
}

// Kiểm tra và tự động gia hạn token nếu sắp hoặc đã hết hạn
export async function ensureValidToken(account, filePath = CONFIG.accountsFilePath) {
  const LEAD_TIME_MS = 5 * 60 * 1000;
  if (!account.accessToken || !account.expiresAt || account.expiresAt <= Date.now() + LEAD_TIME_MS) {
    return await refreshAccountToken(account, filePath);
  }
  return account;
}

// Lấy thông tin projectId của tài khoản qua API loadCodeAssist
export async function fetchProjectId(accessToken) {
  const metadata = getOAuthClientMetadata();
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_USER_AGENT,
  };

  const response = await fetch(GOOGLE_OAUTH_CONFIG.loadCodeAssistUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ metadata }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Gọi loadCodeAssist thất bại (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const companion = data.cloudaicompanionProject;
  if (typeof companion === "string" && companion.trim()) {
    return companion.trim();
  }
  if (companion && typeof companion === "object" && companion.id) {
    return companion.id.trim();
  }
  return null;
}

// Tạo đường dẫn xác thực Google OAuth 2.0 để người dùng đăng nhập cấp quyền
export function buildOAuthUrl(redirectUri, state = "") {
  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CONFIG.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: GOOGLE_OAUTH_CONFIG.scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
  });
  if (state) {
    params.set("state", state);
  }
  return `${GOOGLE_OAUTH_CONFIG.authorizeUrl}?${params.toString()}`;
}

// Đổi authorization code lấy token và khởi tạo tài khoản mới
export async function exchangeOAuthCode(code, redirectUri, filePath = CONFIG.accountsFilePath) {
  const response = await fetch(GOOGLE_OAUTH_CONFIG.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: GOOGLE_OAUTH_CONFIG.clientId,
      client_secret: GOOGLE_OAUTH_CONFIG.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Đổi authorization code thất bại (${response.status}): ${errText}`);
  }

  const tokens = await response.json();

  // Lấy email người dùng từ userInfo
  let email = "";
  try {
    const userRes = await fetch(`${GOOGLE_OAUTH_CONFIG.userInfoUrl}?alt=json`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (userRes.ok) {
      const userInfo = await userRes.json();
      email = userInfo.email || "";
    }
  } catch {
    // userInfo là tùy chọn
  }

  // Lấy projectId
  let projectId = "";
  try {
    projectId = (await fetchProjectId(tokens.access_token)) || "";
  } catch {
    // Có thể bổ sung sau
  }

  const now = Date.now();
  return await upsertAccount(
    {
      email,
      name: email || `Antigravity Account`,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresAt: now + (tokens.expires_in || 3600) * 1000,
      projectId,
      isActive: true,
    },
    filePath
  );
}
