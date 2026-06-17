// DropShipFlow Background Service Worker
// 注：不用 importScripts（SW 中加载同级脚本不稳定，曾报 NetworkError）。
// background 只需 getApiUrl()，故内联一份精简实现，自包含。
const DEFAULT_API_BASE = "http://localhost:8000"
async function getApiUrl() {
  const { apiBase } = await chrome.storage.local.get("apiBase")
  const base = (String(apiBase || "").trim().replace(/\/+$/, "")) || DEFAULT_API_BASE
  return base + "/api/v1"
}

// 点击工具栏图标 → 打开右侧侧边栏
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(err => console.warn("sidePanel setPanelBehavior failed:", err))

// 内部消息（来自 popup / content scripts）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_AUTH") {
    chrome.storage.local.get(["access_token", "user"], data => sendResponse(data))
    return true
  }
  if (msg.type === "LOGOUT") {
    chrome.storage.local.remove(["access_token", "refresh_token", "user"], () => sendResponse({ ok: true }))
    return true
  }
  if (msg.type === "API_REQUEST") {
    apiCall(msg.method, msg.path, msg.body).then(sendResponse).catch(e => sendResponse({ error: e.message }))
    return true
  }
})

async function apiCall(method, path, body) {
  const API = await getApiUrl()
  const { access_token } = await chrome.storage.local.get("access_token")
  const headers = { "Content-Type": "application/json" }
  if (access_token) headers["Authorization"] = `Bearer ${access_token}`
  const resp = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data.detail || resp.statusText)
  return data
}
