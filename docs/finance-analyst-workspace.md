# 投研工作区说明

Analyst Agent 的投研工作区是一个以本地文件为基础的研究库。它把“正在生产的研究内容”和“可复用证据材料”分开管理，方便 agent 检索、引用、复核和写报告。

## 工作区目录

创建或迁移投研工作区时，会确保以下目录存在：

```text
workspace/
  companies/      # 公司研究，例如 companies/600519-kweichow-moutai/
  industries/     # 行业研究
  reports/        # 生成或整理后的研究报告
  knowledge/      # 公告、财报摘录、行业材料、会议纪要等可复用资料
  templates/      # Markdown 报告模板
  skills/         # 默认投研技能
```

应用内有两个主要入口：

- **研究工作区**：用于打开和编辑 `companies/`、`industries/`、`reports/`、`templates/` 下的 Markdown 文件。
- **知识库**：用于搜索和查看 `knowledge/` 下的资料，也可以打开本地文件所在位置或用系统应用查看非 Markdown 文件。

## 默认模板

工作区会写入这些 Markdown 模板：

- `templates/company-deep-research.md`
- `templates/earnings-review.md`
- `templates/event-impact.md`
- `templates/industry-scan.md`

每个模板都包含 evidence ledger 区域，用来记录结论、来源类型、来源路径或 provider、数据日期、是否为推断以及置信度。

## 默认投研技能

默认技能会放在工作区的 `skills/` 目录中：

- `company-deep-research`
- `earnings-review`
- `event-impact`
- `industry-scan`

这些技能要求 agent 先规划研究流程，再检索本地知识库和只读市场数据，最后生成带证据链的研究输出。

## Session Tools

### `research_workflow`

复杂研究任务的起点。它支持：

- `company_deep_research`
- `earnings_review`
- `event_impact`
- `industry_scan`
- `auto`

当缺少研究对象、事件日期或财报期间等关键输入时，工具会返回需要人工补充的信息，而不是让 agent 猜测。

返回内容包括：

- 研究类型、对象、市场范围、日期和深度
- 研究步骤
- 推荐调用的数据工具
- 子角色提示词
- evidence ledger 模板
- 可选报告写入路径

### `knowledge_search`

检索工作区本地研究材料。默认搜索：

- `knowledge/`
- `companies/`
- `industries/`
- `reports/`

应用内知识库搜索只面向 `knowledge/`，适合查找可复用材料。

### `finance_market_data`

只读市场数据工具。支持的请求类型包括：

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

provider router 的默认策略：

- A 股和港股优先使用 iFinD。
- 美股财报和公开市场数据优先使用 `edgartools` 或 `yfinance`。
- 全局或备用场景可以尝试 `akshare`、`baostock` 等本地 Python provider。

如果没有可用 provider，工具会返回 warning 和空数据，agent 应披露限制，并继续使用本地文件或用户提供的证据。

## iFinD 配置

iFinD 是可选数据源，需要用户自己提供 token。不要把真实 token 提交到仓库。

```bash
IFIND_MCP_AUTH_TOKEN=your-ifind-token
IFIND_STOCK_MCP_URL=https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-stock-mcp
IFIND_FUND_MCP_URL=https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-fund-mcp
IFIND_EDB_MCP_URL=https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-edb-mcp
```

如果 `IFIND_MCP_AUTH_TOKEN` 未设置，`finance_market_data` 会返回 provider unavailable，而不会中断整个研究。

## 可选 Python provider

可设置本地 Python runtime：

```bash
ANALYST_FINANCE_PYTHON=python
```

可选依赖包括：

- `yfinance`
- `edgartools`
- `akshare`
- `baostock`

这些 provider 只用于研究数据读取。缺包、超时或本地 Python 不可用时，应作为 warning 处理。

## Research-Only Policy

投研工作区必须遵守研究优先原则：

- 可以输出事实、估值假设、情景分析、风险、证据缺口和开放问题。
- 可以比较 bull case 和 bear case。
- 可以说明市场结构、流动性、波动和技术背景。
- 不可以输出买入、卖出、加仓、减仓、做空、杠杆、止损、止盈、订单或交易执行建议。
- 不可以接入交易所执行 API 或托管用户资金。

TradingAgents 风格的 trader、portfolio 等角色在本项目中只被改造成研究综合、风险复核和证据验证角色。

## 推荐输出格式

研究输出建议包含：

1. 研究对象与时间边界
2. 核心观点
3. 关键事实与数据
4. 业务、财务、估值、行业或事件分析
5. Bull case
6. Bear case / risk case
7. 待验证问题
8. Evidence ledger

Evidence ledger 示例：

| Claim | Source Type | Source | Data Date | Inference | Confidence |
|---|---|---|---|---|---|
| 收入增速放缓 | finance_data_provider | ifind:get_stock_financial | 2026-05-26 | false | medium |
| 需求恢复依赖下游库存周期 | explicit_inference | Based on industry notes | 2026-05-26 | true | low |
