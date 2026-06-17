"use client"
export const dynamic = "force-dynamic"

import { useEffect, useState, useCallback, useRef } from "react"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"
import { sanitizeHtml } from "@/lib/sanitize"
import { toast, toastError } from "@/lib/toast"

type PoolItem = any
type Team = { id: string; name: string }

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  captured: { label: "🟡 已抓取", color: "#b45309", bg: "#fffbeb" },
  translating: { label: "🔵 翻译中", color: "#1d4ed8", bg: "#eff6ff" },
  translated: { label: "🟢 已翻译", color: "#15803d", bg: "#f0fdf4" },
  pricing: { label: "🟣 定价中", color: "#7e22ce", bg: "#faf5ff" },
  priced: { label: "✅ 已定价", color: "#15803d", bg: "#f0fdf4" },
  imported: { label: "🚀 已上架", color: "#0e7490", bg: "#ecfeff" },
}

const BADGE = (s: string) => {
  const m = STATUS_MAP[s] || { label: s, color: "#6b7280", bg: "#f9fafb" }
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 12, fontSize: "0.7rem", background: m.bg, color: m.color, border: `1px solid ${m.color}20` }}>{m.label}</span>
}

// ── Modal wrapper ──
function Modal({ title, children, onClose, wide }: { title: string; children: any; onClose: () => void; wide?: boolean }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99, padding: 24 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 8, width: wide ? "min(1040px, 94vw)" : 500, maxWidth: "94vw", height: wide ? "90vh" : "auto", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
        {/* 固定标题栏 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid var(--gray-200)", flex: "0 0 auto" }}>
          <strong>{title}</strong>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
        {/* 可滚动内容区 */}
        <div style={{ flex: "1 1 auto", overflow: "auto", padding: 20 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

export default function ProductPoolPage() {
  const [data, setData] = useState<PoolItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [transferFilter, setTransferFilter] = useState("")
  const [loading, setLoading] = useState(false)

  // Detail modal
  const [detail, setDetail] = useState<PoolItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Capture modal
  const [showCapture, setShowCapture] = useState(false)
  const [captureTeamId, setCaptureTeamId] = useState("")
  const [cf, setCf] = useState({ offer_id: "", source_url: "", title_cn: "", cost_price: "0", desc_cn: "", image_url: "", sku_spec: "", sku_price: "0", sku_stock: "100" })
  const [captureError, setCaptureError] = useState("")

  // Edit modals for translation & pricing
  const [editTrans, setEditTrans] = useState<any>(null)
  const [editPrice, setEditPrice] = useState<any>(null)

  // Me
  const [me, setMe] = useState<any>(null)

  useEffect(() => {
    api.getMe().then(setMe).catch(() => { })
  }, [])

  // 请求序号：丢弃过期（后发先至）响应
  const reqIdRef = useRef(0)
  const load = useCallback(async (p?: number) => {
    const seq = ++reqIdRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("page", String(p || page))
      params.set("page_size", "50")
      if (search) params.set("search", search)
      if (statusFilter) params.set("status", statusFilter)
      if (transferFilter) params.set("transferred", transferFilter)
      const d = await api.getProductPool(params.toString()) as any
      if (seq === reqIdRef.current) { setData(d.items || []); setTotal(d.total || 0) }
    } catch (e) { if (seq === reqIdRef.current) toastError(e, "加载选品池失败") }
    finally { if (seq === reqIdRef.current) setLoading(false) }
  }, [page, search, statusFilter, transferFilter])

  // 搜索防抖 300ms；页码/筛选变化经 load 依赖触发
  useEffect(() => {
    const t = setTimeout(() => { load() }, 300)
    return () => clearTimeout(t)
  }, [load])

  const openDetail = async (id: string) => {
    setDetailLoading(true); setDetail(null)
    try {
      const d = await api.getProductPoolItem(id) as any
      setDetail(d)
    } catch (e) { toastError(e, "加载详情失败") }
    setDetailLoading(false)
  }

  // Capture
  const doCapture = async (e: React.FormEvent) => {
    e.preventDefault(); setCaptureError("")
    const tid = captureTeamId || (me?.user?.team_id || me?.team?.id || "")
    if (!tid) { setCaptureError("请输入团队ID"); return }
    try {
      const skus = cf.sku_spec ? [{ spec: cf.sku_spec, price: +cf.sku_price || 0, stock: +cf.sku_stock || 100 }] : []
      const images = cf.image_url ? [{ url: cf.image_url, status: "url_only" }] : []
      await api.captureProduct({
        team_id: tid, offer_id: cf.offer_id, source_url: cf.source_url || `https://detail.1688.com/offer/${cf.offer_id}.html`,
        title_cn: cf.title_cn, cost_price: +cf.cost_price || 0, sku_count: skus.length, image_count: images.length,
        desc_cn: cf.desc_cn, images, skus,
      })
      setShowCapture(false); load()
    } catch (e: any) { setCaptureError(e.message) }
  }

  // Actions —— busy 集合用于按钮防重复点击（S2-11）
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const setBusy = (id: string, on: boolean) =>
    setBusyIds(s => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n })

  const doTranslate = async (id: string) => {
    if (busyIds.has(id)) return
    setBusy(id, true)
    try {
      await api.triggerTranslate(id, "en")
      toast("已触发翻译", "success")
      setTimeout(() => load(), 2000)
      setTimeout(() => { if (detail?.id === id) openDetail(id) }, 3000)
    } catch (e) { toastError(e, "翻译触发失败") }
    finally { setBusy(id, false) }
  }
  const doPricing = async (id: string) => {
    if (busyIds.has(id)) return
    setBusy(id, true)
    try {
      await api.triggerPricing(id)
      toast("已触发定价", "success")
      setTimeout(() => load(), 2000)
      setTimeout(() => { if (detail?.id === id) openDetail(id) }, 3000)
    } catch (e) { toastError(e, "定价触发失败") }
    finally { setBusy(id, false) }
  }
  const doDelete = async (id: string) => {
    if (!confirm("确定删除？")) return
    if (busyIds.has(id)) return
    setBusy(id, true)
    try {
      await api.deleteProductPoolItem(id)
      toast("已删除", "success")
      load()
    } catch (e) { toastError(e, "删除失败") }
    finally { setBusy(id, false) }
  }
  // 转入商品管理：选择 + 二次确认 + 结果弹框
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null)
  const [transferring, setTransferring] = useState(false)
  const [transferResult, setTransferResult] = useState<{ ok: number; fail: number; errors: string[]; queued?: number } | null>(null)
  const [pricingRules, setPricingRules] = useState<any[]>([])
  const [spuRules, setSpuRules] = useState<any[]>([])
  const [tOpts, setTOpts] = useState<{ spu_rule_id: string; pricing_rule_id: string; translate: boolean; language: string; generate_seo: boolean; background: boolean }>(
    { spu_rule_id: "", pricing_rule_id: "", translate: false, language: "en", generate_seo: true, background: false })
  const [showJobs, setShowJobs] = useState(false)
  const [jobs, setJobs] = useState<{ items: any[]; counts: any }>({ items: [], counts: {} })

  useEffect(() => { api.getPricingRules().then((r: any) => setPricingRules(Array.isArray(r) ? r : (r?.items || []))).catch(() => setPricingRules([])) }, [])
  useEffect(() => { api.getSpuRules().then((r: any) => setSpuRules(Array.isArray(r) ? r : [])).catch(() => setSpuRules([])) }, [])

  const loadJobs = useCallback(async () => { try { setJobs((await api.getTransferJobs() as any) || { items: [], counts: {} }) } catch {} }, [])
  useEffect(() => { loadJobs() }, [loadJobs])  // 首次加载队列计数（用于头部徽标）
  useEffect(() => {
    if (!showJobs) return
    loadJobs()
    const t = setInterval(loadJobs, 2500)
    return () => clearInterval(t)
  }, [showJobs, loadJobs])

  const toggleSel = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const pageIds = data.map(r => r.id)
  const allSelected = data.length > 0 && pageIds.every(id => selected.has(id))
  const toggleAll = () => setSelected(s => { const n = new Set(s); if (allSelected) pageIds.forEach(id => n.delete(id)); else pageIds.forEach(id => n.add(id)); return n })

  const performTransfer = async () => {
    if (!confirmIds) return
    if (!tOpts.spu_rule_id) { return }  // 未选 SPU 规则，按钮已禁用，双保险
    setTransferring(true)
    const opts: any = { spu_rule_id: tOpts.spu_rule_id, pricing_rule_id: tOpts.pricing_rule_id || null, translate: tOpts.translate, language: tOpts.language, generate_seo: tOpts.generate_seo }

    if (tOpts.background) {
      // 后台队列：一次入队，慢慢处理
      try {
        const r: any = await api.queueFromPool(confirmIds, opts)
        setTransferring(false); setConfirmIds(null); setSelected(new Set())
        setTransferResult({ ok: 0, fail: 0, errors: [], queued: r?.queued ?? confirmIds.length })
      } catch (e: any) {
        setTransferring(false)
        setTransferResult({ ok: 0, fail: confirmIds.length, errors: [e?.message || "入队失败"] })
        setConfirmIds(null)
      }
      return
    }

    let ok = 0; const errors: string[] = []
    for (const id of confirmIds) {
      try { await api.createProductFromPool(id, opts); ok++ }
      catch (e: any) { errors.push(e?.message || "失败") }
    }
    setTransferring(false)
    setConfirmIds(null)
    setSelected(new Set())
    setTransferResult({ ok, fail: errors.length, errors })
  }

  // Refresh detail
  const refreshDetail = () => { if (detail) openDetail(detail.id) }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">🏊 选品池 <span className="page-subtitle">V2 分段管道</span></h1>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn btn-secondary" href="/transfer-jobs">🕒 转入队列{(jobs.counts?.pending || jobs.counts?.running) ? ` (${(jobs.counts.pending || 0) + (jobs.counts.running || 0)})` : ""}</a>
          <button className="btn btn-primary" onClick={() => { setCf({ offer_id: "", source_url: "", title_cn: "", cost_price: "0", desc_cn: "", image_url: "", sku_spec: "", sku_price: "0", sku_stock: "100" }); setCaptureError(""); setShowCapture(true) }}>+ 手动抓取</button>
        </div>
      </div>

      {/* Search / Filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input className="input" placeholder="搜索标题或 offerId..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          style={{ width: 240 }} onKeyDown={e => e.key === "Enter" && load()} />
        <select className="input" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }} style={{ width: 140 }}>
          <option value="">全部状态</option>
          {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input" value={transferFilter} onChange={e => { setTransferFilter(e.target.value); setPage(1) }} style={{ width: 130 }}>
          <option value="">全部转入状态</option>
          <option value="true">已转入</option>
          <option value="false">未转入</option>
        </select>
        <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(""); setStatusFilter(""); setTransferFilter(""); setPage(1) }}>清除筛选</button>
        <button className="btn btn-ghost btn-sm" onClick={() => load()} disabled={loading} title="刷新列表">{loading ? "⏳ 刷新中…" : "🔄 刷新"}</button>
      </div>

      {/* 批量操作条：固定浮动条，不挤压表格布局，选中时滑入 */}
      <div style={{
        position: "fixed", left: "50%", bottom: 24, zIndex: 50,
        transform: `translateX(-50%) translateY(${selected.size > 0 ? "0" : "160%"})`,
        opacity: selected.size > 0 ? 1 : 0,
        pointerEvents: selected.size > 0 ? "auto" : "none",
        transition: "transform .22s cubic-bezier(.4,0,.2,1), opacity .18s ease",
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
        background: "#fff", border: "1px solid #c7d2fe", borderRadius: 10,
        boxShadow: "0 10px 30px rgba(79,70,229,.22)",
      }}>
        <span style={{ fontSize: ".82rem", fontWeight: 600 }}>已选 {selected.size} 项</span>
        <button className="btn btn-primary btn-sm" onClick={() => setConfirmIds([...selected])}>📦 批量转入商品管理</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>清除选择</button>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 40, padding: 0 }}>
                  <label style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 38, cursor: "pointer" }} title="全选本页">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ width: 16, height: 16, cursor: "pointer" }} />
                  </label>
                </th>
                <th style={{ width: 50 }}>主图</th>
                <th>商品标题</th>
                <th style={{ width: 60 }}>SKU</th>
                <th style={{ width: 80 }}>成本价</th>
                <th style={{ width: 80 }}>售价</th>
                <th style={{ width: 90 }}>状态</th>
                <th style={{ width: 80 }}>转入</th>
                <th style={{ width: 100 }}>SPU</th>
                <th style={{ width: 130 }}>更新时间</th>
                <th style={{ width: 250 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={11} className="table-empty"><div className="empty-icon">🏊</div>暂无商品，点击「手动抓取」模拟 1688 抓取</td></tr>
              ) : data.map(r => (
                <tr key={r.id} style={{ cursor: "pointer", background: selected.has(r.id) ? "#f5f3ff" : undefined }} onClick={() => openDetail(r.id)}>
                  <td style={{ padding: 0 }} onClick={e => e.stopPropagation()}>
                    <label style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", minHeight: 44, cursor: "pointer" }}>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} style={{ width: 16, height: 16, cursor: "pointer" }} />
                    </label>
                  </td>
                  <td>
                    {r.main_image_url ? (
                      <img src={r.main_image_url} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4 }} onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
                    ) : <span style={{ fontSize: 20 }}>📷</span>}
                  </td>
                  <td>
                    <div style={{ fontWeight: 500, lineHeight: 1.4 }}>{r.title_cn || "无标题"}</div>
                    <div style={{ fontSize: ".7rem", color: "var(--gray-400)" }}>{r.offer_id}</div>
                  </td>
                  <td>{r.sku_count ?? 0}</td>
                  <td>¥{r.cost_price || "—"}</td>
                  <td style={{ fontWeight: 600, color: r.final_price ? "var(--green-700)" : "var(--gray-400)" }}>
                    {r.final_price ? `$${r.final_price}` : "—"}
                  </td>
                  <td>{BADGE(r.status)}</td>
                  <td>
                    {r.transferred
                      ? <span style={{ fontSize: ".72rem", color: "#15803d", background: "#dcfce7", padding: "2px 8px", borderRadius: 10, fontWeight: 600, whiteSpace: "nowrap" }}>✅ 已转入</span>
                      : <span style={{ fontSize: ".72rem", color: "var(--gray-400)", whiteSpace: "nowrap" }}>未转入</span>}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: ".75rem", fontWeight: 600, color: r.spu ? "var(--gray-700)" : "var(--gray-400)", whiteSpace: "nowrap" }}>
                    {r.spu || "—"}
                  </td>
                  <td style={{ fontSize: ".72rem", color: "var(--gray-500)", whiteSpace: "nowrap" }}>
                    {r.updated_at ? new Date(r.updated_at).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "nowrap", whiteSpace: "nowrap", fontSize: ".78rem" }}>
                      <a style={{ color: "var(--green-700, #15803d)", cursor: "pointer" }} title={r.transferred ? "已转入，再次转入将覆盖" : "复制到商品管理(草稿)"} onClick={() => setConfirmIds([r.id])}>{r.transferred ? "重新转入" : "转入商品"}</a>
                      {r.source_url && (
                        <a style={{ color: "var(--primary, #6366f1)" }} href={r.source_url} target="_blank" rel="noreferrer" title="访问 1688 原页面">原页面</a>
                      )}
                      <a style={{ color: "var(--red)", cursor: "pointer" }} onClick={() => doDelete(r.id)}>删除</a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > 50 && (
          <div style={{ display: "flex", justifyContent: "center", gap: 8, padding: 8 }}>
            <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
            <span style={{ fontSize: ".8rem", color: "var(--gray-500)", alignSelf: "center" }}>{page} / {Math.ceil(total / 50)}</span>
            <button className="btn btn-ghost btn-sm" disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}>下一页</button>
          </div>
        )}
      </div>

      {/* ══ Detail Modal ══ */}
      {detailLoading && <Modal title="加载中..." onClose={() => setDetail(null)}><p>加载中...</p></Modal>}
      {detail && !detailLoading && (
        <Modal title={`商品详情 - ${detail.title_cn?.slice(0, 30) || ""}`} onClose={() => setDetail(null)} wide>
          {/* Tabs（滚动时固定在内容区顶部）*/}
          <div style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: "1px solid var(--gray-200)", paddingBottom: 8, position: "sticky", top: -20, background: "#fff", paddingTop: 20, marginTop: -20, zIndex: 2 }}>
            {["原始数据", "翻译", "定价", "任务日志"].map(tab => (
              <button key={tab} className="btn btn-ghost btn-sm" style={{ fontWeight: 600, fontSize: ".78rem" }}
                onClick={() => document.getElementById(`tab-${tab}`)?.scrollIntoView({ behavior: "smooth" })}>{tab}</button>
            ))}
            <div style={{ flex: 1 }} />
            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmIds([detail.id])}>📦 转入商品管理</button>
            <button className="btn btn-ghost btn-sm" onClick={refreshDetail}>🔄 刷新</button>
          </div>

          {/* Status */}
          <div style={{ marginBottom: 12 }}>
            {BADGE(detail.status)}
            <span style={{ fontSize: ".75rem", color: "var(--gray-400)", marginLeft: 8 }}>offer_id: {detail.offer_id}</span>
            {detail.source_url && (
              <a href={detail.source_url} target="_blank" rel="noreferrer" style={{ fontSize: ".75rem", marginLeft: 12 }}>🔗 访问原页面</a>
            )}
          </div>

          {/* ── 原始数据 ── */}
          <div id="tab-原始数据" style={{ marginBottom: 16 }}>
            <strong style={{ fontSize: ".85rem" }}>📋 原始数据</strong>
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div className="form-group"><label>中文标题</label><div style={{ fontSize: ".82rem" }}>{detail.title_cn || "—"}</div></div>
              <div className="form-group"><label>成本价</label><div style={{ fontSize: ".82rem" }}>¥{detail.cost_price || "—"}</div></div>
              <div className="form-group" style={{ gridColumn: "1/-1" }}><label>描述</label>
                <div style={{ fontSize: ".78rem", background: "#f9fafb", padding: 8, borderRadius: 4, lineHeight: 1.5 }}
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(detail.detail?.desc_cn) || "—" }} />
              </div>
            </div>
            {detail.detail?.attrs?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: ".75rem", color: "var(--gray-500)" }}>商品属性 ({detail.detail.attrs.length})</label>
                <table style={{ fontSize: ".75rem", marginTop: 4, width: "100%" }}>
                  <tbody>
                    {detail.detail.attrs.map((a: any, i: number) => (
                      <tr key={i}>
                        <td style={{ color: "var(--gray-500)", width: 140, whiteSpace: "nowrap" }}>{a.name || a.key || "—"}</td>
                        <td>{a.value ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {detail.detail?.images?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: ".75rem", color: "var(--gray-500)" }}>商品图片 ({detail.detail.images.length})</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {detail.detail.images.map((im: any, i: number) => {
                    const url = typeof im === "string" ? im : (im?.processed_url || im?.s3_url || im?.url)
                    return url ? (
                      <a key={i} href={url} target="_blank" rel="noreferrer" title={url}>
                        <img src={url} alt="" loading="lazy"
                          style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 4, border: "1px solid var(--gray-200)" }}
                          onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
                      </a>
                    ) : null
                  })}
                </div>
              </div>
            )}
            {detail.detail?.skus?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <label style={{ fontSize: ".75rem", color: "var(--gray-500)" }}>SKU ({detail.detail.skus.length})</label>
                <table style={{ fontSize: ".75rem", marginTop: 4 }}>
                  <thead><tr><th>规格</th><th>价格</th><th>库存</th></tr></thead>
                  <tbody>
                    {detail.detail.skus.map((s: any, i: number) => (
                      <tr key={i}><td>{s.spec || s.name || "—"}</td><td>¥{s.price || "—"}</td><td>{s.stock || "—"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── 翻译 ── */}
          <div id="tab-翻译" style={{ marginBottom: 16, paddingTop: 12, borderTop: "1px solid var(--gray-100)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <strong style={{ fontSize: ".85rem" }}>🌐 翻译</strong>
              <button className="btn btn-ghost btn-sm" onClick={() => doTranslate(detail.id)}>🔄 重新翻译</button>
            </div>
            {!detail.translations?.length ? (
              <div style={{ fontSize: ".78rem", color: "var(--gray-400)" }}>尚未翻译</div>
            ) : detail.translations.map((t: any) => (
              <div key={t.language} style={{ background: "#f9fafb", padding: 12, borderRadius: 6, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <strong style={{ fontSize: ".8rem" }}>[{t.language.toUpperCase()}] {t.title}</strong>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditTrans({ ...t, pool_id: detail.id })}>✏️ 编辑</button>
                </div>
                <div style={{ fontSize: ".75rem", lineHeight: 1.5, maxHeight: 80, overflow: "auto" }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(t.description) }} />
                {t.bullet_points?.length > 0 && (
                  <ul style={{ fontSize: ".73rem", margin: "4px 0 0 16px", color: "var(--gray-600)" }}>
                    {t.bullet_points.map((bp: string, i: number) => <li key={i}>{bp}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {/* ── 定价 ── */}
          <div id="tab-定价" style={{ marginBottom: 16, paddingTop: 12, borderTop: "1px solid var(--gray-100)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <strong style={{ fontSize: ".85rem" }}>💲 定价</strong>
              <button className="btn btn-ghost btn-sm" onClick={() => doPricing(detail.id)}>🔄 重新定价</button>
            </div>
            {detail.final_price != null ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div style={{ background: "#f0fdf4", padding: 12, borderRadius: 6, textAlign: "center" }}>
                  <div style={{ fontSize: ".7rem", color: "var(--gray-500)" }}>成本价</div>
                  <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>¥{detail.cost_price}</div>
                </div>
                <div style={{ background: "#eff6ff", padding: 12, borderRadius: 6, textAlign: "center" }}>
                  <div style={{ fontSize: ".7rem", color: "var(--gray-500)" }}>售价 (×{detail.markup})</div>
                  <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--green-700)" }}>${detail.final_price}</div>
                </div>
                <div style={{ background: "#fef3c7", padding: 12, borderRadius: 6, textAlign: "center" }}>
                  <div style={{ fontSize: ".7rem", color: "var(--gray-500)" }}>划线价</div>
                  <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--red-600)", textDecoration: "line-through" }}>
                    ${detail.compare_at_price || "—"}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: ".78rem", color: "var(--gray-400)" }}>尚未定价</div>
            )}
            {detail.final_price != null && (
              <div style={{ fontSize: ".7rem", color: "var(--gray-400)", marginTop: 8 }}>
                规则: {detail.pricing_rule_name || "—"} | 汇率: {detail.exchange_rate || "—"} | 倍率: {detail.markup || "—"}x
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => setEditPrice({ pool_id: detail.id, final_price: detail.final_price, compare_at_price: detail.compare_at_price, pricing_rule_name: detail.pricing_rule_name, exchange_rate: detail.exchange_rate, markup: detail.markup })}>✏️ 手动调价</button>
              </div>
            )}
          </div>

          {/* ── 任务日志 ── */}
          <div id="tab-任务日志" style={{ paddingTop: 12, borderTop: "1px solid var(--gray-100)" }}>
            <strong style={{ fontSize: ".85rem" }}>📋 任务日志</strong>
            {!detail.task_logs?.length ? (
              <div style={{ fontSize: ".78rem", color: "var(--gray-400)", marginTop: 4 }}>暂无日志</div>
            ) : (
              <div style={{ marginTop: 8, maxHeight: 200, overflow: "auto" }}>
                {detail.task_logs.map((l: any) => (
                  <div key={l.id} style={{ padding: "6px 8px", marginBottom: 4, borderRadius: 4, background: l.status === "failed" ? "#fef2f2" : l.status === "completed" ? "#f0fdf4" : "#f9fafb", fontSize: ".73rem", border: "1px solid var(--gray-100)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>
                        <strong>{l.task_type === "translate" ? "🌐 翻译" : l.task_type === "pricing" ? "💲 定价" : l.task_type}</strong>
                        {" "}{l.language ? `(${l.language})` : ""}
                        {" "}
                        <span style={{ color: l.status === "completed" ? "var(--green-700)" : l.status === "failed" ? "var(--red-600)" : "var(--gray-500)" }}>
                          {l.status === "completed" ? "✅" : l.status === "failed" ? "❌" : l.status === "running" ? "🔄" : "⏳"} {l.status}
                        </span>
                      </span>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <span style={{ color: "var(--gray-400)" }}>
                          {l.created_at ? new Date(l.created_at).toLocaleString("zh-CN", { hour12: false }) : ""}
                        </span>
                        {l.status === "failed" && (
                          <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)", fontSize: ".68rem" }} onClick={async () => { await api.retryTask(detail.id, l.id); setTimeout(refreshDetail, 2000) }}>🔄 重试</button>
                        )}
                      </div>
                    </div>
                    {l.message && <div style={{ color: "var(--red-600)", fontSize: ".68rem", marginTop: 2 }}>{l.message}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ══ Capture Modal ══ */}
      {showCapture && (
        <Modal title="手动抓取 1688 商品" onClose={() => setShowCapture(false)}>
          <form onSubmit={doCapture}>
            <div className="form-group"><label>团队ID</label>
              <input className="input" value={captureTeamId} onChange={e => setCaptureTeamId(e.target.value)}
                placeholder={me?.user?.team_id || me?.team?.id || "请输入团队ID"} />
            </div>
            <div className="form-group"><label>1688 offerId *</label><input className="input" value={cf.offer_id} onChange={e => setCf({ ...cf, offer_id: e.target.value })} required /></div>
            <div className="form-group"><label>商品标题 *</label><input className="input" value={cf.title_cn} onChange={e => setCf({ ...cf, title_cn: e.target.value })} required /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div className="form-group"><label>成本价 (¥)</label><input className="input" type="number" step="0.01" value={cf.cost_price} onChange={e => setCf({ ...cf, cost_price: e.target.value })} /></div>
              <div className="form-group"><label>主图URL</label><input className="input" value={cf.image_url} onChange={e => setCf({ ...cf, image_url: e.target.value })} /></div>
            </div>
            <div className="form-group"><label>商品描述 (HTML)</label><textarea className="input" rows={3} value={cf.desc_cn} onChange={e => setCf({ ...cf, desc_cn: e.target.value })} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div className="form-group"><label>SKU 规格</label><input className="input" value={cf.sku_spec} onChange={e => setCf({ ...cf, sku_spec: e.target.value })} placeholder="如: 黑色/M" /></div>
              <div className="form-group"><label>SKU 价格</label><input className="input" type="number" step="0.01" value={cf.sku_price} onChange={e => setCf({ ...cf, sku_price: e.target.value })} /></div>
              <div className="form-group"><label>库存</label><input className="input" type="number" value={cf.sku_stock} onChange={e => setCf({ ...cf, sku_stock: e.target.value })} /></div>
            </div>
            {captureError && <div style={{ background: "var(--red-50)", color: "var(--red-700)", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{captureError}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowCapture(false)}>取消</button>
              <button type="submit" className="btn btn-primary">抓取入库</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ══ Edit Translation Modal ══ */}
      {editTrans && (
        <Modal title={`编辑翻译 [${editTrans.language}]`} onClose={() => setEditTrans(null)}>
          <form onSubmit={async e => {
            e.preventDefault()
            await api.updateTranslation(editTrans.pool_id, editTrans.language, { title: editTrans.title, description: editTrans.description, bullet_points: editTrans.bullet_points })
            setEditTrans(null); refreshDetail()
          }}>
            <div className="form-group"><label>标题</label><input className="input" value={editTrans.title || ""} onChange={e => setEditTrans({ ...editTrans, title: e.target.value })} /></div>
            <div className="form-group"><label>描述</label><textarea className="input" rows={4} value={editTrans.description || ""} onChange={e => setEditTrans({ ...editTrans, description: e.target.value })} /></div>
            <div className="form-group"><label>卖点 (每行一个)</label>
              <textarea className="input" rows={4} value={(editTrans.bullet_points || []).join("\n")} onChange={e => setEditTrans({ ...editTrans, bullet_points: e.target.value.split("\n").filter(Boolean) })} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setEditTrans(null)}>取消</button>
              <button type="submit" className="btn btn-primary">保存</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ══ Edit Price Modal ══ */}
      {editPrice && (
        <Modal title="手动调整售价" onClose={() => setEditPrice(null)}>
          <form onSubmit={async e => {
            e.preventDefault()
            await api.updatePrice(editPrice.pool_id, { final_price: editPrice.final_price, compare_at_price: editPrice.compare_at_price, pricing_rule_name: editPrice.pricing_rule_name, exchange_rate: editPrice.exchange_rate, markup: editPrice.markup })
            setEditPrice(null); refreshDetail()
          }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div className="form-group"><label>售价 ($)</label><input className="input" type="number" step="0.01" value={editPrice.final_price || ""} onChange={e => setEditPrice({ ...editPrice, final_price: +e.target.value })} /></div>
              <div className="form-group"><label>划线价 ($)</label><input className="input" type="number" step="0.01" value={editPrice.compare_at_price || ""} onChange={e => setEditPrice({ ...editPrice, compare_at_price: +e.target.value })} /></div>
              <div className="form-group"><label>汇率</label><input className="input" type="number" step="0.01" value={editPrice.exchange_rate || ""} onChange={e => setEditPrice({ ...editPrice, exchange_rate: +e.target.value })} /></div>
              <div className="form-group"><label>加价倍率</label><input className="input" type="number" step="0.1" value={editPrice.markup || ""} onChange={e => setEditPrice({ ...editPrice, markup: +e.target.value })} /></div>
            </div>
            <div className="form-group"><label>定价规则名</label><input className="input" value={editPrice.pricing_rule_name || ""} onChange={e => setEditPrice({ ...editPrice, pricing_rule_name: e.target.value })} /></div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setEditPrice(null)}>取消</button>
              <button type="submit" className="btn btn-primary">保存</button>
            </div>
          </form>
        </Modal>
      )}

      {/* 转入商品 — 二次确认 */}
      {confirmIds && (
        <Modal title="转入商品管理" onClose={() => !transferring && setConfirmIds(null)}>
          <p style={{ fontSize: ".88rem", lineHeight: 1.6 }}>
            将把选中的 <strong style={{ color: "var(--primary, #6366f1)" }}>{confirmIds.length}</strong> 个商品复制到「商品管理」，状态为<strong>草稿</strong>，<strong>不会</strong>发布到 Shopify。已转入过的会<strong>覆盖更新</strong>（保留已编辑的供应商/类型/标签/合集）。
          </p>

          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--gray-600)", display: "block", marginBottom: 4 }}>
                SPU 规则 <span style={{ color: "var(--red)" }}>*</span>（SKU = 编码 + 规格）
              </label>
              <select className="input" value={tOpts.spu_rule_id} onChange={e => setTOpts(o => ({ ...o, spu_rule_id: e.target.value }))} style={{ width: "100%", borderColor: tOpts.spu_rule_id ? undefined : "#fca5a5" }}>
                <option value="">请选择 SPU 规则（必填）</option>
                {spuRules.map(r => <option key={r.id} value={r.id}>{r.name}（{r.code}）</option>)}
              </select>
              {spuRules.length === 0 && <div style={{ fontSize: ".72rem", color: "var(--red)", marginTop: 3 }}>还没有 SPU 规则，请先到「SPU规则」页面创建。</div>}
            </div>

            <div>
              <label style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--gray-600)", display: "block", marginBottom: 4 }}>定价规则（自动算售价/划线价）</label>
              <select className="input" value={tOpts.pricing_rule_id} onChange={e => setTOpts(o => ({ ...o, pricing_rule_id: e.target.value }))} style={{ width: "100%" }}>
                <option value="">不计算（沿用选品池现有售价）</option>
                {pricingRules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>

            <div>
              <label style={{ fontSize: ".82rem", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={tOpts.translate} onChange={e => setTOpts(o => ({ ...o, translate: e.target.checked }))} />
                AI 翻译标题与描述
              </label>
              {tOpts.translate && (
                <select className="input" value={tOpts.language} onChange={e => setTOpts(o => ({ ...o, language: e.target.value }))} style={{ width: "100%", marginTop: 6 }}>
                  <option value="en">英文 (English)</option>
                  <option value="de">德文 (Deutsch)</option>
                  <option value="fr">法文 (Français)</option>
                </select>
              )}
            </div>

            <label style={{ fontSize: ".82rem", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={tOpts.generate_seo} onChange={e => setTOpts(o => ({ ...o, generate_seo: e.target.checked }))} />
              自动生成 SEO 标题与描述
            </label>

            <label style={{ fontSize: ".82rem", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", paddingTop: 6, borderTop: "1px dashed var(--gray-200)" }}>
              <input type="checkbox" checked={tOpts.background} onChange={e => setTOpts(o => ({ ...o, background: e.target.checked }))} />
              🕒 后台处理（加入队列慢慢处理，立即返回）
            </label>
          </div>

          <p style={{ fontSize: ".76rem", color: "var(--gray-400)", marginTop: 10 }}>选品池数据保持不变；翻译会调用 AI、批量时可能稍慢。后台处理可在「后台队列」查看进度。</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn btn-secondary" disabled={transferring} onClick={() => setConfirmIds(null)}>取消</button>
            <button className="btn btn-primary" disabled={transferring || !tOpts.spu_rule_id} onClick={performTransfer}>
              {transferring ? "处理中…" : (!tOpts.spu_rule_id ? "请先选 SPU 规则" : (tOpts.background ? "加入后台队列" : "确认转入"))}
            </button>
          </div>
        </Modal>
      )}

      {/* 转入结果 */}
      {transferResult && (
        <Modal title="转入结果" onClose={() => setTransferResult(null)}>
          {transferResult.queued != null ? (
            <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
              <div style={{ fontSize: 40 }}>🕒</div>
              <p style={{ fontSize: ".9rem", marginTop: 6 }}>已加入后台队列 <strong style={{ color: "var(--primary, #6366f1)" }}>{transferResult.queued}</strong> 个</p>
              <p style={{ fontSize: ".78rem", color: "var(--gray-500)" }}>正在后台逐个处理，可在「后台队列」查看进度。</p>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
              <div style={{ fontSize: 40 }}>{transferResult.fail === 0 ? "✅" : "⚠️"}</div>
              <p style={{ fontSize: ".9rem", marginTop: 6 }}>
                成功转入 <strong style={{ color: "var(--green-700, #15803d)" }}>{transferResult.ok}</strong> 个
                {transferResult.fail > 0 && <>，失败 <strong style={{ color: "var(--red)" }}>{transferResult.fail}</strong> 个</>}
              </p>
              <p style={{ fontSize: ".78rem", color: "var(--gray-500)" }}>已作为草稿存入「商品管理」</p>
              {transferResult.errors.length > 0 && (
                <div style={{ fontSize: ".72rem", color: "var(--red)", textAlign: "left", marginTop: 8, maxHeight: 100, overflow: "auto" }}>
                  {transferResult.errors.map((e, i) => <div key={i}>· {e}</div>)}
                </div>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            {transferResult.queued != null
              ? <button className="btn btn-secondary" onClick={() => { window.location.href = "/transfer-jobs" }}>查看队列</button>
              : <button className="btn btn-secondary" onClick={() => setTransferResult(null)}>留在选品池</button>}
            <button className="btn btn-primary" onClick={() => { window.location.href = "/products" }}>前往商品管理</button>
          </div>
        </Modal>
      )}

      {/* 后台队列 */}
      {showJobs && (
        <Modal title="后台转入队列" onClose={() => setShowJobs(false)}>
          <div style={{ display: "flex", gap: 10, fontSize: ".8rem", marginBottom: 10 }}>
            <span>⏳ 待处理 {jobs.counts?.pending || 0}</span>
            <span>🔄 处理中 {jobs.counts?.running || 0}</span>
            <span style={{ color: "var(--green-700,#15803d)" }}>✅ 完成 {jobs.counts?.completed || 0}</span>
            <span style={{ color: "var(--red)" }}>❌ 失败 {jobs.counts?.failed || 0}</span>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={async () => { await api.clearTransferJobs(); loadJobs() }}>清除已完成</button>
          </div>
          <div style={{ maxHeight: 320, overflow: "auto" }}>
            {(jobs.items || []).length === 0 ? (
              <div style={{ textAlign: "center", color: "var(--gray-400)", fontSize: ".82rem", padding: 20 }}>暂无任务</div>
            ) : jobs.items.map(j => (
              <div key={j.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--gray-100)", fontSize: ".8rem" }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.pool_title || "未命名"}</span>
                <span style={{ color: j.status === "completed" ? "var(--green-700,#15803d)" : j.status === "failed" ? "var(--red)" : "var(--gray-500)" }}>
                  {j.status === "pending" ? "⏳ 待处理" : j.status === "running" ? "🔄 处理中" : j.status === "completed" ? "✅ 完成" : "❌ 失败"}
                </span>
                {j.error && <span title={j.error} style={{ color: "var(--red)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.error}</span>}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button className="btn btn-primary" onClick={() => { window.location.href = "/products" }}>前往商品管理</button>
          </div>
        </Modal>
      )}
    </Layout>
  )
}
