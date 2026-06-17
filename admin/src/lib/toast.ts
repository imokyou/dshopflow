// 轻量全局 toast —— 直接挂到 document.body，无需在组件树里接 Provider。
// 用于替换页面里被吞掉的空 catch{}，让加载/操作失败对用户可见。

type ToastType = "error" | "success" | "info"

const COLORS: Record<ToastType, { bg: string; fg: string; border: string }> = {
  error: { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" },
  success: { bg: "#f0fdf4", fg: "#15803d", border: "#bbf7d0" },
  info: { bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe" },
}

function ensureContainer(): HTMLElement | null {
  if (typeof document === "undefined") return null
  let c = document.getElementById("__toast_container")
  if (!c) {
    c = document.createElement("div")
    c.id = "__toast_container"
    c.style.cssText =
      "position:fixed;top:16px;right:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;max-width:360px;"
    document.body.appendChild(c)
  }
  return c
}

export function toast(message: string, type: ToastType = "error", durationMs = 4000) {
  const c = ensureContainer()
  if (!c) return
  const { bg, fg, border } = COLORS[type]
  const el = document.createElement("div")
  el.style.cssText =
    `background:${bg};color:${fg};border:1px solid ${border};padding:10px 14px;` +
    "border-radius:8px;font-size:13px;line-height:1.4;box-shadow:0 4px 12px rgba(0,0,0,.08);" +
    "opacity:0;transform:translateY(-6px);transition:opacity .15s,transform .15s;word-break:break-word;"
  el.textContent = message
  c.appendChild(el)
  requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateY(0)" })
  const remove = () => {
    el.style.opacity = "0"; el.style.transform = "translateY(-6px)"
    setTimeout(() => el.remove(), 200)
  }
  setTimeout(remove, durationMs)
  el.addEventListener("click", remove)
}

// 便捷：从未知错误对象提取消息并弹错误条
export function toastError(e: unknown, fallback = "操作失败") {
  const msg = e instanceof Error ? e.message : (typeof e === "string" ? e : fallback)
  toast(msg || fallback, "error")
}
