"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { api } from "@/lib/api"

// Shopify 授权完成后跳回此页（商户后台）。这里把回调 query 里的 code/hmac/state
// 转给后端 exchange 接口换 token，再带结果跳回店铺管理页。secret 只在后端用。
export default function ShopifyOAuthCallback() {
  const router = useRouter()
  const [msg, setMsg] = useState("正在完成 Shopify 授权…")

  useEffect(() => {
    const params: Record<string, string> = {}
    new URLSearchParams(window.location.search).forEach((v, k) => { params[k] = v })

    if (!params.code || !params.shop) {
      router.replace("/shops?error=" + encodeURIComponent("回调缺少 code/shop"))
      return
    }
    api.shopifyExchange(params)
      .then(r => {
        if (r.ok) router.replace("/shops?connected=" + encodeURIComponent(r.shop || params.shop))
        else { setMsg("授权失败：" + (r.error || "")); router.replace("/shops?error=" + encodeURIComponent(r.error || "授权失败")) }
      })
      .catch(e => { setMsg("授权失败：" + e.message); router.replace("/shops?error=" + encodeURIComponent(e.message)) })
  }, [router])

  return (
    <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 14 }}>
      {msg}
    </div>
  )
}
