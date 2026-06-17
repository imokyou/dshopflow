// DropShipFlow — 共享运行时配置（后端 / 管理后台 域名）
// 可由用户在侧边栏「⚙ 设置」中自定义；默认 localhost，方便前期本地测试。
// 同时被 service worker（importScripts）与侧边栏（<script>）加载，故声明在全局作用域。

const DEFAULT_API_BASE = "http://localhost:8000"
const DEFAULT_ADMIN_BASE = "http://localhost:3000"

// 去掉尾部斜杠，保证拼接 path 时不出现 //
function trimTrailingSlash(u) {
  return String(u || "").trim().replace(/\/+$/, "")
}

// 读取当前配置（带默认值兜底）
async function getConfig() {
  const { apiBase, adminBase } = await chrome.storage.local.get(["apiBase", "adminBase"])
  return {
    apiBase: trimTrailingSlash(apiBase) || DEFAULT_API_BASE,
    adminBase: trimTrailingSlash(adminBase) || DEFAULT_ADMIN_BASE,
  }
}

// 后端 API 根（含 /api/v1）
async function getApiUrl() {
  return (await getConfig()).apiBase + "/api/v1"
}

// 管理后台根
async function getAdminUrl() {
  return (await getConfig()).adminBase
}

// 把一个 base URL 转成 host_permissions 风格的匹配模式：https://host/* 或 http://host:port/*
function originPattern(base) {
  try {
    const u = new URL(base)
    return `${u.protocol}//${u.host}/*`
  } catch {
    return null
  }
}
