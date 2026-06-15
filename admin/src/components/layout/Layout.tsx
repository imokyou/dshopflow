"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { isLoggedIn, clearTokens, getToken } from "@/lib/api"
import { getTabs, openTab, closeTab, setTabs as saveTabs, type Tab } from "@/lib/tabs"

const superAdminNav = [
  { icon: "🏊", label: "选品池", href: "/product-pool" },
  { icon: "📊", label: "团队总览", href: "/dashboard" },
  { icon: "🟢", label: "在线监控", href: "/sessions" },
  { icon: "💳", label: "订阅套餐", href: "/plans" },
  { icon: "📏", label: "配额规则", href: "/quota-rules" },
  { icon: "🤖", label: "AI 提供商", href: "/ai-providers" },
  { icon: "👥", label: "用户管理", href: "/teams" },
  { icon: "📋", label: "审计日志", href: "/audit-logs" },
]
const userNav = [
  { icon: "🏊", label: "选品池", href: "/product-pool" },
  { icon: "🕒", label: "转入队列", href: "/transfer-jobs" },
  { icon: "📦", label: "商品管理", href: "/products" },
  { icon: "🔄", label: "导入任务", href: "/imports" },
  { icon: "🏪", label: "店铺管理", href: "/shops" },
  { icon: "💰", label: "定价规则", href: "/pricing" },
  { icon: "🏷️", label: "SPU规则", href: "/spu-rules" },
]

// 路由 → 标题（用于 tab 与面包屑）
const TITLES: Record<string, string> = Object.fromEntries(
  [...superAdminNav, ...userNav].map(n => [n.href, n.label])
)
TITLES["/profile"] = "个人中心"
TITLES["/products/new"] = "添加商品"

