# Analyst Agent

Analyst Agent 是一个面向投研工作的本地 AI 桌面工作台。它基于 [Craft Agent / Craft Agents OSS](https://github.com/lukilabs/craft-agents-oss) 的开源基础进行调整，保留多会话、工作区、权限模式、Sources、Skills、自动化和远程 server 能力，并把产品方向改造成“投研优先、交易弱化”的研究助手。

项目当前重点不是自动下单或量化交易执行，而是帮助用户组织研究资料、检索知识库、调用只读市场数据、拆解研究流程、生成带证据链的研究结论。

## 当前功能

- **桌面投研工作台**：Electron + React 桌面应用，支持多会话、工作区、会话历史、设置页、可拖拽的中间工作区和右侧聊天面板。
- **投研文件工作区**：工作区内自动维护 `companies/`、`industries/`、`reports/`、`knowledge/`、`templates/` 等目录，用于沉淀公司研究、行业研究、报告、知识材料和模板。
- **知识库检索**：`knowledge_search` 和应用内知识库搜索会检索本地研究材料，并把文件路径、片段和证据来源带回给 agent。
- **研究流程编排**：`research_workflow` 会根据公司深度研究、财报复盘、事件影响、行业扫描等任务生成结构化研究计划、所需工具、子角色提示词和证据台账模板。
- **只读市场数据工具**：`finance_market_data` 通过 provider router 调用 iFinD 或可选 Python 数据库，支持标的搜索、行情、历史价格、财务摘要、财报、估值、新闻、公告、宏观数据和技术指标等查询。
- **投研角色预设**：内置 Research Manager、Fundamental Analyst、Financial Quality Analyst、Valuation Analyst、Industry Analyst、Macro & Policy Analyst、Market Structure Analyst、News/Event Analyst、Evidence Verifier、Bull/Bear Reviewer、Portfolio Risk Analyst 等角色，并支持自定义研究角色。
- **证据优先输出**：研究报告应区分事实、计算、假设、推断和待验证事项，并附上 evidence ledger。
- **多模型连接**：保留 Anthropic、OpenAI/Codex、Google、GitHub Copilot、OpenRouter、自定义 OpenAI/Anthropic 兼容端点等连接方式。
- **Sources 与 Skills**：可接入 MCP server、REST API、本地文件系统和自定义技能。
- **权限模式**：支持 Explore、Ask to Edit、Auto 三类权限模式，用来控制 agent 对文件和命令的访问。
- **自动化与消息网关**：保留计划任务、事件触发、会话标签/状态触发，以及 Telegram、WhatsApp、Lark 等消息通道相关能力。
- **远程 server 与 CLI**：支持 headless server、WebSocket 客户端和 `craft-cli` 终端工具，便于远程运行或脚本化使用。

## 项目边界

Analyst Agent 是研究助手，不是交易机器人。

它应该：

- 生成研究计划、报告草稿、证据台账和风险检查清单。
- 调用只读数据源，并说明数据日期、provider、路径和限制。
- 在缺少关键输入时先追问，而不是猜测。
- 明确标注推断、低置信度结论和待验证事项。

它不应该：

- 连接交易所执行 API。
- 下单、撤单或托管交易。
- 给出精确仓位、杠杆、止损、止盈或买卖指令。
- 把技术指标或新闻解读包装成确定性收益预测。

## 快速开始

### 环境要求

- [Bun](https://bun.sh/)
- Node.js 18+
- Git
- Windows、macOS 或 Linux

### 本地运行桌面应用

```bash
git clone <repository-url>
cd AnalystAgent
bun install
bun run electron:dev
```

如果需要完整构建后运行：

```bash
bun run electron:start
```

Windows PowerShell 环境下，如果 `npm.ps1` 被执行策略拦截，优先使用 `bun` 或 `npm.cmd`。

## 首次使用

1. 启动桌面应用。
2. 在设置中添加 LLM connection，例如 Anthropic API、ChatGPT/Codex OAuth、OpenAI API、Google AI Studio、GitHub Copilot 或自定义兼容端点。
3. 创建或选择一个工作区。
4. 对投研工作区，应用会准备研究目录、模板和默认技能。
5. 把可复用材料放入 `knowledge/`，例如公告、财报摘录、行业资料、会议纪要或 Markdown/CSV 文件。
6. 在聊天中提出投研任务，例如“对某公司做深度研究”“复盘这份财报”“分析某事件对行业的影响”。

## 投研工作区结构

新建或迁移后的投研工作区会包含：

```text
workspace/
  companies/      # 公司研究
  industries/     # 行业研究
  reports/        # 输出报告
  knowledge/      # 可复用证据和资料
  templates/      # Markdown 报告模板
  skills/         # 默认投研技能
```

应用内会把研究生产和知识沉淀分开：

- **研究工作区**：打开和编辑 `companies/`、`industries/`、`reports/`、`templates/` 中的 Markdown 文件。
- **知识库**：搜索和查看 `knowledge/` 中的可复用材料，供 agent 引用和复核。

默认模板包括：

- `company-deep-research.md`
- `earnings-review.md`
- `event-impact.md`
- `industry-scan.md`

更多细节见 [docs/finance-analyst-workspace.md](docs/finance-analyst-workspace.md)。

## 常用投研工具

### `research_workflow`

用于复杂投研任务的第一步。它会返回：

- 任务类型和研究边界
- 缺失输入
- 研究步骤
- 推荐调用的只读工具
- 子角色提示词
- evidence ledger 模板
- 可选报告写入路径

示例需求：

```text
请对宁德时代做公司深度研究，重点关注盈利质量、估值假设和风险。
```

### `knowledge_search`

检索工作区本地材料，默认覆盖：

- `knowledge/`
- `companies/`
- `industries/`
- `reports/`

### `finance_market_data`

只读市场数据工具。常见请求类型：

- `search_instruments`
- `get_quote`
- `get_historical_prices`
- `get_financial_summary`
- `get_financial_statements`
- `get_valuation_metrics`
- `get_news`
- `get_announcements`
- `get_macro_data`
- `get_technical_indicators`

如果 provider 不可用，工具会返回非致命 warning，agent 应继续基于本地知识库和用户提供文件推进，并说明数据限制。

## 可选市场数据配置

iFinD provider 需要用户自己提供 token。不要把真实 token 提交到仓库。

```bash
IFIND_MCP_AUTH_TOKEN=your-ifind-token
IFIND_STOCK_MCP_URL=https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-stock-mcp
IFIND_FUND_MCP_URL=https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-fund-mcp
IFIND_EDB_MCP_URL=https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-edb-mcp
```

可选 Python provider 使用本机 Python 环境，目标是只读研究数据：

- `yfinance`
- `edgartools`
- `akshare`
- `baostock`

如果缺少 Python 包，工具应返回 provider unavailable，而不是中断研究流程。

## CLI 与远程 server

启动 headless server：

```bash
CRAFT_SERVER_TOKEN=<generated-token> bun run server:start
```

连接远程或本地 server：

```bash
CRAFT_SERVER_URL=ws://127.0.0.1:9100 CRAFT_SERVER_TOKEN=<generated-token> bun run apps/cli/src/index.ts ping
```

自包含运行一次任务：

```bash
bun run apps/cli/src/index.ts run --provider openai --model gpt-4o "Summarize this repository"
```

说明：仓库中仍有部分 `CRAFT_*` 环境变量、`craft-cli` 命令名和 `@craft-agent/*` package scope，这是继承自 Craft Agent 基础架构的兼容命名，不代表需要连接 Craft 官方服务。

更多 CLI 用法见 [docs/cli.md](docs/cli.md)。

## 开发命令

```bash
# 桌面应用开发
bun run electron:dev

# 构建并运行桌面应用
bun run electron:start

# 类型检查
bun run typecheck:all

# 常规验证
bun run validate:dev

# Electron 单独检查
bun run typecheck:electron
```

## 技术架构

```text
apps/
  electron/              # Electron 桌面应用
  cli/                   # WebSocket CLI 客户端
  webui/                 # Web UI 构建入口
  viewer/                # 会话查看器
packages/
  core/                  # 核心类型
  shared/                # 工作区、模型、配置、agent 逻辑
  server-core/           # RPC handlers、session 管理、server transport
  server/                # headless server 入口
  session-tools-core/    # session tools 和投研工具
  pi-agent-server/       # Pi backend 适配
  ui/                    # 共享 UI 组件
```

## 隐私与安全

- 不要提交 `.env`、真实 API key、OAuth secret、iFinD token、server token 或个人数据文件。
- 示例文档只使用占位符，例如 `<generated-token>`、`your-ifind-token`、`your-provider-key`。
- 本地工作区的 `knowledge/`、`reports/` 和会话历史可能包含敏感研究资料，上传仓库前请自行清理。
- 对外分享报告时，先检查 evidence ledger、原始文件路径、截图和引用片段是否包含隐私信息。
- 使用 `allow-all` 权限模式前请确认当前工作区和命令范围可信。

更多说明见 [docs/privacy-and-data.md](docs/privacy-and-data.md) 和 [SECURITY.md](SECURITY.md)。

## 与 Craft Agent 的关系

本项目是在 Craft Agent / Craft Agents OSS 的代码基础上进行二次调整的投研方向版本。当前仍保留大量底层命名、协议、配置目录和 package scope，例如 `CRAFT_SERVER_TOKEN`、`craftagents://`、`@craft-agent/*`。这些命名主要用于兼容既有实现。

主要调整方向包括：

- 品牌和应用入口调整为 Analyst Agent。
- UI 导航更偏向投研角色、研究工作区和知识库。
- 新增投研角色预设、自定义研究 agent 和研究上下文注入。
- 新增 `research_workflow`、`finance_market_data`、`knowledge_search` 等投研工具链。
- 建立 research-only policy，弱化交易执行属性。
- 增加本地研究文件区、知识库搜索、Markdown 编辑和证据台账约束。

## License

本项目遵循 Apache License 2.0。详见 [LICENSE](LICENSE)。

第三方项目、SDK、图标和开源组件的版权与许可请参考 [NOTICE](NOTICE) 以及各自 upstream license。
