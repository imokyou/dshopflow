"use client"
import { useEffect, useState } from "react"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"

export default function ShopsPage() {
  const [data, setData] = useState<any[]>([])
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ alias: "", shop_domain: "", shop_name: "", custom_domain: "", access_token: "", tags: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // OAuth 连接
  const [connectShow, setConnectShow] = useState(false)
  const [connectDomain, setConnectDomain] = useState("")
  const [connecting, setConnecting] = useState(false)
  const [connectErr, setConnectErr] = useState("")
  const [banner, setBanner] = useState<{ type: "ok" | "err"; text: string } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const reload = async () => setData(await api.getShops().then(d => (Array.isArray(d) ? d : [])))

  // 把 refresh-status 返回的状态合并进当前列表行
  const mergeStatus = (rows: any[]) =>
    setData(d => d.map(s => {
      const r = rows.find((x: any) => x.id === s.id)
      return r ? { ...s, ...r } : s
    }))

  const refreshStatus = async (manual = false) => {
    if (manual) setRefreshing(true)
    try { mergeStatus(await api.refreshShopStatus()) } catch { /* 忽略轮询错误 */ }
    finally { if (manual) setRefreshing(false) }
  }

  useEffect(() => {
    // 解析 OAuth 回调结果（后端跳回 /shops?connected=xxx 或 ?error=xxx）
    const q = new URLSearchParams(window.location.search)
    if (q.get("connected")) setBanner({ type: "ok", text: `已成功连接店铺：${q.get("connected")}` })
    else if (q.get("error")) setBanner({ type: "err", text: `连接失败：${q.get("error")}` })
    if (q.get("connected") || q.get("error")) window.history.replaceState({}, "", "/shops")

    reload().then(() => refreshStatus())  // 首屏加载后检测一次
    const timer = setInterval(() => refreshStatus(), 30000)  // 每 30s 定时刷新连接状态
    return () => clearInterval(timer)
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError("")
    try {
      await api.createShop({
        alias: form.alias || undefined,
        shop_domain: form.shop_domain,
        shop_name: form.shop_name || undefined,
        custom_domain: form.custom_domain || undefined,
        access_token: form.access_token,
        tags: form.tags || undefined,
      })
      setShow(false); setForm({ alias: "", shop_domain: "", shop_name: "", custom_domain: "", access_token: "", tags: "" })
      await reload()
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  // 新标签打开授权页：先在用户手势内同步开空白标签，拿到 url 再导航（避免弹窗拦截）
  const openAuth = async (domain: string, onErr: (m: string) => void): Promise<boolean> => {
    const w = window.open("", "_blank")
    try {
      const { url } = await api.shopifyInstallUrl(domain)
      if (w) w.location.href = url
      else window.location.href = url   // 弹窗被拦则退化为本页跳转
      return true
    } catch (e: any) { w?.close(); onErr(e.message); return false }
  }

  const startConnect = async () => {
    setConnecting(true); setConnectErr("")
    const ok = await openAuth(connectDomain.trim(), setConnectErr)
    setConnecting(false)
    if (ok) setConnectShow(false)
  }

  // 已建店铺重新授权（token 失效时刷新；callback 按 team+domain upsert 会更新原店铺 token）
  const reauth = (s: any) => openAuth(s.shop_domain, (m) => alert(m))

  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const testConn = async (id: string) => {
    setTesting(t => ({ ...t, [id]: true }))
    try { mergeStatus([await api.testShop(id)]) } catch { /* ignore */ }
    finally { setTesting(t => ({ ...t, [id]: false })) }
  }

  // 编辑 / 删除
  const [editShop, setEditShop] = useState<any | null>(null)
  const [editForm, setEditForm] = useState<any>({})
  const [editErr, setEditErr] = useState("")
  const [editSaving, setEditSaving] = useState(false)

  const openEdit = (s: any) => {
    setEditShop(s); setEditErr("")
    setEditForm({ alias: s.alias || "", shop_name: s.shop_name || "", shop_domain: s.shop_domain || "", custom_domain: s.custom_domain || "", tags: s.tags || "", access_token: "", is_active: s.is_active })
  }
  const saveEdit = async () => {
    setEditSaving(true); setEditErr("")
    try {
      const body: any = {
        alias: editForm.alias, shop_name: editForm.shop_name, shop_domain: editForm.shop_domain,
        custom_domain: editForm.custom_domain, tags: editForm.tags, is_active: editForm.is_active,
      }
      if (editForm.access_token) body.access_token = editForm.access_token  // 留空不改
      await api.updateShop(editShop.id, body)
      setEditShop(null); await reload(); refreshStatus()
    } catch (e: any) { setEditErr(e.message) }
    finally { setEditSaving(false) }
  }
  const removeShop = async (s: any) => {
    if (!confirm(`确认删除店铺「${s.alias || s.shop_domain}」？此操作不可撤销。`)) return
    try { await api.deleteShop(s.id); await reload() } catch (e: any) { alert(e.message) }
  }

  // 查看/复制 access_token（方便复制线上 token 到本地开发用）
  const [tokenInfo, setTokenInfo] = useState<{ domain: string; token: string } | null>(null)
  const [tokenLoadingId, setTokenLoadingId] = useState("")
  const showToken = async (s: any) => {
    setTokenLoadingId(s.id)
    try { const r = await api.getShopToken(s.id); setTokenInfo({ domain: r.shop_domain, token: r.access_token }) }
    catch (e: any) { alert(e.message) }
    finally { setTokenLoadingId("") }
  }
  const copyToken = () => {
    if (!tokenInfo?.token) return
    navigator.clipboard?.writeText(tokenInfo.token)
      .then(() => setBanner({ type: "ok", text: "已复制 access_token 到剪贴板" }))
      .catch(() => setBanner({ type: "err", text: "复制失败（需 https 或 localhost）" }))
  }

  // 连接状态徽标
  const connBadge = (s: any) => {
    if (!s.is_active) return <span className="badge badge-gray"><span className="badge-dot" />停用</span>
    const map: Record<string, [string, string]> = {
      ok: ["badge-green", "✅ 在线"], failed: ["badge-red", "❌ 失效"], unknown: ["badge-gray", "⏳ 待检测"],
    }
    const [cls, label] = map[s.conn_status] || map.unknown
    return <span className={`badge ${cls}`} title={s.conn_error || ""}><span className="badge-dot" />{label}</span>
  }
  const fmtDT = (iso?: string) => {
    if (!iso) return "—"
    const d = new Date(iso)
    if (isNaN(d.getTime())) return "—"
    const p = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">🏪 店铺管理</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => refreshStatus(true)} disabled={refreshing}>{refreshing ? "检测中…" : "🔄 刷新状态"}</button>
          <button className="btn btn-primary" onClick={() => { setConnectShow(true); setConnectErr(""); setConnectDomain("") }}>🔗 连接 Shopify（授权）</button>
          <button className="btn btn-secondary" onClick={() => setShow(true)}>+ 手动绑定（Token）</button>
        </div>
      </div>

      {banner && (
        <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 6, fontSize: 13,
          background: banner.type === "ok" ? "var(--green-50, #dcfce7)" : "var(--red-50, #fee2e2)",
          color: banner.type === "ok" ? "var(--green-700, #166534)" : "var(--red-700, #991b1b)" }}>
          {banner.text}
          <button onClick={() => setBanner(null)} style={{ float: "right", border: "none", background: "none", cursor: "pointer" }}>✕</button>
        </div>
      )}

      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>别名</th><th>二级域名</th><th>正式域名</th><th>标签</th><th>连接状态</th><th>最后检测</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>
          {data.map(s => (
            <tr key={s.id}>
              <td><strong>{s.alias || s.shop_name || "—"}</strong></td>
              <td style={{ fontSize: ".85rem" }}>{s.shop_domain}</td>
              <td style={{ fontSize: ".85rem", color: "var(--gray-500)" }}>{s.custom_domain || "—"}</td>
              <td style={{ fontSize: ".85rem" }}>
                {s.tags ? s.tags.split(",").map((t: string) => t.trim()).filter(Boolean).join("、") : "—"}
              </td>
              <td>{connBadge(s)}</td>
              <td style={{ fontSize: ".8rem", color: "var(--gray-500)", whiteSpace: "nowrap" }}>{fmtDT(s.conn_checked_at)}</td>
              <td style={{ fontSize: ".8rem", color: "var(--gray-500)", whiteSpace: "nowrap" }}>{fmtDT(s.created_at)}</td>
              <td style={{ whiteSpace: "nowrap", fontSize: ".8rem", display: "flex", gap: 10, alignItems: "center" }}>
                <a style={{ color: testing[s.id] ? "var(--gray-400)" : "var(--primary, #6366f1)", cursor: testing[s.id] ? "default" : "pointer" }} onClick={() => !testing[s.id] && testConn(s.id)}>{testing[s.id] ? "检测中…" : "检测"}</a>
                <a style={{ color: "var(--primary, #6366f1)", cursor: "pointer" }} onClick={() => reauth(s)} title="重新走 Shopify 授权，刷新 token">重新授权</a>
                <a style={{ color: "var(--primary, #6366f1)", cursor: tokenLoadingId === s.id ? "default" : "pointer" }} onClick={() => tokenLoadingId !== s.id && showToken(s)} title="查看/复制 access_token（用于本地开发）">{tokenLoadingId === s.id ? "…" : "Token"}</a>
                <a style={{ color: "var(--primary, #6366f1)", cursor: "pointer" }} onClick={() => openEdit(s)}>编辑</a>
                <a style={{ color: "var(--red, #ef4444)", cursor: "pointer" }} onClick={() => removeShop(s)}>删除</a>
              </td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr><td colSpan={8} className="table-empty"><div className="empty-icon">🏪</div>暂无店铺，点「连接 Shopify」授权接入</td></tr>
          )}
        </tbody>
      </table></div></div>

      {/* 编辑店铺弹框 */}
      {editShop && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99 }} onClick={() => setEditShop(null)}>
          <div style={{ background: "#fff", borderRadius: 8, width: 440, padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <strong>编辑店铺</strong>
              <button onClick={() => setEditShop(null)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <div className="form-group"><label>店铺别名</label><input className="input" value={editForm.alias} onChange={e => setEditForm({ ...editForm, alias: e.target.value })} /></div>
            <div className="form-group"><label>店铺名称</label><input className="input" value={editForm.shop_name} onChange={e => setEditForm({ ...editForm, shop_name: e.target.value })} /></div>
            <div className="form-group"><label>店铺 handle *</label><input className="input" value={editForm.shop_domain} onChange={e => setEditForm({ ...editForm, shop_domain: e.target.value })} placeholder="如 dshopflow（无需 .myshopify.com）" /></div>
            <div className="form-group"><label>正式域名</label><input className="input" value={editForm.custom_domain} onChange={e => setEditForm({ ...editForm, custom_domain: e.target.value })} placeholder="www.mystore.com" /></div>
            <div className="form-group"><label>Access Token</label><input className="input" type="password" value={editForm.access_token} onChange={e => setEditForm({ ...editForm, access_token: e.target.value })} placeholder="留空不修改；改域名/token 后会重新检测" /></div>
            <div className="form-group"><label>店铺标签</label><input className="input" value={editForm.tags} onChange={e => setEditForm({ ...editForm, tags: e.target.value })} placeholder="如：家居,户外" /></div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, margin: "0 0 12px", cursor: "pointer" }}>
              <input type="checkbox" checked={!!editForm.is_active} onChange={e => setEditForm({ ...editForm, is_active: e.target.checked })} /> 启用
            </label>
            {editErr && <div style={{ background: "var(--red-50)", color: "var(--red-700)", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{editErr}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setEditShop(null)}>取消</button>
              <button type="button" className="btn btn-primary" disabled={editSaving || !editForm.shop_domain?.trim()} onClick={saveEdit}>{editSaving ? "保存中…" : "保存"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 查看 token 弹框 */}
      {tokenInfo && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99 }} onClick={() => setTokenInfo(null)}>
          <div style={{ background: "#fff", borderRadius: 8, width: 520, maxWidth: "94vw", padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <strong>店铺 Access Token</strong>
              <button onClick={() => setTokenInfo(null)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: "var(--gray-500)", marginBottom: 8 }}>{tokenInfo.domain}</div>
            <textarea readOnly value={tokenInfo.token || "（无 token）"} onFocus={e => e.currentTarget.select()}
              style={{ width: "100%", minHeight: 70, padding: 10, fontSize: 12, fontFamily: "monospace", border: "1px solid #cbd5e1", borderRadius: 6, wordBreak: "break-all", resize: "vertical" }} />
            <p style={{ fontSize: 11, color: "var(--gray-400)", margin: "8px 0 12px", lineHeight: 1.5 }}>
              ⚠️ 这是店铺的敏感凭据，请勿外泄。可在本地开发时用「手动绑定（Token）」填入同一个店铺域名 + 此 token。
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={() => setTokenInfo(null)}>关闭</button>
              <button className="btn btn-primary" onClick={copyToken} disabled={!tokenInfo.token}>📋 复制 Token</button>
            </div>
          </div>
        </div>
      )}

      {/* OAuth 连接弹框 */}
      {connectShow && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99 }} onClick={() => setConnectShow(false)}>
          <div style={{ background: "#fff", borderRadius: 8, width: 440, padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <strong>连接 Shopify 店铺（OAuth 授权）</strong>
              <button onClick={() => setConnectShow(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <div className="form-group">
              <label>店铺 handle *</label>
              <input className="input" value={connectDomain} onChange={e => setConnectDomain(e.target.value)} placeholder="如 dshopflow（无需 .myshopify.com）" autoFocus />
            </div>
            <p style={{ fontSize: 11, color: "var(--gray-400)", margin: "0 0 8px" }}>
              即 Shopify 后台 <code>admin.shopify.com/store/<b>这一段</b></code>。点「前往授权」会跳转 Shopify 登录授权后自动返回。
            </p>
            {connectErr && <div style={{ background: "var(--red-50)", color: "var(--red-700)", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{connectErr}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setConnectShow(false)}>取消</button>
              <button type="button" className="btn btn-primary" disabled={connecting || !connectDomain.trim()} onClick={startConnect}>{connecting ? "跳转中…" : "前往授权"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 手动绑定弹框（Token） */}
      {show && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99 }} onClick={() => setShow(false)}>
          <div style={{ background: "#fff", borderRadius: 8, width: 440, padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <strong>手动绑定 Shopify 店铺（自定义应用 Token）</strong>
              <button onClick={() => setShow(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <form onSubmit={submit}>
              <div className="form-group"><label>店铺别名</label><input className="input" value={form.alias} onChange={e => setForm({ ...form, alias: e.target.value })} placeholder="如：主店铺-家居" /></div>
              <div className="form-group"><label>店铺名称</label><input className="input" value={form.shop_name} onChange={e => setForm({ ...form, shop_name: e.target.value })} placeholder="可选" /></div>
              <div className="form-group"><label>店铺 handle *</label><input className="input" value={form.shop_domain} onChange={e => setForm({ ...form, shop_domain: e.target.value })} placeholder="如 dshopflow（无需 .myshopify.com）" required /></div>
              <div className="form-group"><label>正式域名</label><input className="input" value={form.custom_domain} onChange={e => setForm({ ...form, custom_domain: e.target.value })} placeholder="www.mystore.com" /></div>
              <div className="form-group"><label>Access Token *</label><input className="input" value={form.access_token} onChange={e => setForm({ ...form, access_token: e.target.value })} required /></div>
              <div className="form-group"><label>店铺标签</label><input className="input" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="如：家居,户外,电子" /></div>
              <p style={{ fontSize: 11, color: "var(--gray-400)", margin: "0 0 8px" }}>多个标签用逗号分隔，用于标识主营品类</p>
              {error && <div style={{ background: "var(--red-50)", color: "var(--red-700)", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShow(false)}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "绑定中..." : "绑定"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  )
}
