# AnalystAgent

Research-first local AI desktop workspace for investment analysis, evidence management, and multi-agent research orchestration.

AnalystAgent turns broad research questions into structured analyst work: it plans the research, delegates specialist subagents, connects to finance data sources and local knowledge, checks evidence quality, and synthesizes an auditable final deliverable. It is not a trading bot and does not execute orders.

## Highlights

- **Four-layer research architecture**: main agent, six fixed subagents, reusable skills, and unified data sources.
- **Research Manager orchestration**: decomposes tasks, spawns subagent sessions, evaluates deliverables, requests revisions, and writes the final synthesis.
- **Six fixed analyst roles**: industry, fundamental, forecast and valuation, report writing, technical analysis, and risk control.
- **Unified finance data router**: normalizes iFinD, Wind-style MCP sources, API providers such as tushare/akshare/yfinance/edgartools, local knowledge, and web search into evidence-aware research inputs.
- **Evidence-first outputs**: separates facts, calculations, assumptions, inferences, warnings, and open verification items.
- **Local desktop workflow**: Electron app with sessions, sources, skills, permission modes, file attachments, and workspace-aware research folders.

## Research Architecture

AnalystAgent V1 uses a fixed four-layer model.

```text
Analyst Agent / Research Manager
  -> Industry Analyst
  -> Fundamental Analyst
  -> Forecast & Valuation Analyst
  -> Report Writer
  -> Technical Analyst
  -> Risk Control Analyst
      -> shared skills and session tools
          -> MCP / API providers / local knowledge base / web search
```

### Layer 1: Main Agent

The main agent is the Research Manager. It does not replace the specialist roles. Its job is to:

- classify the research task and identify missing inputs;
- break the task into six subagent task cards;
- create real independent subagent sessions with `spawn_session` for substantial research;
- collect each subagent's structured deliverable;
- evaluate evidence quality, source freshness, provider warnings, and unsupported claims;
- ask subagents to add evidence, revise, or downgrade confidence when needed;
- synthesize the final report, evidence ledger, risks, disagreements, and follow-up questions.

### Layer 2: Six Subagents

V1 intentionally keeps the role set small and fixed:

| Subagent | Scope |
| --- | --- |
| Industry Analyst | Industry chain, supply and demand, technology trends, policy, competition, and cycle position |
| Fundamental Analyst | Business model, products, ownership, governance, financial quality, growth drivers, and competitive position |
| Forecast & Valuation Analyst | Forecast assumptions, business segmentation, DCF, relative valuation, sensitivity, and valuation risk |
| Report Writer | Research outline, final narrative, chart/table suggestions, evidence index, and presentation-ready draft |
| Technical Analyst | Price structure, volume, support/resistance zones, relative strength, sentiment, and market structure |
| Risk Control Analyst | Evidence review, disconfirming evidence, exposure, concentration, correlation, triggers, and scenario risks |

Each subagent returns the same deliverable contract:

- `facts`
- `calculations`
- `assumptions`
- `inferences`
- `evidenceLedger`
- `warnings`
- `finalView`
- `handoffToMainAgent`

### Layer 3: Skills

Skills remain lightweight in V1. They are reusable instructions and task templates that subagents can call when useful. The first priority is stable role boundaries and data access; specialized skills can be added gradually for repeated workflows such as earnings review, DCF assumptions, industry mapping, or risk checklists.

### Layer 4: Data Sources

The data layer is unified behind session tools and workspace sources:

| Source type | Examples | V1 behavior |
| --- | --- | --- |
| MCP / skills | Eastmoney Miaoxiang, iFinD, Wind-style MCP servers, custom MCP servers | Used through configured workspace Sources and finance session tools |
| APIs | tushare, akshare, yfinance, edgartools, baostock | Routed through `finance_market_data` with normalized warnings and citations |
| Local knowledge base | `knowledge/`, `companies/`, `industries/`, `reports/` | Searched by `knowledge_search`; future RAG can replace the backend without changing the research contract |
| Web search | News, filings, policy releases, company pages | Used when current information is needed; outputs must cite URL/source and search date |

Provider failures are non-fatal. The agent should disclose missing credentials, timeouts, stale data, and methodology conflicts, then continue using available files and sources.

## Research-Only Boundary

AnalystAgent is built for research, not trade execution.

It can help with:

- research plans;
- fact collection;
- financial and valuation assumptions;
- bull/bear or scenario analysis;
- risk and evidence review;
- report drafting;
- local knowledge-base search.

It must not provide or implement:

- order placement;
- buy/sell execution instructions;
- exact position sizing;
- leverage, margin, or custody flows;
- stop-loss or take-profit instructions;
- exchange/broker integration for trading execution.

## Workspace Layout

Finance workspaces use this default research structure:

```text
companies/
industries/
reports/
knowledge/
templates/
```

Default templates include company deep research, earnings review, event impact, and industry scan. The knowledge base can start as local optimized search and later evolve into RAG as the document set grows.

See [Finance Analyst Workspace](docs/finance-analyst-workspace.md) for the current workspace structure, seeded templates, tool contracts, evidence ledger, data-provider behavior, and research-only policy.

## Installation

Install dependencies from the monorepo root:

```bash
bun install
```

Start the Electron app in development mode:

```bash
bun run electron:dev
```

Build and start the Electron app:

```bash
bun run electron:start
```

## Development

Common checks:

```bash
bun run typecheck:shared
bun run typecheck:electron
bun run typecheck:all
```

Focused session-tool tests:

```bash
bun test packages/session-tools-core/src/handlers/research-workflow.test.ts
bun test packages/session-tools-core/src/handlers/finance-market-data.test.ts
bun test packages/session-tools-core/src/handlers/knowledge-search.test.ts
```

Renderer build check:

```bash
bun run electron:build:renderer
```

On Windows PowerShell, prefer `bun` directly. Some older root scripts still assume POSIX shell behavior; use narrower package-level commands when a broad script fails because of shell syntax.

## Key Packages

| Path | Purpose |
| --- | --- |
| `apps/electron/` | Desktop app, main process, preload, and React renderer |
| `packages/session-tools-core/` | Canonical session-scoped tool schemas, handlers, analyst roles, and finance research tools |
| `packages/shared/` | Shared agent, config, credentials, sources, sessions, workspaces, and protocol logic |
| `packages/server-core/` | Headless server runtime, RPC handlers, sessions, and workspace services |
| `packages/session-mcp-server/` | Stdio MCP wrapper for session tools |
| `packages/ui/` | Shared UI components |

## Credentials And Data Safety

- Do not commit `.env` files, LLM keys, OAuth secrets, iFinD tokens, Wind credentials, Tushare tokens, or local research materials.
- Keep credentials in the app credential store, environment variables, or workspace source configuration.
- Use `IFIND_MCP_AUTH_TOKEN` only for the user's own iFinD MCP access.
- Keep writes contained inside the configured workspace or research directory.
- Review evidence ledgers, absolute paths, screenshots, and quoted source material before sharing reports externally.

## License

Apache 2.0. See [LICENSE](LICENSE).
