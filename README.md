# DropShipFlow — 1688 → Shopify 跨境选品/上架系统

把 1688 商品一键抓取、AI 翻译/定价/识图、生成 SPU/SKU/素材，最终授权连接 Shopify 店铺并上下架的完整链路。

```
1688 商品页 → 插件抓取 → 选品池 → 转入商品(SPU/SKU/素材) → 授权店铺 → 上架/下架到 Shopify
```

## 目录结构

| 目录 | 技术 | 说明 |
|------|------|------|
| `backend/` | FastAPI + SQLAlchemy（SQLite 本地 / PostgreSQL 生产） | API + 进程内后台 worker |
| `admin/` | Next.js 14 | 管理后台 |
| `extension/` | Chrome MV3 插件 | 1688 页面抓取（含 Shadow DOM 详情图 + mtop API 拦截） |
| `docs/` | — | 设计/部署文档（详见 `docs/DEPLOY.md`、`docs/DEV_PROGRESS.md`） |

---

## 本地开发

```bash
./start.sh      # 一键起后端(:8000) + 管理后台(:3000)，Ctrl+C 一并关闭
./stop.sh       # 停止
./restart.sh    # 重启
./status.sh     # 查看运行状态
```

插件：Chrome 打开 `chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」选 `extension/` 目录。

---

## 线上部署（Docker Compose）

完整步骤（compose 片段、nginx、域名、初始化）见 **[`docs/DEPLOY.md`](docs/DEPLOY.md)**，nginx 配置见 [`docs/nginx-dshopflow.conf`](docs/nginx-dshopflow.conf)。

四个服务：`dsf-postgres`（库）、`dsf-backend`（API :8000）、`dsf-admin`（后台 :3000）、`dsf-redis`（可选）。

### 启动 services

在**放 `docker-compose.yml` 的目录**里执行（代码已放到服务器 `/opt/myapp/dshopflow`）：

```bash
# 1) 首次构建镜像（admin 会用 compose 里的 NEXT_PUBLIC_API_URL build-arg 内联后端地址）
docker compose build dsf-backend dsf-admin

# 2) 启动（postgres 先起，depends_on healthcheck 自动等它就绪）
docker compose up -d dsf-postgres dsf-redis dsf-backend dsf-admin
#   dsf-redis 仅给「在线监控/强制下线」，不需要可从命令里去掉

# 3) 看后端日志，出现 "Application startup complete" 即成功
#    （首次会自动在空库建全部数据表，无需手动迁移）
docker compose logs -f dsf-backend

# 4) 查看状态
docker compose ps
```

反向代理（证书签好、conf 放进 nginx 的 conf.d 后）：
```bash
nginx -t && nginx -s reload
```

### 首次初始化

1. 打开 `https://app.dshopflow.com` → **注册第一个账号**（系统首个用户自动成为超管）。
2. 超管登录 → **⚙️ 平台设置** 填 Shopify App（API key/secret + 后端地址 + 后台地址）→ 保存。
3. 把页面显示的**回调地址**填进 Shopify Partner app 的 Allowed redirection URL。
4. **店铺管理** → 🔗 连接 Shopify → 填 handle → 授权 → 回连。

### 常用运维

```bash
docker compose restart dsf-backend     # 重启某服务
docker compose logs -f dsf-admin       # 看前端日志
docker compose down                    # 停掉（数据在卷里，不丢）

# 更新代码后重新部署
cd /opt/myapp/dshopflow && git pull
docker compose build dsf-backend dsf-admin && docker compose up -d
```

### 备份

```bash
# 数据库
docker compose exec dsf-postgres pg_dump -U dsf dropshipflow | gzip > dsf-db-$(date +%F).sql.gz
# 图片卷
docker run --rm -v <卷前缀>_dsf-storage:/data -v "$PWD":/backup alpine tar czf /backup/dsf-storage-$(date +%F).tgz -C /data .
```

---

## 域名 / 关键约定

| 用途 | 值 |
|------|----|
| 管理后台 | `https://app.dshopflow.com` |
| 后端 API | `https://appapi.dshopflow.com` |
| admin 构建 `NEXT_PUBLIC_API_URL` | `https://appapi.dshopflow.com/api/v1` |
| OAuth 回调（填 Partner app） | `https://app.dshopflow.com/shops/oauth/callback` |

- 后端**保持单副本**（进程内串行 worker）；数据库用 Postgres 可独立扩展。
- `CREDENTIAL_ENCRYPTION_KEY` 一旦设定**不可更改**（否则历史加密的店铺 token 等无法解密）。
- `DATABASE_URL` 里的密码必须与 `POSTGRES_PASSWORD` 完全一致。
