"""初始化默认订阅套餐和配额规则"""
import asyncio
from app.database import async_session
from app.models import QuotaRule, SubscriptionPlan, AIProvider


async def seed():
    async with async_session() as db:
        # 检查是否已初始化
        from sqlalchemy import select, func
        count = await db.scalar(select(func.count(QuotaRule.id)))
        if count > 0:
            print("Already seeded, skipping.")
            return

        # ── 配额规则 ──
        free_quota = QuotaRule(
            name="入门版配额", max_team_members=1, max_shops=1,
            monthly_import_limit=10, max_images_per_product=8,
            watermark_removal=False, white_background=False,
            marketing_image=False, multi_language=False, custom_pricing=False,
        )
        pro_quota = QuotaRule(
            name="专业版配额", max_team_members=20, max_shops=10,
            monthly_import_limit=1000, max_images_per_product=20,
            watermark_removal=True, white_background=True,
            marketing_image=True, multi_language=True, custom_pricing=True,
            priority_queue=True, data_dashboard=True,
        )
        business_quota = QuotaRule(
            name="商业版配额", max_team_members=0, max_shops=0,
            monthly_import_limit=0, max_images_per_product=50,
            watermark_removal=True, white_background=True,
            marketing_image=True, scene_generation=True,
            multi_language=True, custom_pricing=True,
            priority_queue=True, api_access=True, data_dashboard=True,
        )
        db.add_all([free_quota, pro_quota, business_quota])
        await db.flush()

        # ── 订阅套餐 ──
        plans = [
            SubscriptionPlan(name="入门", slug="starter", monthly_price=0, yearly_price=0, quota_rule_id=free_quota.id, sort_order=1),
            SubscriptionPlan(name="专业", slug="pro", monthly_price=49, yearly_price=490, quota_rule_id=pro_quota.id, sort_order=2),
            SubscriptionPlan(name="商业", slug="business", monthly_price=149, yearly_price=1490, quota_rule_id=business_quota.id, sort_order=3),
        ]
        db.add_all(plans)
        await db.flush()

        # ── AI 提供商 ──
        ds = AIProvider(
            name="DeepSeek", slug="deepseek", provider_type="deepseek",
            category="text", api_base_url="https://api.deepseek.com/v1",
            api_key_encrypted="***", default_model="deepseek-chat",
            available_models=["deepseek-chat", "deepseek-reasoner"],
            priority=1, is_default=True,
        )
        db.add(ds)

        glm_text = AIProvider(
            name="GLM", slug="glm", provider_type="glm",
            category="text", api_base_url="https://open.bigmodel.cn/api/paas/v4",
            api_key_encrypted="***", default_model="glm-4.7",
            available_models=["glm-5.1", "glm-5", "glm-5-turbo", "glm-4.7", "glm-4.6", "glm-4.5",
                            "glm-4-plus", "glm-4-air", "glm-4-flash", "glm-4-long"],
            priority=2,
        )
        db.add(glm_text)

        glm_vision = AIProvider(
            name="GLM Vision", slug="glm-vision", provider_type="glm",
            category="vision", api_base_url="https://open.bigmodel.cn/api/paas/v4",
            api_key_encrypted="***", default_model="glm-4.6v",
            available_models=["glm-5v-turbo", "glm-4.6v", "glm-4v-plus", "glm-4v-flash"],
            priority=2,
        )
        db.add(glm_vision)

        await db.commit()
        print("Seed completed: 3 plans, 3 quotas, 1 AI provider")


if __name__ == "__main__":
    import sys
    sys.path.insert(0, ".")
    asyncio.run(seed())
