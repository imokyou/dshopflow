"""无依赖的图片尺寸探测：从图片字节头解析宽高，用于按最小尺寸过滤素材/商品图。

支持 JPEG / PNG / GIF / WebP。仅抓取每张图前若干 KB（流式），解析出宽高即停止。
解析失败/网络异常时返回 None（调用方默认保留，避免误删真实图片）。
"""
import asyncio
import struct
from typing import Optional, Tuple

import httpx

HEADERS_1688 = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Referer": "https://detail.1688.com/",
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

_MAX_BYTES = 200_000  # 读取上限，足够覆盖各格式的尺寸信息


def parse_dimensions(data: bytes) -> Optional[Tuple[int, int]]:
    """从图片字节解析 (width, height)，无法判断返回 None。"""
    if len(data) < 24:
        return None
    # PNG
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        if data[12:16] == b"IHDR":
            w, h = struct.unpack(">II", data[16:24])
            return w, h
        return None
    # GIF
    if data[:6] in (b"GIF87a", b"GIF89a"):
        w, h = struct.unpack("<HH", data[6:10])
        return w, h
    # WebP (RIFF .... WEBP)
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        fmt = data[12:16]
        try:
            if fmt == b"VP8 ":
                # lossy: 0x9d 0x01 0x2a 后接 16-bit 宽高（含 scale 位，&0x3fff）
                w = struct.unpack("<H", data[26:28])[0] & 0x3FFF
                h = struct.unpack("<H", data[28:30])[0] & 0x3FFF
                return w, h
            if fmt == b"VP8L":
                b0, b1, b2, b3 = data[21], data[22], data[23], data[24]
                w = ((b1 & 0x3F) << 8 | b0) + 1
                h = ((b3 & 0x0F) << 10 | b2 << 2 | (b1 & 0xC0) >> 6) + 1
                return w, h
            if fmt == b"VP8X":
                w = (data[24] | data[25] << 8 | data[26] << 16) + 1
                h = (data[27] | data[28] << 8 | data[29] << 16) + 1
                return w, h
        except Exception:
            return None
        return None
    # JPEG：扫描 SOF 标记
    if data[:2] == b"\xff\xd8":
        i = 2
        n = len(data)
        while i + 9 < n:
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            # SOF0..SOF15（排除 DHT/DAC/RST 等非 SOF）
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                          0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return w, h
            if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            seg_len = struct.unpack(">H", data[i + 2:i + 4])[0]
            i += 2 + seg_len
        return None
    return None


async def _fetch_dims(client: httpx.AsyncClient, url: str) -> Optional[Tuple[int, int]]:
    try:
        async with client.stream("GET", url, headers=HEADERS_1688) as r:
            r.raise_for_status()
            buf = b""
            async for chunk in r.aiter_bytes(8192):
                buf += chunk
                dim = parse_dimensions(buf)
                if dim:
                    return dim
                if len(buf) >= _MAX_BYTES:
                    break
            return parse_dimensions(buf)
    except Exception:
        return None


async def select_small_images(
    urls: list[str], min_w: int = 400, min_h: int = 400,
    concurrency: int = 8, timeout: float = 8.0,
) -> set[str]:
    """返回需要过滤掉的「尺寸不足」图片 URL 集合（宽或高 < 阈值）。

    探测失败的图片不计入（保留），避免因网络问题误删真实素材。
    """
    targets = [u for u in dict.fromkeys(urls) if u and str(u).startswith("http")]
    if not targets:
        return set()
    drop: set[str] = set()
    sem = asyncio.Semaphore(concurrency)

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        async def check(u: str):
            async with sem:
                dim = await _fetch_dims(client, u)
            if dim is not None:
                w, h = dim
                if w < min_w or h < min_h:
                    drop.add(u)

        await asyncio.gather(*[check(u) for u in targets], return_exceptions=True)
    return drop
