# 首次部署记录

- 站点：[智能费率推荐](https://smart-fee-recommender.yfsper233-fees.workers.dev/)
- 发布时间：2026-10-29 23:05:50（Asia/Shanghai）。
- 发布方式：Cloudflare API，Workers Static Assets，未连接 Git 自动部署。
- 源码提交：`ad3c6b5d3b4cf56ccf8588f6404b334cd2292bac`。
- Cloudflare 部署编号：`31a6ed67-9451-40e0-96b1-76729e3cae74`。
- Cloudflare 版本编号：`8713ea2e-60aa-46de-bf90-39754069b88f`，当前流量 100%。
- 公开静态资源：6 个文件，共 47,568 字节；`_headers` 作为响应头配置解析，不公开提供。
- Worker 无计算入口、无资源绑定；预览地址未启用。

## 已验证

- 发布前 `npm run verify` 通过，包含 25 项算法和数据同步测试；`npm run deploy:check` 通过。
- [源码提交的 GitHub Actions](https://github.com/yfsper233/smart-fee-recommender/actions/runs/40895062006) 通过。
- HTTPS 页面及 5 个 CSS/JavaScript 资源返回 200，逐文件 SHA-256 与本地 `dist/` 相同；MIME、CSP、nosniff 正确。
- `/_headers`、`/test/solver.test.mjs` 返回 404。
- 浏览器显示“实时订阅中”，持续收到 mempool 候选区块数据，两个算法结果和三个图表正常显示。
- 最低优先级从 60% 改为 50% 后结果重算；搜索步长 0.01/0.05 可切换，验收后恢复默认 60%、0.01。
- 浏览器未出现错误或警告；图表无 NaN/Infinity，当前视口无横向溢出。

本次未在公网人工制造断线或等待观测过期，不将这两项标记为已完成的公网故障验收。

## 自动部署状态

Cloudflare 的仓库连接接口返回“项目未连接 Git 账号”（错误 8000008）；尚未创建构建触发器。当前 GitHub Actions 只验证，后续提交不会自动更新线上站点。

后续在 Cloudflare 授权 GitHub 集成仅访问 `yfsper233/smart-fee-recommender`，再按 [部署计划](DEPLOYMENT.md) 配置 main 分支、构建与部署命令。此授权不影响当前已上线的静态站点。
