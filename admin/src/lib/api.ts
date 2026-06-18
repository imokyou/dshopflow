const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1"

let token: string | null = null
let refreshToken: string | null = null
let refreshPromise: Promise<string | null> | null = null

export function setTokens(access: string, refresh: string) {
  token = access
  refreshToken = refresh
  if (typeof window !== "undefined") {
    localStorage.setItem("token", access)
    localStorage.setItem("refresh_token", refresh)
  }
}

export function clearTokens() {
  token = null
  refreshToken = null
  if (typeof window !== "undefined") {
    localStorage.removeItem("token")
    localStorage.removeItem("refresh_token")
  }
}

export function getToken(): string | null {
  if (token) return token
  if (typeof window !== "undefined") {
    token = localStorage.getItem("token")
    refreshToken = localStorage.getItem("refresh_token")
  }
  return token
}

// 确保 refreshToken 已从 localStorage 加载（修复首个 401 时内存值仍为 null 的时序缺口）
function getRefreshToken(): string | null {
  if (refreshToken) return refreshToken
  if (typeof window !== "undefined") {
    refreshToken = localStorage.getItem("refresh_token")
  }
  return refreshToken
}

export function isLoggedIn() { return !!getToken() }

async function refreshAccessToken(): Promise<string | null> {
  if (!getRefreshToken()) return null
  // Prevent concurrent refresh calls
  if (refreshPromise) return refreshPromise
  
  refreshPromise = (async () => {
    try {
      const resp = await fetch(`${API}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!resp.ok) throw new Error("refresh failed")
      const data = await resp.json()
      setTokens(data.access_token, data.refresh_token)
      return data.access_token
    } catch {
      clearTokens()
      if (typeof window !== "undefined") window.location.href = "/login"
      return null
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

async function request<T = any>(method: string, path: string, body?: any): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const t = getToken()
  if (t) headers["Authorization"] = `Bearer ${t}`

  let resp = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })

  // Auto-refresh on 401（确保 refreshToken 已从 localStorage 加载）
  if (resp.status === 401 && getRefreshToken()) {
    const newToken = await refreshAccessToken()
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`
      resp = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
    }
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || "Request failed")
  }
  return resp.json()
}

export const api = {
  // Auth
  login: async (email: string, password: string) => {
    const data = await request("POST", "/auth/login", { email, password }) as any
    setTokens(data.access_token, data.refresh_token)
    return data
  },
  register: async (form: any) => {
    const data = await request("POST", "/auth/register", form) as any
    setTokens(data.access_token, data.refresh_token)
    return data
  },

  // Products（商品管理 — Shopify 式 CRUD + 发布）
  getProducts: (params?: string) => request("GET", `/products${params ? `?${params}` : ""}`),
  getProduct: (id: string) => request("GET", `/products/${id}`),
  createProduct: (data: any) => request("POST", "/products", data),
  createProductFromPool: (poolId: string, opts: any = {}) => request("POST", "/products/from-pool", { pool_id: poolId, ...opts }),
  queueFromPool: (poolIds: string[], opts: any = {}) => request("POST", "/products/from-pool/queue", { pool_ids: poolIds, ...opts }),
  getTransferJobs: (limit = 50) => request("GET", `/products/transfer-jobs?limit=${limit}`),
  clearTransferJobs: () => request("DELETE", "/products/transfer-jobs/cleared"),

  // SPU 规则（SKU 编码）
  getSpuRules: () => request("GET", "/spu-rules"),
  createSpuRule: (data: any) => request("POST", "/spu-rules", data),
  updateSpuRule: (id: string, data: any) => request("PUT", `/spu-rules/${id}`, data),
  deleteSpuRule: (id: string) => request("DELETE", `/spu-rules/${id}`),
  generateSpu: (spu_rule_id: string, product_id?: string) => request("POST", "/products/generate-spu", { spu_rule_id, product_id }),
  updateProduct: (id: string, data: any) => request("PUT", `/products/${id}`, data),
  deleteProduct: (id: string) => request("DELETE", `/products/${id}`),
  publishProduct: (id: string) => request("POST", `/products/${id}/publish`),
  unpublishProduct: (id: string) => request("POST", `/products/${id}/unpublish`),
  syncProduct: (id: string) => request("POST", `/products/${id}/sync`),

  // Collections（商品合集）
  getCollections: () => request("GET", "/collections"),
  createCollection: (data: any) => request("POST", "/collections", data),
  updateCollection: (id: string, data: any) => request("PUT", `/collections/${id}`, data),
  deleteCollection: (id: string) => request("DELETE", `/collections/${id}`),

  // Teams
  getTeams: () => request("GET", "/teams"),
  getTeam: (id: string) => request("GET", `/teams/${id}`),
  createTeam: (data: any) => request("POST", "/teams", data),
  updateTeam: (id: string, data: any) => request("PUT", `/teams/${id}`, data),

  // Shops
  getShops: (teamId?: string) => request("GET", `/shops${teamId ? `?team_id=${teamId}` : ""}`),
  createShop: (data: any) => request("POST", "/shops", data),
  shopifyInstallUrl: (shop: string) => request<{ url: string }>("GET", `/shops/oauth/install?shop=${encodeURIComponent(shop)}`),
  shopifyExchange: (params: Record<string, string>) => request<{ ok: boolean; shop?: string; error?: string }>("POST", "/shops/oauth/exchange", { params }),
  testShop: (id: string) => request("POST", `/shops/${id}/test`),
  refreshShopStatus: () => request<any[]>("POST", "/shops/refresh-status"),
  updateShop: (id: string, data: any) => request("PUT", `/shops/${id}`, data),
  deleteShop: (id: string) => request("DELETE", `/shops/${id}`),


  // Imports
  getImports: (params?: string) => request("GET", `/imports${params ? `?${params}` : ""}`),
  getImport: (id: string) => request("GET", `/imports/${id}`),
  createImport: (data: any) => request("POST", "/imports", data),

  // Pricing
  getPricingRules: (teamId?: string) => request("GET", `/pricing-rules${teamId ? `?team_id=${teamId}` : ""}`),
  createPricingRule: (data: any) => request("POST", "/pricing-rules", data),
  updatePricingRule: (id: string, data: any) => request("PUT", `/pricing-rules/${id}`, data),
  togglePricingRuleActive: (id: string) => request("PUT", `/pricing-rules/${id}/toggle-active`),

  // Admin
  getMe: () => request("GET", "/admin/me"),
  getPlans: () => request("GET", "/admin/plans"),
  createPlan: (data: any) => request("POST", "/admin/plans", data),
  updatePlan: (id: string, data: any) => request("PUT", `/admin/plans/${id}`, data),
  togglePlanActive: (id: string) => request("PUT", `/admin/plans/${id}/toggle-active`),
  getQuotaRules: () => request("GET", "/admin/quota-rules"),
  createQuotaRule: (data: any) => request("POST", "/admin/quota-rules", data),
  updateQuotaRule: (id: string, data: any) => request("PUT", `/admin/quota-rules/${id}`, data),
  toggleQuotaRuleActive: (id: string) => request("PUT", `/admin/quota-rules/${id}/toggle-active`),
  getAIProviders: () => request("GET", "/admin/ai-providers"),
  createAIProvider: (data: any) => request("POST", "/admin/ai-providers", data),
  getPlatformSettings: () => request("GET", "/admin/platform-settings"),
  updatePlatformSettings: (data: any) => request("PUT", "/admin/platform-settings", data),
  updateAIProvider: (id: string, data: any) => request("PUT", `/admin/ai-providers/${id}`, data),
  toggleAIProviderActive: (id: string) => request("PUT", `/admin/ai-providers/${id}/toggle-active`),
  fetchModels: (api_base_url: string, api_key: string, provider_id?: string) =>
    request("POST", "/admin/ai-providers/fetch-models", { api_base_url, api_key, provider_id }),
  getAuditLogs: (params?: string) => request("GET", `/admin/audit-logs${params ? `?${params}` : ""}`),
  getSessions: () => request("GET", "/admin/sessions"),
  kickUser: (userId: string) => request("DELETE", `/admin/sessions/${userId}`),
  getTeamMembers: (teamId: string) => request("GET", `/admin/teams/${teamId}/members`),
  addMember: (data: any) => request("POST", "/admin/members", data),
  updateMember: (teamId: string, userId: string, data: any) => request("PUT", `/admin/teams/${teamId}/members/${userId}`, data),
  toggleMemberActive: (teamId: string, userId: string) => request("PUT", `/admin/teams/${teamId}/members/${userId}/toggle-active`),

  // Product Pool (V2)
  getProductPool: (params?: string) => request("GET", `/product-pool${params ? `?${params}` : ""}`),
  getProductPoolItem: (id: string) => request("GET", `/product-pool/${id}`),
  captureProduct: (data: any) => request("POST", "/product-pool", data),
  deleteProductPoolItem: (id: string) => request("DELETE", `/product-pool/${id}`),
  triggerTranslate: (id: string, language: string = "en") => request("POST", `/product-pool/${id}/translate`, { language }),
  batchTranslate: (ids: string[], language: string = "en") => request("POST", "/product-pool/batch-translate", { ids, language }),
  updateTranslation: (id: string, lang: string, data: any) => request("PUT", `/product-pool/${id}/translate/${lang}`, data),
  triggerPricing: (id: string) => request("POST", `/product-pool/${id}/price`),
  batchPricing: (ids: string[]) => request("POST", "/product-pool/batch-price", { ids }),
  updatePrice: (id: string, data: any) => request("PUT", `/product-pool/${id}/price`, data),
  getTaskLogs: (id: string, taskType?: string) => request("GET", `/product-pool/${id}/tasks${taskType ? `?task_type=${taskType}` : ""}`),
  retryTask: (poolId: string, taskId: string) => request("POST", `/product-pool/${poolId}/tasks/${taskId}/retry`),

  // 素材库
  getMaterials: (params?: string) => request("GET", `/materials${params ? `?${params}` : ""}`),
  updateMaterial: (id: string, data: any) => request("PUT", `/materials/${id}`, data),
  regenerateMaterial: (id: string) => request("POST", `/materials/${id}/regenerate`),
}
