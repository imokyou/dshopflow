"""通用 Shopify Admin GraphQL SDK。

只负责「传输层」：执行 query/mutation、处理 HTTP 与 GraphQL 错误、按成本限流自动重试、游标分页。
业务（商品发布等）在此之上组装具体的 query/variables，与传输解耦。

参考：Shopify Admin GraphQL（cost-based rate limit，THROTTLED 需退避重试；
HTTP 200 也可能带 errors；mutation 的业务错误在各 payload 的 userErrors 里）。
"""
import asyncio
import logging

import httpx

logger = logging.getLogger("dropshipflow.shopify.graphql")

DEFAULT_API_VERSION = "2024-10"  # productSet 等新商品模型需 2024-04+


class ShopifyGraphQLError(Exception):
    """GraphQL 顶层 errors 或 mutation userErrors。"""
    def __init__(self, message: str, errors: list | None = None):
        super().__init__(message)
        self.errors = errors or []


class ShopifyGraphQL:
    def __init__(self, shop_domain: str, access_token: str, api_version: str = DEFAULT_API_VERSION):
        self.shop_domain = shop_domain
        self.url = f"https://{shop_domain}/admin/api/{api_version}/graphql.json"
        self.headers = {"X-Shopify-Access-Token": access_token or "", "Content-Type": "application/json"}

    async def execute(self, query: str, variables: dict | None = None, *,
                      retries: int = 4, timeout: float = 30.0) -> dict:
        """执行 query/mutation，返回 data（dict）。
        - HTTP 4xx/5xx → 抛 ShopifyGraphQLError；
        - 顶层 errors 含 THROTTLED → 按成本退避重试；其它 errors → 抛错；
        - 返回 data 部分（mutation 的 userErrors 由 execute_mutation 统一校验）。
        """
        payload = {"query": query, "variables": variables or {}}
        attempt = 0
        while True:
            attempt += 1
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    resp = await client.post(self.url, json=payload, headers=self.headers)
            except httpx.HTTPError as e:
                if attempt <= retries:
                    await asyncio.sleep(min(2 ** attempt, 8))
                    continue
                raise ShopifyGraphQLError(f"网络错误: {e}")

            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt <= retries:
                    await asyncio.sleep(min(2 ** attempt, 8))
                    continue
                raise ShopifyGraphQLError(f"HTTP {resp.status_code}: {resp.text[:300]}")
            if resp.status_code != 200:
                # 401/403/404 等：鉴权/地址问题，直接报清楚
                raise ShopifyGraphQLError(f"HTTP {resp.status_code}: {resp.text[:300]}")

            data = resp.json()
            errors = data.get("errors")
            if errors:
                throttled = any(
                    (e.get("extensions", {}) or {}).get("code") == "THROTTLED"
                    or "throttl" in (e.get("message", "").lower())
                    for e in errors
                )
                if throttled and attempt <= retries:
                    # 成本限流：按返回的 throttleStatus 估算等待，兜底退避
                    wait = self._throttle_wait(data) or min(2 ** attempt, 8)
                    logger.warning("GraphQL THROTTLED, wait %.1fs (attempt %d)", wait, attempt)
                    await asyncio.sleep(wait)
                    continue
                msg = "; ".join(e.get("message", "") for e in errors) or "GraphQL error"
                raise ShopifyGraphQLError(msg, errors)

            return data.get("data") or {}

    async def execute_mutation(self, query: str, variables: dict, top_field: str) -> dict:
        """执行 mutation 并自动校验该 payload 的 userErrors（非空即抛错）。返回 data[top_field]。"""
        data = await self.execute(query, variables)
        payload = data.get(top_field) or {}
        ue = payload.get("userErrors") or []
        if ue:
            msg = "; ".join(f"{'.'.join(map(str, e.get('field') or []))}: {e.get('message')}".strip(": ") for e in ue)
            raise ShopifyGraphQLError(msg or "userErrors", ue)
        return payload

    async def paginate(self, query: str, variables: dict, connection_path: list[str], *,
                       page_size: int = 100, max_pages: int = 50) -> list[dict]:
        """游标分页：query 需接受 $cursor，connection 需选 pageInfo{hasNextPage endCursor} 与 nodes。
        connection_path 是从 data 到该 connection 的键路径，如 ["products"]。返回所有 nodes。"""
        out: list[dict] = []
        cursor = None
        for _ in range(max_pages):
            data = await self.execute(query, {**variables, "cursor": cursor, "first": page_size})
            conn = data
            for k in connection_path:
                conn = (conn or {}).get(k) or {}
            out.extend(conn.get("nodes") or [])
            pi = conn.get("pageInfo") or {}
            if not pi.get("hasNextPage"):
                break
            cursor = pi.get("endCursor")
        return out

    @staticmethod
    def _throttle_wait(data: dict) -> float | None:
        """根据 extensions.cost.throttleStatus 估算需等待的秒数（恢复到够下次用）。"""
        try:
            ts = data["extensions"]["cost"]["throttleStatus"]
            requested = data["extensions"]["cost"]["requestedQueryCost"]
            available = ts["currentlyAvailable"]
            restore = ts["restoreRate"]
            if available < requested and restore > 0:
                return (requested - available) / restore + 0.2
        except Exception:
            return None
        return None
