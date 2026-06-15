import { setAuth, loadAuth, clearAuth } from "../lib/api"

// Listen for auth messages from Web admin
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === "AUTH_SUCCESS" && sender.url?.startsWith("https://admin.dropshipflow.com")) {
    setAuth(message.access_token, message.user)
    sendResponse({ success: true })
    return true
  }
})

// Initialize auth on service worker start
loadAuth().then(ok => {
  console.log("DropShipFlow: auth loaded =", ok)
})

// Handle messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_AUTH_STATUS") {
    sendResponse({ loggedIn: !!msg._tokenCheck })
    return true
  }
  if (msg.type === "LOGOUT") {
    clearAuth()
    sendResponse({ success: true })
    return true
  }
  if (msg.type === "OPEN_LOGIN") {
    chrome.tabs.create({ url: "https://admin.dropshipflow.com/login?source=extension" })
    sendResponse({ success: true })
    return true
  }
})
