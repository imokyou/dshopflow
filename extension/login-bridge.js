// DropShipFlow Login Page Content Script
// Injected into localhost:3000/login to bridge auth to extension

(function() {
  // Only run on login page
  if (window.location.pathname.indexOf("/login") !== 0) return

  // Poll for __DROPSHIPFLOW_TOKEN__ set by the login page
  var CHECK_INTERVAL = 500
  var MAX_CHECKS = 60 // 30 seconds max
  var checks = 0

  var poll = setInterval(function() {
    checks++
    var data = window.__DROPSHIPFLOW_TOKEN__
    if (data) {
      clearInterval(poll)
      chrome.runtime.sendMessage({
        type: "AUTH_SUCCESS",
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user: data.user,
      })
      delete window.__DROPSHIPFLOW_TOKEN__
    }
    if (checks >= MAX_CHECKS) {
      clearInterval(poll)
    }
  }, CHECK_INTERVAL)
})()
