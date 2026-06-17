# DropShipFlow 浏览器插件（Chrome MV3）

在 1688 商品详情页一键抓取商品（标题/价格/SKU/图片/属性/图文详情）并加入 DropShipFlow 选品池。
纯手写实现，**无需构建**——直接加载未打包的本目录即可。

## 安装（开发/自用）

1. 打开 `chrome://extensions`，开启右上角「开发者模式」。
2. 点「加载已解压的扩展程序」，选择本 `extension/` 目录。
3. 点工具栏图标 → 打开右侧侧边栏。

## 配置后端域名

默认连接本地：后端 `http://localhost:8000`、管理后台 `http://localhost:3000`。

部署到自有服务器后，在侧边栏点 **⚙（右上角）** 打开「设置」，填入：

- **后端地址**：如 `https://api.yourdomain.com`
- **管理后台地址**：如 `https://admin.yourdomain.com`

保存时浏览器会请求对应域名的访问权限（用于调用 API 与读取登录态），授权后生效。
留空即恢复默认 localhost。

## 登录

插件不单独登录：在管理后台登录后，侧边栏会自动从已打开的管理后台标签页读取登录态（token）。
若未自动连接，先在管理后台完成登录再打开侧边栏。

## 文件说明

| 文件 | 作用 |
|------|------|
| `manifest.json` | MV3 清单（侧边栏 + 1688 内容脚本 + 可选主机权限） |
| `config.js` | 共享运行时配置（后端/后台域名，默认 localhost），SW 与侧边栏共用 |
| `background.js` | Service Worker：打开侧边栏、代理 API |
| `content.js` | 1688 页面抓取（内嵌 offer JSON 优先 + DOM 启发式兜底） |
| `popup.html` / `popup.js` | 侧边栏 UI 与逻辑 |
