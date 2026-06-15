"""图片下载、上传、存储管理服务。

1688 图片有 Referer 防盗链，需要伪装请求头。支持本地存储和 S3。
"""
import os
import uuid
import asyncio
import mimetypes
from pathlib import Path
from typing import Optional

import httpx
from app.config import settings


class ImageService:
    """图片服务：下载 1688 图片 → 本地/S3 存储 → 返回可访问 URL"""

    # 1688 防盗链破解：模拟浏览器请求
    HEADERS_1688 = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Referer": "https://detail.1688.com/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }

    def __init__(self):
        self._local_dir = Path(settings.LOCAL_STORAGE_DIR)
        self._local_dir.mkdir(parents=True, exist_ok=True)
        self._s3_client = None

    # ── Public API ──

    async def download_batch(
        self, urls: list[str], prefix: str = "product"
    ) -> list[dict]:
        """批量下载图片，返回 [{url, local_path, public_url, filename}]"""
        sem = asyncio.Semaphore(settings.PIPELINE_IMAGE_CONCURRENCY)

        async def _download_one(url: str, idx: int) -> Optional[dict]:
            async with sem:
                return await self._download_single(url, f"{prefix}_{idx}")

        tasks = [_download_one(url, i) for i, url in enumerate(urls)]
        results = await asyncio.gather(*tasks)
        return [r for r in results if r is not None]

    async def upload_processed(self, local_path: str, prefix: str = "processed") -> str:
        """上传处理后的图片，返回可访问 URL"""
        filename = f"{prefix}_{uuid.uuid4().hex[:8]}{Path(local_path).suffix}"
        if settings.STORAGE_BACKEND == "s3":
            return await self._upload_to_s3(local_path, filename)
        else:
            return await self._copy_to_local(local_path, filename)

    def get_public_url(self, filename: str) -> str:
        """获取图片的公开访问 URL"""
        if settings.STORAGE_BACKEND == "s3":
            return f"{settings.S3_PUBLIC_URL_PREFIX.rstrip('/')}/{filename}"
        return f"/api/v1/media/{filename}"

    # ── Private ──

    async def _download_single(self, url: str, name: str) -> Optional[dict]:
        """下载单张图片"""
        if not url or not url.startswith("http"):
            return None
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                resp = await client.get(url, headers=self.HEADERS_1688)
                resp.raise_for_status()
                content = resp.read()

            ext = self._guess_ext(url, resp.headers.get("content-type", ""))
            filename = f"{name}{ext}"
            local_path = self._local_dir / filename
            local_path.write_bytes(content)

            return {
                "url": url,
                "local_path": str(local_path),
                "public_url": self.get_public_url(filename),
                "filename": filename,
                "size": len(content),
            }
        except Exception as e:
            # 单张失败不中断整批
            return {"url": url, "error": str(e), "local_path": None, "public_url": url}

    async def _copy_to_local(self, src_path: str, filename: str) -> str:
        """复制到本地存储目录"""
        dst = self._local_dir / filename
        import shutil
        shutil.copy(src_path, dst)
        return self.get_public_url(filename)

    async def _upload_to_s3(self, local_path: str, filename: str) -> str:
        """上传到 S3"""
        client = self._get_s3_client()
        with open(local_path, "rb") as f:
            content_type = mimetypes.guess_type(filename)[0] or "image/jpeg"
            client.put_object(
                Bucket=settings.S3_BUCKET,
                Key=filename,
                Body=f,
                ContentType=content_type,
                ACL="public-read",
            )
        return self.get_public_url(filename)

    def _get_s3_client(self):
        if self._s3_client is None:
            import boto3
            self._s3_client = boto3.client(
                "s3",
                endpoint_url=settings.S3_ENDPOINT or None,
                aws_access_key_id=settings.S3_ACCESS_KEY,
                aws_secret_access_key=settings.S3_SECRET_KEY,
            )
        return self._s3_client

    @staticmethod
    def _guess_ext(url: str, content_type: str) -> str:
        """从 URL 或 Content-Type 猜测文件扩展名"""
        # 检查 URL 中的扩展名
        path = url.split("?")[0]
        _, ext = os.path.splitext(path)
        if ext and len(ext) <= 5:
            return ext

        # 从 Content-Type 映射
        type_map = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
            "image/gif": ".gif",
            "image/avif": ".avif",
        }
        return type_map.get(content_type, ".jpg")


# 单例
image_service = ImageService()
