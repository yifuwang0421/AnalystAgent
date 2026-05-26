# Security Policy

Analyst Agent 是本地优先的 AI 工作台，可能接触 API key、OAuth token、本地文件、研究材料和会话历史。请把安全和隐私作为默认要求。

## 报告安全问题

请不要在公开 issue 中披露漏洞细节、凭据、token、日志或私有数据。

推荐方式：

- 使用 GitHub private security advisory。
- 或通过项目维护者提供的非公开联系方式提交。

报告时请包含：

- 漏洞描述
- 复现步骤
- 影响范围
- 相关版本或 commit
- 可选修复建议

## 支持范围

当前只维护最新版本。

| Version | Supported |
|---|---|
| Latest | Yes |
| Older versions | No |

## 凭据与数据

不要提交：

- `.env`
- API key
- OAuth client secret
- server token
- iFinD token
- cookie、session、浏览器 profile
- 用户研究资料、财报批注、会议纪要、私有报告
- 真实会话日志或截图中的个人信息

示例文档只能使用占位符，例如：

```bash
CRAFT_SERVER_TOKEN=<generated-token>
IFIND_MCP_AUTH_TOKEN=your-ifind-token
LLM_API_KEY=your-provider-key
```

## 本地安全建议

- 默认使用 `safe` 或 `ask` 权限模式处理陌生仓库和敏感资料。
- 只有在完全信任当前工作区和命令范围时才使用 `allow-all`。
- 添加 MCP server、REST source 或本地脚本前，先确认来源可信。
- 对外分享报告前，检查 evidence ledger、引用片段、文件路径和截图。
- 远程 server 必须使用强 token。公网访问建议使用 `wss://` 和可信 TLS。
- CI 和发布环境使用 secret store 注入凭据，不要写入配置文件。

## Local MCP Server Isolation

本项目会过滤部分敏感环境变量，避免默认泄露给本地 MCP subprocess。典型变量包括：

- `ANTHROPIC_API_KEY`
- `CLAUDE_CODE_OAUTH_TOKEN`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN`
- `GITHUB_TOKEN`
- `GH_TOKEN`
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`
- `STRIPE_SECRET_KEY`
- `NPM_TOKEN`

如果某个 MCP server 确实需要凭据，请在该 source 的配置中显式传入最小必要环境变量。

## 投研边界

投研工具必须保持只读或可审计写入：

- 可以读取公开市场数据、本地研究材料和用户显式提供的文件。
- 可以生成报告、证据台账和风险清单。
- 不应连接交易所执行 API。
- 不应自动下单或提供可直接执行的买卖、仓位、杠杆、止损、止盈指令。
