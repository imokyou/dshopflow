// DropShipFlow Background Service Worker
const API = "http://localhost:8000/api/v1"

// 点击工具栏图标 → 打开右侧侧边栏
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(err => console.warn("sidePanel setPanelBehavior failed:", err))

// Receive auth from web login page (external message — deprecated, kept for compat)
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (msg.type === "AUTH_SUCCESS") {
    chrome.storage.local.set({
      access_token: msg.access_token,
      refresh_token: msg.refresh_token,
      user: msg.user
    })
    sendResponse({ ok: true })
    return true
  }
})

// Internal messages (from popup, content scripts)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Auth from login-bridge content script
  if (msg.type === "AUTH_SUCCESS") {
    chrome.storage.local.set({
      access_token: msg.access_token,
      refresh_token: msg.refresh_token,
      user: msg.user
    }, () => {
      sendResponse({ ok: true })
    })
    return true
  }

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
  const { access_token } = await chrome.storage.local.get("access_token")
  const headers = { "Content-Type": "application/json" }
  if (access_token) headers["Authorization"] = `Bearer ${access_token}`
  const resp = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data.detail || resp.statusText)
  return data
}
