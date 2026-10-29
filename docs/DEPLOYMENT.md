# Cloudflare Workers 静态部署计划

当前站点：[智能费率推荐](https://smart-fee-recommender.yfsper233-fees.workers.dev/)。首次发布已完成，版本、验收与自动部署状态见 [部署记录](DEPLOYMENT-RECEIPT.md)。

## 资源

| 资源 | 数量与用途 |
| --- | --- |
| GitHub 公开仓库 | 1 个，保存源码与验证工作流 |
| Cloudflare 账号 | 1 个，管理 Workers Static Assets |
| Worker 静态站点 | 1 个，名称 smart-fee-recommender |
| Node.js 与 Wrangler | Node.js 24；Wrangler 固定版本并提交锁文件 |
| mempool.space 公共接口 | 浏览器直接订阅，无需本项目 API 密钥 |
| 域名 | 首次使用 workers.dev，自定义域名可选 |

无需数据库、KV、R2、Durable Objects 或长期运行的服务器。`wrangler.json` 仅声明 `dist/` 静态资源，没有 Worker 计算入口。

## 发布前

```bash
npm ci
npm run verify
npm run deploy:check
```

构建仅允许 `scripts/assets.mjs` 中的七个文件进入 `dist/`，包括 Cloudflare 解析但不公开提供的 `_headers`。测试、说明文件、本地观测数据与开发环境文件不进入站点资源。

## 方式一：连接 GitHub

在 Cloudflare Workers & Pages 选择连接 Git 仓库：

- 仓库：yfsper233/smart-fee-recommender。
- 生产分支：main。
- 项目根目录：仓库根目录。
- 构建命令：`npm run verify`。
- 部署命令：`npm run deploy`。
- Node.js：24（可在构建变量中设置 `NODE_VERSION=24`）。

Cloudflare 的 GitHub 集成仅需访问本仓库。依赖版本由 `package-lock.json` 与 `package.json` 固定。

GitHub Actions 只验证，不自动向 Cloudflare 发布，也不需要 Cloudflare 密钥。GitHub Actions 与 Workers Builds 是独立流程，Git 集成发布前的同一组验证由构建命令再次执行。

## 方式二：本地 Wrangler

先完成发布前验证，再登录所选 Cloudflare 账号：

```bash
npx wrangler login
npm run deploy
```

执行部署时才创建或更新 Cloudflare 资源。账号信息与凭据不写入公开源码。

## 上线验收

1. 打开分配的 HTTPS workers.dev 地址，页面标题为“智能费率推荐”。
2. 检查 HTML、CSS、JavaScript 模块正常加载；静态响应携带 CSP 与 nosniff。
3. 浏览器可连接 `wss://mempool.space/api/v1/ws`，页面进入实时订阅状态。
4. 修改最低优先级时两种算法共同重算；修改搜索步长只改变单步最优。
5. 核对共同达标起点、95% 搜索边界、两种选点与累计指标。
6. 断线或观测过期时暂停推荐，重新连接后恢复完整快照。

## 回退

保留已验收部署对应的 Git 提交。发生页面或协议回归时，使用 Cloudflare 部署历史回退，或检出已验收提交重新发布；不更改应用数据，因为本项目不持久化应用数据。

## 官方依据

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [静态配置与绑定](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Workers Builds 配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [静态响应头](https://developers.cloudflare.com/workers/static-assets/headers/)
- [计费与限制](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
