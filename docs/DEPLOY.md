# DropShipFlow 线上部署（Docker Compose）

把本项目（后端 + 管理后台）作为两个服务加入你服务器上**已有的 `docker-compose.yml`**。
目标：拿到真实 https 域名，供 Shopify OAuth 回调使用。

---

## 0. 架构与前置

服务（均不直接对公网开端口，统一走你现有的反向代理）：

| 服务 | 技术 | 容器端口 | 说明 |
|------|------|:--:|------|
| `dsf-backend` | FastAPI | 8000 | API + 进程内后台 worker；图片存 `/data/storage` 卷 |
| `dsf-postgres` | PostgreSQL 16 | 5432 | 业务数据库（数据存卷）。启动时按模型自动建表 |
| `dsf-admin` | Next.js 14（standalone） | 3000 | 管理后台；`NEXT_PUBLIC_API_URL` 构建时内联 |
| `dsf-redis`（可选） | Redis | 6379 | 仅「在线监控 / 强制下线」需要；不加则该功能降级，其余正常 |

**两个子域名**（推荐）：
- `https://appapi.dshopflow.com` → `dsf-backend:8000`
- `https://app.dshopflow.com` → `dsf-admin:3000`

> 单域名 + 路径路由也可，但 `NEXT_PUBLIC_API_URL`、CORS、OAuth 回调三者要保持一致，子域名最省心。

**重要约束**：后端是进程内串行 worker（`core/worker.py`），**保持单副本**（不要 `deploy.replicas>1`，否则启动恢复逻辑会冲突）。数据库用 Postgres，可独立扩展。

---

## 1. 生成密钥（务必换成自己的强随机值）

```bash
# JWT 签名密钥
openssl rand -hex 32
# 凭据加密密钥（Fernet，用于加密店铺 token / AI key / Shopify secret）
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

把两个值记下，第 3 步直接填进 compose 的 `environment`。

> ⚠️ `CREDENTIAL_ENCRYPTION_KEY` 一旦设定**不要再改**，否则历史加密数据（店铺 token 等）将无法解密。

---

## 2. 取得代码

把本仓库放到服务器（与你的 compose 同机），例如 `/opt/myapp/dshopflow`。
（`.env`、`*.db`、`storage/`、`logs/` 已在 `.gitignore`，不会带上本地数据。）

---

## 3. 加入你的 `docker-compose.yml`

在 `services:` 下追加以下内容（按你的实际路径 / 域名 / 反代网络调整）：

```yaml
  dsf-postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: dsf
      POSTGRES_PASSWORD: "你的强数据库密码"        # ← 自定义；下面 DATABASE_URL 必须用同一个
      POSTGRES_DB: dropshipflow
    volumes:
      - dsf-pgdata:/var/lib/postgresql/data
    # networks: [ proxy ]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dsf -d dropshipflow"]
      interval: 10s
      timeout: 5s
      retries: 5

  dsf-backend:
    build:
      context: /opt/myapp/dshopflow/backend
    restart: unless-stopped
    depends_on:
      dsf-postgres:
        condition: service_healthy
    environment:
      DEBUG: "false"
      SECRET_KEY: "第1步生成的hex"               # openssl rand -hex 32
      CREDENTIAL_ENCRYPTION_KEY: "第1步生成的Fernet"  # 一旦设定不可改
      # 密码用与上面 POSTGRES_PASSWORD 完全相同的值
      DATABASE_URL: "postgresql+asyncpg://dsf:你的强数据库密码@dsf-postgres:5432/dropshipflow"
      LOCAL_STORAGE_DIR: "/data/storage"
      # CORS 必须为 JSON 数组，含管理后台公网来源
      CORS_ORIGINS: '["https://app.dshopflow.com"]'
      # 可选：加了 dsf-redis 才填
      REDIS_URL: "redis://dsf-redis:6379/0"
    volumes:
      - dsf-storage:/data           # 仅存商品图（DB 在 postgres）
    expose:
      - "8000"            # 仅暴露给反代网络，不 ports 直接公网
    # networks: [ proxy ]  # 若你的反代用独立网络，取消注释并改成你的网络名

  dsf-admin:
    build:
      context: /opt/myapp/dshopflow/admin
      args:
        # 构建时内联，必须是后端公网地址 + /api/v1
        NEXT_PUBLIC_API_URL: "https://appapi.dshopflow.com/api/v1"
    restart: unless-stopped
    expose:
      - "3000"
    # networks: [ proxy ]

  # 可选服务
  dsf-redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - dsf-redis-data:/data
    # networks: [ proxy ]
