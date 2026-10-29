# 智能费率推荐

在线访问：[智能费率推荐](https://smart-fee-recommender.yfsper233-fees.workers.dev/)。

浏览器实时订阅 mempool.space 的下一个候选区块，并列展示“单步最优”和“累计均值最优”的费率、优先级与选点图表。

项目采用纯静态部署：数据订阅与计算均在浏览器内完成，不依赖数据库、服务端 WebSocket 代理或 Worker 计算入口。

## 本地运行

使用 Node.js 24（最低 22）：

```bash
npm ci
npm run dev
```

默认打开 http://127.0.0.1:8787/。如端口已占用，可使用 `PORT=8788 npm run dev`。

```bash
npm run verify
npm run deploy:check
```

`verify` 检查资源、文案与模块语法，运行求解器测试，并构建 `dist/`。`deploy:check` 仅做 Wrangler 本地试运行，不发布到 Cloudflare。

## 两种算法

最低优先级默认 60%，搜索上限为首次达到 95% 优先级的最低费率；同费率档位整体计入，实际优先级可能超过 95%。优先级是候选交易按有效费率、交易重量构造的队列位置，不代表确认概率。

- **单步最优**：搜索步长 δ 表示一次比较的加价幅度。最大化 `P(f) - P(f-δ)`，终点达标且不高于搜索上限。步长可选 0.01、0.05、0.10 sat/vB；候选终点按 0.01 sat/vB 档位扫描。包括首次达标那一步，并列取较低费率。
- **累计均值最优**：固定最低达标费率 a，最大化 `[P(f)-P(a)]/(f-a)`。累计全部加价，包括零收益档位；搜索完整范围，并列取较低费率。没有额外收益时保留达标费率。

两张结果卡从相同达标起点计算累计加价与累计平均效率；数据同步中、断线或过期时暂停推荐。

## Cloudflare Workers 静态部署

已准备 `wrangler.json`、静态响应头、固定版本 Wrangler 与 GitHub Actions 验证工作流。

1. 准备 Cloudflare 账号，使用 Workers & Pages。
2. 在 Workers Builds 中连接本仓库，生产分支选择 `main`。
3. 构建命令设为 `npm run verify`，部署命令设为 `npm run deploy`，项目根目录为仓库根目录。
4. 首次部署使用 Cloudflare 分配的 `workers.dev` 地址；自定义域名可后续接入。
5. 验收静态资源、mempool WebSocket、两种算法与断线过期状态。

已通过 Cloudflare API 完成首次静态发布；浏览器实时订阅、两种算法、图表和参数切换已验收。GitHub Actions 已启用验证；Cloudflare GitHub 集成尚未授权，因此后续提交暂不会自动部署。

本地部署和详细资源清单见 [部署计划](docs/DEPLOYMENT.md)，本次版本与验收范围见 [部署记录](docs/DEPLOYMENT-RECEIPT.md)，项目范围与验收标准见 [项目说明](docs/PROJECT.md)。

## 目录

```text
public/                 浏览器静态资源与集中式 UI 文案
scripts/                资源检查、静态构建与本地预览
test/                  算法及 WebSocket 数据一致性测试
docs/                  项目说明与 Cloudflare 部署计划
wrangler.json           仅声明静态资源目录
.github/workflows/      测试、构建与部署配置试运行
```

## 数据与源码依据

数据订阅：`wss://mempool.space/api/v1/ws`，消息 `{"track-mempool-block":0}`。完整快照后应用增量；序号不连续时重新同步。有效费率沿用上游两位小数精度。

公开接口与协议参考 [mempool WebSocket API](https://mempool.space/docs/api/websocket#track-mempool-block)；图表及字段语义参考 [mempool/mempool 固定版本源码](https://github.com/mempool/mempool/tree/f669f14851fb62b5fdbd16f662667228354b027f)。本项目保留自己的浏览器渲染与纯函数求解实现。

Cloudflare 配置依据：[Static Assets](https://developers.cloudflare.com/workers/static-assets/)、[配置与绑定](https://developers.cloudflare.com/workers/static-assets/binding/)、[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)、[静态响应头](https://developers.cloudflare.com/workers/static-assets/headers/)。

## 许可证

当前公开源码，尚未指定开源许可证。
