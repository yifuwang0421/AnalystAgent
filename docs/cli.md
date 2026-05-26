# CLI 使用说明

`craft-cli` 是 Analyst Agent 的终端客户端。它通过 WebSocket 连接本地或远程 headless server，适合脚本化运行、CI 验证、远程会话管理和一次性 agent 任务。

命令名和 `CRAFT_*` 环境变量沿用 Craft Agent 基础架构，是兼容命名。

## 前置条件

- 已安装 Bun。
- 需要运行 `run` 或 `--validate-server` 时，准备一个可用 LLM API key，或在应用内配置好对应连接。
- 需要连接已有 server 时，准备 server URL 和 token。

## 本地运行

```bash
git clone <repository-url>
cd AnalystAgent
bun install

# 查看帮助
bun run apps/cli/src/index.ts --help

# 可选：链接为全局命令
cd apps/cli
bun link
craft-cli --help
```

## 连接参数

| Flag | Env var | 默认值 | 说明 |
|---|---|---|---|
| `--url <ws[s]://...>` | `CRAFT_SERVER_URL` | 无 | server WebSocket URL |
| `--token <secret>` | `CRAFT_SERVER_TOKEN` | 无 | server 认证 token |
| `--workspace <id>` | 无 | 自动检测 | 工作区 ID |
| `--timeout <ms>` | 无 | `10000` | 普通请求超时 |
| `--tls-ca <path>` | `CRAFT_TLS_CA` | 无 | 自签 TLS 证书 CA |
| `--json` | 无 | `false` | 输出原始 JSON |
| `--send-timeout <ms>` | 无 | `300000` | `send` 命令超时 |

不要把真实 token 写入文档、脚本仓库或 CI 日志。建议用环境变量或 secret store 注入。

## 启动 Headless Server

```bash
CRAFT_SERVER_TOKEN=<generated-token> bun run server:start
```

连接测试：

```bash
CRAFT_SERVER_URL=ws://127.0.0.1:9100 CRAFT_SERVER_TOKEN=<generated-token> bun run apps/cli/src/index.ts ping
```

## 常用命令

```bash
craft-cli ping              # 检查连接
craft-cli health            # 检查 credential store
craft-cli versions          # 查看 server/runtime 版本
craft-cli workspaces        # 列出工作区
craft-cli sessions          # 列出当前工作区会话
craft-cli connections       # 列出 LLM connections
craft-cli sources           # 列出 Sources
```

## 会话操作

```bash
craft-cli session create --name "Research task"
craft-cli session messages <session-id>
craft-cli send <session-id> "Summarize the current workspace"
craft-cli cancel <session-id>
craft-cli session delete <session-id>
```

`send` 会流式输出模型回复和工具调用摘要。

## 一次性运行任务

`run` 会自动启动临时 server、创建会话、发送 prompt、流式输出回复并退出。

```bash
bun run apps/cli/src/index.ts run "Summarize this repository"
```

带工作区目录：

```bash
bun run apps/cli/src/index.ts run --workspace-dir ./example-workspace "List available research files"
```

指定 provider：

```bash
LLM_API_KEY=your-provider-key bun run apps/cli/src/index.ts run --provider openai --model gpt-4o "Hello"
```

常用参数：

| Flag | 默认值 | 说明 |
|---|---|---|
| `--workspace-dir <path>` | 无 | 注册一个工作区目录 |
| `--source <slug>` | 无 | 启用某个 Source，可重复 |
| `--output-format <fmt>` | `text` | `text` 或 `stream-json` |
| `--mode <mode>` | `allow-all` | `safe`、`ask`、`allow-all` |
| `--no-cleanup` | `false` | 运行后保留临时会话 |
| `--provider <name>` | `anthropic` | LLM provider |
| `--model <id>` | provider 默认值 | 模型 ID |
| `--api-key <key>` | 环境变量 | API key |
| `--base-url <url>` | 无 | 自定义兼容端点 |

## Raw RPC

```bash
craft-cli invoke system:homeDir
craft-cli invoke sessions:get '"workspace-id"'
craft-cli listen session:event
```

Raw RPC 适合调试和自动化，但需要了解内部 channel contract。

## Server 验证

```bash
craft-cli --validate-server --url ws://127.0.0.1:9100 --token <generated-token>
```

如果不传 `--url`，验证命令会自动启动本地 server。它会创建并删除临时 session、source 和 skill。请不要在含敏感资料的生产工作区随意运行。

## TLS

远程 server 推荐使用 `wss://`：

```bash
craft-cli --url wss://server.example.com:9100 ping
craft-cli --url wss://server.example.com:9100 --tls-ca /path/to/ca.pem ping
```

## 常见问题

| 问题 | 可能原因 | 处理方式 |
|---|---|---|
| `Connection timeout` | server 未启动或网络不可达 | 检查 URL、端口和 server 日志 |
| `AUTH_FAILED` | token 不匹配 | 检查 `CRAFT_SERVER_TOKEN` |
| `PROTOCOL_VERSION_UNSUPPORTED` | CLI 与 server 版本不一致 | 更新到同一代码版本 |
| `WebSocket connection error` | 网络、代理或 TLS 问题 | 检查代理、证书和防火墙 |
| `No workspace available` | 尚未创建工作区 | 先在桌面应用或 API 中创建工作区 |