```

并在文件底部的 `volumes:` 下追加：

```yaml
volumes:
  dsf-pgdata:
  dsf-storage:
  dsf-redis-data:
```

> 上面三处密钥/密码**直接写在 compose 的 `environment` 里**即可（你的 compose 多项目共用，沿用现有习惯）。注意：
> - `DATABASE_URL` 里的密码必须与 `dsf-postgres` 的 `POSTGRES_PASSWORD` **完全一致**（后端靠它连库）。
> - `SECRET_KEY` / `CREDENTIAL_ENCRYPTION_KEY` 是敏感值，确保该 compose 文件访问受限、勿提交到公开仓库。
> - 想集中管理也可放到 compose 同目录 `.env` 用 `${VAR}` 引用（等价，二选一）。

---

## 4. 反向代理（把两个域名指到容器）

把服务接到你反代所在的网络，并加路由：
- `appapi.dshopflow.com` → `dsf-backend:8000`
- `app.dshopflow.com` → `dsf-admin:3000`

按你现有反代选其一：

**Caddy**（Caddyfile）：
```
appapi.dshopflow.com   { reverse_proxy dsf-backend:8000 }
app.dshopflow.com { reverse_proxy dsf-admin:3000 }
```

**Traefik**（给服务加 labels）：
```yaml
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.dsfapi.rule=Host(`appapi.dshopflow.com`)"
      - "traefik.http.routers.dsfapi.tls.certresolver=le"
      - "traefik.http.services.dsfapi.loadbalancer.server.port=8000"
```
（admin 同理，端口 3000）

**Nginx**：完整可用配置见 **[`docs/nginx-dshopflow.conf`](nginx-dshopflow.conf)**（含 HTTP→HTTPS、SSL、代理头、超时）。用法：

1. **决定 `proxy_pass` 目标**（配置文件里两种都标了）：
   - **宿主机 nginx**：给容器加宿主机端口映射，再让 nginx 指向它。在 compose 的两个服务加：
     ```yaml
     dsf-backend:
       ports: ["127.0.0.1:8801:8000"]   # 配合 nginx proxy_pass http://127.0.0.1:8801
     dsf-admin:
       ports: ["127.0.0.1:3001:3000"]   # 配合 nginx proxy_pass http://127.0.0.1:3001
     ```
     （只绑 `127.0.0.1`，不对公网开放，安全。）
   - **Docker 内 nginx**（与本项目同 compose 网络）：把配置里的 `proxy_pass` 改成服务名
     `http://dsf-backend:8000` / `http://dsf-admin:3000`，则**无需** ports 映射，`expose` 即可。
2. **签证书**（Shopify OAuth 要求 https）：
   ```bash
   certbot certonly --webroot -w /var/www/certbot -d appapi.dshopflow.com -d app.dshopflow.com
   ```
3. 把 conf 放进 nginx 的 `conf.d/` → `nginx -t && nginx -s reload`。

> Caddy / Traefik 会自动签证书，无需手动 certbot。

---

## 5. 构建并启动

```bash
cd <你的 compose 目录>
docker compose build dsf-backend dsf-admin
docker compose up -d dsf-postgres dsf-backend dsf-admin   # 需要在线监控再加 dsf-redis
docker compose logs -f dsf-backend                        # 看到 "Application startup complete" 即成功
```