function routeTitle(path: string): string {
  if (TITLES[path]) return TITLES[path]
  if (/^\/products\/[^/]+$/.test(path)) return "商品详情"
  return path
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [role, setRole] = useState("")
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const dragIdx = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number; idx: number } | null>(null)

  useEffect(() => {
    if (!isLoggedIn() && pathname !== "/login") { router.push("/login"); return }
    const t = getToken()
    if (t) {
      try { const p = JSON.parse(atob(t.split(".")[1])); setUser(p); setRole(p.role || "") } catch { }
    }
    try { setCollapsed(localStorage.getItem("sidebarCollapsed") === "1") } catch { }
  }, [pathname])

  // 记录当前页为一个 tab
  useEffect(() => {
    if (!pathname || pathname === "/login") return
    openTab(pathname, routeTitle(pathname))
    setTabs(getTabs())
  }, [pathname])

  // 监听 tab 变化
  useEffect(() => {
    const h = () => setTabs(getTabs())
    window.addEventListener("tabs-change", h)
    window.addEventListener("storage", h)
    return () => { window.removeEventListener("tabs-change", h); window.removeEventListener("storage", h) }
  }, [])

  // 点击外部关闭用户菜单
  useEffect(() => {
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [])

  const toggleCollapse = () => { const v = !collapsed; setCollapsed(v); try { localStorage.setItem("sidebarCollapsed", v ? "1" : "0") } catch { } }
  const logout = () => { clearTokens(); router.push("/login") }

  const onCloseTab = (e: React.MouseEvent, path: string) => {
    e.stopPropagation(); e.preventDefault()
    const left = closeTab(path)
    setTabs(left)
    if (path === pathname) {
      const next = left[left.length - 1]
      router.push(next ? next.path : "/product-pool")
    }
  }

  const onDrop = (to: number) => {
    const from = dragIdx.current
    dragIdx.current = null; setDragOver(null)
    if (from === null || from === to) return
    const arr = [...tabs]
    const [moved] = arr.splice(from, 1)
    arr.splice(to, 0, moved)
    setTabs(arr)
    saveTabs(arr)
  }

  // 应用新的 tab 列表并在必要时导航
  const applyTabs = (arr: Tab[], keepPath?: string) => {
    setTabs(arr); saveTabs(arr); setCtx(null)
    if (arr.length === 0) { router.push("/product-pool"); return }
    if (!arr.some(t => t.path === pathname)) {
      router.push(keepPath && arr.some(t => t.path === keepPath) ? keepPath : arr[arr.length - 1].path)
    }
  }
  const closeOthers = (i: number) => applyTabs([tabs[i]], tabs[i].path)
  const closeLeft = (i: number) => applyTabs(tabs.slice(i), tabs[i].path)
  const closeRight = (i: number) => applyTabs(tabs.slice(0, i + 1), tabs[i].path)
  const closeAll = () => applyTabs([])

  const isSuperAdmin = role === "super_admin"
  const navItems = isSuperAdmin ? superAdminNav : userNav
  const roleLabel = isSuperAdmin ? "超级管理员" : role === "manager" ? "管理者" : "团队成员"

  return (
    <div className="app-layout" style={{ ["--sidebar-w" as any]: collapsed ? "62px" : "220px" }}>
      {/* Mobile hamburger */}
      <button onClick={() => setSidebarOpen(!sidebarOpen)}
        style={{ display: "none", position: "fixed", top: 12, left: 12, zIndex: 30, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--gray-200)", background: "#fff", fontSize: "1.2rem", cursor: "pointer" }}
        className="md:hidden">☰</button>
      {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", zIndex: 15 }} />}

      {/* Sidebar */}
      <nav className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-brand" style={{ justifyContent: collapsed ? "center" : "flex-start" }}>
          <span className="icon">{isSuperAdmin ? "👑" : "⚡"}</span>
          {!collapsed && "DropShipFlow"}
        </div>

        {!collapsed && <div className="nav-section">{isSuperAdmin ? "全局管理" : "主菜单"}</div>}
        {collapsed && <div style={{ height: 8 }} />}
        {navItems.map(item => (
          <Link key={item.href} href={item.href} style={{ textDecoration: "none" }} onClick={() => setSidebarOpen(false)} title={item.label}>
            <div className={`nav-item ${pathname === item.href ? "active" : ""}`} style={collapsed ? { justifyContent: "center", padding: "10px 0" } : undefined}>
              <span className="nav-icon">{item.icon}</span> {!collapsed && item.label}
            </div>
          </Link>
        ))}
      </nav>

      {/* Main */}
      <div className="main-content" style={{ padding: 0, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        {/* 顶栏 */}
        <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 14px", height: 48, background: "#fff", borderBottom: "1px solid var(--gray-200)", position: "sticky", top: 0, zIndex: 18 }}>
          <button onClick={toggleCollapse} title={collapsed ? "展开侧边栏" : "收起侧边栏"}
            style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "var(--gray-600)", padding: 4 }}>
            {collapsed ? "»" : "«"}
          </button>
          <span style={{ fontSize: ".9rem", fontWeight: 600, color: "var(--gray-700)" }}>{routeTitle(pathname)}</span>

          {/* 右上角用户 */}
          <div style={{ marginLeft: "auto", position: "relative" }} ref={menuRef}>
            <button onClick={() => setMenuOpen(!menuOpen)}
              style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--gray-200)", background: "#fff", borderRadius: 20, padding: "4px 10px 4px 4px", cursor: "pointer" }}>
              <span style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,var(--primary),#8b5cf6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".8rem", fontWeight: 700 }}>
                {(user?.email || "U")[0]?.toUpperCase()}
              </span>
              <span style={{ fontSize: ".82rem", color: "var(--gray-700)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email || "未登录"}</span>
              <span style={{ fontSize: ".6rem", color: "var(--gray-400)" }}>▼</span>
            </button>
            {menuOpen && (
              <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "#fff", border: "1px solid var(--gray-200)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.12)", minWidth: 180, overflow: "hidden", zIndex: 30 }}>
                <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--gray-100)" }}>
                  <div style={{ fontSize: ".82rem", fontWeight: 600, color: "var(--gray-800)", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.email}</div>
                  <div style={{ fontSize: ".7rem", color: "var(--gray-400)", marginTop: 2 }}>{roleLabel}</div>
                </div>
                <Link href="/profile" onClick={() => setMenuOpen(false)} style={{ textDecoration: "none" }}>
                  <div style={{ padding: "9px 14px", fontSize: ".82rem", color: "var(--gray-700)", cursor: "pointer" }} className="menu-row">⚙️ 个人中心</div>
                </Link>
                <div onClick={logout} style={{ padding: "9px 14px", fontSize: ".82rem", color: "var(--red)", cursor: "pointer", borderTop: "1px solid var(--gray-100)" }} className="menu-row">🚪 退出登录</div>
              </div>
            )}
          </div>
        </header>

        {/* 多标签页 */}
        <div style={{ display: "flex", gap: 4, padding: "6px 10px", background: "var(--gray-50)", borderBottom: "1px solid var(--gray-200)", overflowX: "auto", whiteSpace: "nowrap", position: "sticky", top: 48, zIndex: 17 }}>
          {tabs.map((tab, idx) => {
            const active = tab.path === pathname
            return (
              <div key={tab.path} onClick={() => router.push(tab.path)}
                draggable
                onDragStart={() => { dragIdx.current = idx }}
                onDragOver={e => { e.preventDefault(); if (dragOver !== idx) setDragOver(idx) }}
                onDragLeave={() => { if (dragOver === idx) setDragOver(null) }}
                onDrop={() => onDrop(idx)}
                onDragEnd={() => { dragIdx.current = null; setDragOver(null) }}
                onContextMenu={e => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, idx }) }}
                title="可拖动排序 · 右键更多操作"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px 4px 12px", borderRadius: 6, fontSize: ".78rem", cursor: "grab",
                  background: active ? "#fff" : "transparent", color: active ? "var(--primary)" : "var(--gray-600)",
                  border: `1px solid ${dragOver === idx ? "var(--primary)" : active ? "var(--primary)" : "var(--gray-200)"}`,
                  boxShadow: dragOver === idx ? "0 0 0 2px var(--primary-50)" : "none",
                  fontWeight: active ? 600 : 400 }}>
                <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{tab.title}</span>
                {tabs.length > 1 && (
                  <span onClick={e => onCloseTab(e, tab.path)} title="关闭"
                    style={{ fontSize: ".9rem", lineHeight: 1, color: "var(--gray-400)", padding: "0 2px", borderRadius: 4 }}>×</span>
                )}
              </div>
            )
          })}
        </div>

        {/* 内容 */}
        <main style={{ flex: 1, padding: 12, minWidth: 0 }}>{children}</main>
      </div>

      {/* tab 右键菜单 */}
      {ctx && (
        <>
          <div onClick={() => setCtx(null)} onContextMenu={e => { e.preventDefault(); setCtx(null) }}
            style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{ position: "fixed", left: Math.min(ctx.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 160), top: ctx.y, zIndex: 41, background: "#fff", border: "1px solid var(--gray-200)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.14)", minWidth: 140, overflow: "hidden", fontSize: ".82rem" }}>
            {([
              ["关闭其他", () => closeOthers(ctx.idx), tabs.length <= 1],
              ["关闭左侧", () => closeLeft(ctx.idx), ctx.idx === 0],
              ["关闭右侧", () => closeRight(ctx.idx), ctx.idx === tabs.length - 1],
              ["关闭全部", () => closeAll(), false],
            ] as [string, () => void, boolean][]).map(([label, fn, disabled]) => (
              <div key={label} className={disabled ? "" : "menu-row"}
                onClick={() => { if (!disabled) fn() }}
                style={{ padding: "8px 14px", cursor: disabled ? "not-allowed" : "pointer", color: disabled ? "var(--gray-300)" : (label === "关闭全部" ? "var(--red)" : "var(--gray-700)") }}>
                {label}
              </div>
            ))}
          </div>
        </>
      )}

      <style jsx global>{`
        .menu-row:hover { background: var(--gray-50); }
        @media (max-width: 768px) {
          .md\\:hidden { display: block !important; }
          .sidebar { transform: translateX(-100%); transition: transform .2s; }
          .sidebar.open { transform: translateX(0); }
          .main-content { margin-left: 0 !important; }
        }
      `}</style>
    </div>
  )
}
