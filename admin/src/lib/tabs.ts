// 多标签页状态（localStorage + 自定义事件，跨组件同步）
export type Tab = { path: string; title: string }
const KEY = "open_tabs"

function read(): Tab[] {
  if (typeof window === "undefined") return []
  try { return JSON.parse(localStorage.getItem(KEY) || "[]") } catch { return [] }
}
function write(tabs: Tab[]) {
  if (typeof window === "undefined") return
  localStorage.setItem(KEY, JSON.stringify(tabs))
  window.dispatchEvent(new Event("tabs-change"))
}

export function getTabs(): Tab[] { return read() }

export function openTab(path: string, title: string) {
  const tabs = read()
  const i = tabs.findIndex(t => t.path === path)
  if (i >= 0) {
    if (title && tabs[i].title !== title) { tabs[i].title = title; write(tabs) }
  } else {
    tabs.push({ path, title: title || path }); write(tabs)
  }
}

export function setTabTitle(path: string, title: string) {
  if (!title) return
  const tabs = read()
  const t = tabs.find(x => x.path === path)
  if (t && t.title !== title) { t.title = title; write(tabs) }
}

export function closeTab(path: string): Tab[] {
  const tabs = read().filter(t => t.path !== path)
  write(tabs)
  return tabs
}

// 保存（用于拖拽排序后的新顺序）
export function setTabs(tabs: Tab[]) {
  write([...tabs])
}