后端启动时会**按 ORM 模型自动建表**（首次在空 Postgres 上一步建全 20 张表，幂等，无需手动迁移）。

> 改了 `NEXT_PUBLIC_API_URL`（后端域名）后，**admin 必须重新 build**（该值是构建时内联的）。

---

## 6. 首次初始化

1. 打开 `https://app.dshopflow.com` → **注册第一个账号**：系统首个用户自动成为 `super_admin`（之后注册需邀请）。
2. 用超管登录 → 菜单 **⚙️ 平台设置**，填 Shopify App：
   - **API key / API secret**（Partner app 的）
   - **后端公网地址**：`https://appapi.dshopflow.com`
   - **管理后台地址**：`https://app.dshopflow.com`
   - 保存。页面会显示**回调地址**：`https://app.dshopflow.com/shops/oauth/callback`
3. 把该回调地址填进 Partner app 的 **Allowed redirection URL(s)**（需逐字一致）。
4. 菜单 **店铺管理** → 🔗 连接 Shopify → 填 handle → 授权 → 回连。

> Shopify 配置存数据库（平台设置页），**不需要重启**即可改。

---

## 7. 备份 / 升级 / 回滚

- **备份数据库**（Postgres）：
  ```bash
  docker compose exec dsf-postgres pg_dump -U dsf dropshipflow | gzip > dsf-db-$(date +%F).sql.gz
  ```
- **备份图片**（`dsf-storage` 卷）：
  ```bash
  docker run --rm -v <卷前缀>_dsf-storage:/data -v "$PWD":/backup alpine \
    tar czf /backup/dsf-storage-$(date +%F).tgz -C /data .
  ```
- **升级**：`git pull` → `docker compose build dsf-backend dsf-admin` → `docker compose up -d`。建表在启动时幂等执行（只建缺失表，保留数据）。表结构有破坏性变更时需手写 SQL/迁移（当前为加表/加列，`create_all` 即可覆盖）。
- **回滚**：切回上个镜像/代码版本重启；数据卷不变。

---

## 8. 排错

| 现象 | 排查 |
|------|------|
| OAuth 回调失败 / redirect_uri mismatch | Partner app 的 Allowed redirection URL 与「平台设置」回调地址要**逐字一致**（含 https、无尾斜杠差异） |
| 后台请求被 CORS 拦 | `CORS_ORIGINS` 是否含 `https://app.dshopflow.com`（JSON 数组格式） |
| admin 调 API 报跨域/连不上 | admin 是否用正确的 `NEXT_PUBLIC_API_URL` **重新构建**过 |
| 启动报「SECRET_KEY 仍为默认开发值」 | `DEBUG=false` 时必须设强 `SECRET_KEY` |
| 后端连不上数据库 / 启动卡住 | `dsf-postgres` 是否健康（`depends_on: service_healthy`）；`DATABASE_URL` 里的密码与 `POSTGRES_PASSWORD` **完全一致**、用户名/库名也对得上 |
| 在线监控/强制下线无效 | 未部署 `dsf-redis` 或 `REDIS_URL` 没指对（此功能可选，不影响其余） |
| 店铺 token / Shopify 配置突然解不开 | 是否改过 `CREDENTIAL_ENCRYPTION_KEY`（不可变） |

---

## 备注

- 商品图是 1688 的 alicdn 链接，Shopify 上架时由其服务端拉图——若被防盗链拦截，需后续做「图片转存自有图床/S3 再给 Shopify」（设 `STORAGE_BACKEND=s3` + S3 变量，`boto3` 已在依赖）。
- 后端**保持单副本**（进程内串行 worker）。数据库已是 Postgres，可独立扩容；后端要横向扩展需把后台任务迁到外部队列（见 `core/worker.py` 注释的心跳/租约方案）。
