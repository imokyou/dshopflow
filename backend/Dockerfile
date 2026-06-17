# DropShipFlow 后端（FastAPI）
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# 先装依赖（利用层缓存）；bcrypt/cryptography 有 manylinux 预编译 wheel，slim 镜像即可
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# 数据库与本地图片存储建议挂卷到 /data（见 docs/DEPLOY.md）
# DATABASE_URL=sqlite+aiosqlite:////data/dropshipflow.db
# LOCAL_STORAGE_DIR=/data/storage

EXPOSE 8000

# 启动即跑幂等迁移（main.py 的 startup 钩子）+ 进程内后台 worker
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
