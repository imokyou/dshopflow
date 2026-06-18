"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"
import { toast } from "@/lib/toast"

export const dynamic = "force-dynamic"

const STATUS: Record<string, { cls: string; label: string }> = {
  draft: { cls: "badge-amber", label: "草稿" },
  active: { cls: "badge-green", label: "已上架" },
  archived: { cls: "badge-red", label: "已归档" },
}
const BADGE = (s: string) => {
  const st = STATUS[s] || { cls: "badge-amber", label: s || "—" }
  return <span className={`badge ${st.cls}`}><span className="badge-dot" />{st.label}</span>
}

export default function ProductsPage() {
  const router = useRouter()
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [busy, setBusy] = useState<string>("")
  const [lightbox, setLightbox] = useState<string | null>(null)

  // 复制文本到剪贴板（带提示）
  const copy = (e: React.MouseEvent, text: string, label: string) => {
    e.stopPropagation()
    if (!text) return
    navigator.clipboard?.writeText(text)
      .then(() => toast(`已复制 ${label}：${text}`, "success"))
      .catch(() => toast("复制失败（需 https 或 localhost）", "error"))
  }

  // 批量补 SPU
  const [spuRules, setSpuRules] = useState<any[]>([])
  const [spuModal, setSpuModal] = useState(false)
  const [spuRuleId, setSpuRuleId] = useState("")
  const [genningSpu, setGenningSpu] = useState(false)
  useEffect(() => { api.getSpuRules().then((r: any) => setSpuRules(Array.isArray(r) ? r : (r?.items || []))).catch(() => setSpuRules([])) }, [])
  const doBatchSpu = async () => {
    if (!spuRuleId) return
    setGenningSpu(true)
    try {
      const r = await api.batchGenerateSpu({ spu_rule_id: spuRuleId, only_missing: true })
      toast(r.updated > 0 ? `已为 ${r.updated} 个商品补上 SPU` : "没有需要补 SPU 的商品", r.updated > 0 ? "success" : "info")
      setSpuModal(false); setSpuRuleId(""); load()  // 成功后清空已选 SPU 规则 + 刷新列表
    } catch (e: any) { toast(e?.message || "生成失败", "error") }
    finally { setGenningSpu(false) }
  }

  // 请求序号：丢弃过期（后发先至）响应，避免旧结果覆盖新筛选
  const reqIdRef = useRef(0)
  const load = useCallback(async () => {
    const seq = ++reqIdRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set("status", statusFilter)
      if (search) params.set("search", search)
      const d: any = await api.getProducts(params.toString())
      if (seq === reqIdRef.current) setData(d?.items || [])
    } catch { if (seq === reqIdRef.current) setData([]) }
    finally { if (seq === reqIdRef.current) setLoading(false) }
  }, [search, statusFilter])

  // 搜索防抖 300ms；筛选变化即时触发
  useEffect(() => {
    const t = setTimeout(() => { load() }, 300)
    return () => clearTimeout(t)
  }, [load])

  const act = async (id: string, fn: () => Promise<any>) => { setBusy(id); try { await fn() } catch (e: any) { alert(e?.message || "操作失败") } setBusy(""); load() }
  const publish = (p: any) => act(p.id, () => api.publishProduct(p.id))
  const unpublish = (p: any) => act(p.id, () => api.unpublishProduct(p.id))
  const edit = (id: string) => router.push(`/products/${id}`)

  // 批量删除：勾选 + 确认弹框
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [delConfirm, setDelConfirm] = useState<string[] | null>(null)
  const [deleting, setDeleting] = useState(false)
  const toggleSel = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const pageIds = data.map(p => p.id)
  const allSelected = data.length > 0 && pageIds.every(id => selected.has(id))
  const toggleAll = () => setSelected(s => { const n = new Set(s); if (allSelected) pageIds.forEach(id => n.delete(id)); else pageIds.forEach(id => n.add(id)); return n })
  const performDelete = async () => {
    if (!delConfirm) return
    setDeleting(true)
    for (const id of delConfirm) { try { await api.deleteProduct(id) } catch { /* skip */ } }
    setDeleting(false); setDelConfirm(null); setSelected(new Set()); load()
  }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">📦 商品管理 <span className="page-subtitle">在后台增删改查商品并发布到 Shopify</span></h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => { setSpuRuleId(""); setSpuModal(true) }}>🔖 批量补 SPU</button>
          <button className="btn btn-primary" onClick={() => router.push("/products/new")}>+ 添加商品</button>
        </div>
      </div>

      {spuModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99, padding: 24 }} onClick={() => !genningSpu && setSpuModal(false)}>
          <div style={{ background: "#fff", borderRadius: 8, width: 420, maxWidth: "94vw", padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <strong>批量补 SPU</strong>
              <button onClick={() => setSpuModal(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <p style={{ fontSize: ".86rem", lineHeight: 1.6, marginBottom: 12 }}>给所有<strong style={{ color: "var(--primary)" }}>未生成 SPU</strong>的商品按规则补上 SPU，并重算变体 SKU（已有 SPU 的不动）。</p>
            <div className="form-group">
              <label>SPU 规则 *</label>
              <select className="input" value={spuRuleId} onChange={e => setSpuRuleId(e.target.value)} style={{ borderColor: spuRuleId ? undefined : "#fca5a5" }}>
                <option value="">请选择 SPU 规则</option>
                {spuRules.map(r => <option key={r.id} value={r.id}>{r.name}（{r.code}）</option>)}
              </select>
              {spuRules.length === 0 && <div style={{ fontSize: ".72rem", color: "var(--red)", marginTop: 4 }}>还没有 SPU 规则，请先到「SPU规则」页创建。</div>}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn btn-secondary" disabled={genningSpu} onClick={() => setSpuModal(false)}>取消</button>
              <button className="btn btn-primary" disabled={genningSpu || !spuRuleId} onClick={doBatchSpu}>{genningSpu ? "生成中…" : "确认补 SPU"}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input className="input" placeholder="搜索商品标题…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} onKeyDown={e => e.key === "Enter" && load()} />
        <select className="input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 140 }}>
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="active">已上架</option>
          <option value="archived">已归档</option>
        </select>
        <button className="btn btn-ghost btn-sm" onClick={() => load()} disabled={loading}>{loading ? "⏳ 刷新中…" : "🔄 刷新"}</button>
      </div>

      {/* 批量操作条：固定浮动条，不挤压表格布局 */}
      <div style={{
        position: "fixed", left: "50%", bottom: 24, zIndex: 50,
        transform: `translateX(-50%) translateY(${selected.size > 0 ? "0" : "160%"})`,
        opacity: selected.size > 0 ? 1 : 0,
        pointerEvents: selected.size > 0 ? "auto" : "none",
        transition: "transform .22s cubic-bezier(.4,0,.2,1), opacity .18s ease",
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
        background: "#fff", border: "1px solid #fecaca", borderRadius: 10,
        boxShadow: "0 10px 30px rgba(220,38,38,.18)",
      }}>
        <span style={{ fontSize: ".82rem", fontWeight: 600 }}>已选 {selected.size} 项</span>
        <button className="btn btn-sm" style={{ background: "var(--red)", color: "#fff" }} onClick={() => setDelConfirm([...selected])}>🗑 批量删除</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>清除选择</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th style={{ width: 40, padding: 0 }}>
                <label style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 38, cursor: "pointer" }} title="全选本页">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ width: 16, height: 16, cursor: "pointer" }} />
                </label>
              </th>
              <th style={{ width: 50 }}>主图</th><th>商品</th><th style={{ width: 110 }}>SPU</th><th style={{ width: 70 }}>价格</th>
              <th style={{ width: 60 }}>库存</th><th style={{ width: 90 }}>状态</th><th style={{ width: 110 }}>Shopify</th>
              <th style={{ width: 130 }}>更新时间</th><th style={{ width: 180 }}>操作</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="table-empty"><div className="spinner" /></td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={10} className="table-empty"><div className="empty-icon">📦</div>暂无商品，点击「+ 添加商品」新建</td></tr>
              ) : data.map(p => (
                <tr key={p.id} style={{ cursor: "pointer", background: selected.has(p.id) ? "#f5f3ff" : undefined }} onClick={() => edit(p.id)}>
                  <td style={{ padding: 0 }} onClick={e => e.stopPropagation()}>
                    <label style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", minHeight: 44, cursor: "pointer" }}>
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSel(p.id)} style={{ width: 16, height: 16, cursor: "pointer" }} />
                    </label>
                  </td>
                  <td>{p.image ? <img src={p.image} alt="" title="点击看大图" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4, cursor: "zoom-in" }} onClick={e => { e.stopPropagation(); setLightbox(p.image) }} onError={e => { (e.target as HTMLImageElement).style.display = "none" }} /> : <span style={{ fontSize: 20 }}>📷</span>}</td>
                  <td><div style={{ fontWeight: 500 }} className="link-title">{p.title || "未命名"}</div><div style={{ fontSize: ".7rem", color: "var(--gray-400)" }}>{p.variant_count} 个变体 · {p.vendor || "无供应商"}</div></td>
                  <td style={{ fontFamily: "monospace", fontSize: ".78rem", fontWeight: 600, color: p.spu ? "var(--gray-700)" : "var(--gray-400)", cursor: p.spu ? "pointer" : "default" }} title={p.spu ? "点击复制 SPU" : ""} onClick={e => p.spu && copy(e, p.spu, "SPU")}>{p.spu || "—"}{p.spu && <span style={{ marginLeft: 4, opacity: .4, fontSize: ".7rem" }}>📋</span>}</td>
                  <td>{p.price != null ? `$${p.price}` : "—"}</td>
                  <td>{p.inventory ?? 0}</td>
                  <td>{BADGE(p.status)}</td>
                  <td style={{ fontSize: ".72rem", color: "var(--gray-400)", fontFamily: "monospace" }}>{p.shopify_product_id ? `#${String(p.shopify_product_id).slice(-8)}` : "未发布"}</td>
                  <td style={{ fontSize: ".72rem", color: "var(--gray-500)", whiteSpace: "nowrap" }}>{p.updated_at ? new Date(p.updated_at).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "nowrap", whiteSpace: "nowrap", fontSize: ".78rem" }}>
                      {p.status === "active"
                        ? <a style={{ color: "var(--gray-600)", cursor: "pointer" }} onClick={() => unpublish(p)}>{busy === p.id ? "…" : "下架"}</a>
                        : <a style={{ color: "var(--primary, #6366f1)", cursor: "pointer" }} onClick={() => publish(p)}>{busy === p.id ? "…" : "发布"}</a>}
                      <a style={{ color: "var(--primary, #6366f1)", cursor: "pointer" }} onClick={() => edit(p.id)}>编辑</a>
                      <a style={{ color: "var(--red)", cursor: "pointer" }} onClick={() => setDelConfirm([p.id])}>删除</a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {delConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99, padding: 24 }} onClick={() => !deleting && setDelConfirm(null)}>
          <div style={{ background: "#fff", borderRadius: 8, width: 380, maxWidth: "94vw", padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>确认删除</div>
            <p style={{ fontSize: ".88rem", lineHeight: 1.6 }}>确定删除选中的 <strong style={{ color: "var(--red)" }}>{delConfirm.length}</strong> 个商品？此操作不可撤销。</p>
            <p style={{ fontSize: ".78rem", color: "var(--gray-500)", marginTop: 6 }}>已发布到 Shopify 的商品也会尝试同步删除。</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
              <button className="btn btn-secondary" disabled={deleting} onClick={() => setDelConfirm(null)}>取消</button>
              <button className="btn" style={{ background: "var(--red)", color: "#fff" }} disabled={deleting} onClick={performDelete}>{deleting ? "删除中…" : "确认删除"}</button>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <img src={lightbox} alt="" style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 8 }} />
        </div>
      )}
    </Layout>
  )
}
