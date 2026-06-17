from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import AIProvider
from app.core.crypto import decrypt_secret


class ProviderRouter:
    """从数据库读取 AI 提供商配置，按 priority 降级"""

    def __init__(self, category: str = "text"):
        self.category = category  # "text" | "vision"

    async def get_active_providers(self, db: AsyncSession) -> list[AIProvider]:
        result = await db.scalars(
            select(AIProvider)
            .where(AIProvider.is_active == True, AIProvider.category == self.category)
            .order_by(AIProvider.priority.desc())
        )
        return list(result)

    async def call(self, db: AsyncSession, prompt: str, images: list[str] | None = None, **kwargs) -> str:
        providers = await self.get_active_providers(db)
        if not providers:
            raise Exception(f"No active AI providers for category '{self.category}'")

        last_error = None
        for p in providers:
            try:
                return await self._call_provider(p, prompt, images, **kwargs)
            except Exception as e:
                last_error = e
                continue

        raise Exception(f"All '{self.category}' providers failed. Last: {last_error}")

    async def _call_provider(self, p: AIProvider, prompt: str, images: list[str] | None, **kwargs) -> str:
        import httpx
        headers = {"Authorization": f"Bearer {decrypt_secret(p.api_key_encrypted)}", "Content-Type": "application/json"}
        payload = {"model": kwargs.get("model") or p.default_model, "messages": [{"role": "user", "content": prompt}]}
        if images:
            payload["messages"][0]["content"] = [{"type": "text", "text": prompt}] + [
                {"type": "image_url", "image_url": {"url": img}} for img in images
            ]
        async with httpx.AsyncClient(timeout=p.timeout_seconds) as client:
            resp = await client.post(f"{p.api_base_url}/chat/completions", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]

    async def test_connection(self, db: AsyncSession, provider_id: str) -> dict:
        p = await db.get(AIProvider, provider_id)
        if not p:
            return {"ok": False, "error": "Provider not found"}
        try:
            await self._call_provider(p, "ping", None)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}
