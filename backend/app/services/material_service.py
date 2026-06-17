"""素材描述生成（视觉）。

识图为每张素材图片生成简洁的商品描述。优先走 vision 类提供商，无则回退 text 类（仍传图片）。
模型用各 provider 自己配置的 default_model（不写死，避免模型下线/改名后全部 400）。
"""
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.llm.provider_router import ProviderRouter


async def generate_material_description(
    db: AsyncSession,
    image_url: str,
    *,
    spu: str | None = None,
    sku: str | None = None,
    title: str | None = None,
) -> str:
    if not image_url:
        raise ValueError("素材链接为空")

    ctx = []
    if title:
        ctx.append(f"商品标题：{title}")
    if spu:
        ctx.append(f"SPU：{spu}")
    if sku:
        ctx.append(f"SKU：{sku}")

    prompt = (
        "你是跨境电商素材标注助手。请观察这张商品图片，用简洁中文描述图中商品的关键视觉信息"
        "（品类、颜色、款式、材质质感、适用场景等），30-60 字，不要寒暄或前缀，直接输出描述。"
    )
    if ctx:
        prompt += "\n参考信息：" + "；".join(ctx)

    last_err: Exception | None = None
    for category in ("vision", "text"):
        try:
            router = ProviderRouter(category=category)
            text = await router.call(db, prompt, images=[image_url])  # 用 provider 默认模型
            return (text or "").strip()
        except Exception as e:  # noqa: BLE001
            last_err = e
            continue
    raise last_err or RuntimeError("无可用 AI 提供商")
