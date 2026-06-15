const API_BASE = "http://localhost:8000/api/v1"

let token: string | null = null
let user: { id: string; email: string; name: string; role: string; team_id: string | null } | null = null

export function setAuth(t: string, u: any) {
  token = t
  user = u
  chrome.storage.local.set({ access_token: t, user: u })
}

export async function loadAuth(): Promise<boolean> {
  const data = await chrome.storage.local.get(["access_token", "user"])
  if (data.access_token && data.user) {
    token = data.access_token
    user = data.user
    return true
  }
  return false
}

export function clearAuth() {
  token = null
  user = null
  chrome.storage.local.remove(["access_token", "user"])
}

export function isLoggedIn() { return !!token }
export function getUser() { return user }

async function request<T = any>(method: string, path: string, body?: any): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`
  const resp = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || "Request failed")
  }
  return resp.json()
}

export const api = {
  getTeams: () => request("GET", "/teams"),
  getShops: (teamId?: string) => request("GET", `/shops${teamId ? `?team_id=${teamId}` : ""}`),
  createImport: (data: { team_id: string; shop_id: string; source_url: string; offer_id?: string; raw_data: any }) =>
    request("POST", "/imports", data),
  getPlans: () => request("GET", "/admin/plans"),
}
