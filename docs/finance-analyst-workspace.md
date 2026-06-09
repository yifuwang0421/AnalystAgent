# Finance Analyst Workspace

AnalystAgent uses a finance analyst workspace to keep investment research organized, auditable, and separate from trading execution. The workspace combines local research folders, structured templates, analyst skills, knowledge search, and read-only market data tools.

This document explains the current implementation. It is a reference for developers and operators who need to understand what the finance workspace creates and how the research tools use it.

## Research Boundary

AnalystAgent is research-first. It can help you plan research, collect facts, compare assumptions, review risks, and draft evidence-backed reports.

It must not provide or implement:

- order placement;
- buy or sell execution instructions;
- exact position sizing;
- leverage, margin, custody, or broker workflows;
- stop-loss or take-profit instructions.

When a research output discusses scenarios or risks, it should label facts, calculations, assumptions, inferences, warnings, and open verification items.

## Workspace Structure

The finance workspace is created by `packages/shared/src/workspaces/finance.ts`. When finance mode is enabled, `ensureFinanceResearchWorkspace` creates these top-level folders:

```text
companies/
industries/
reports/
knowledge/
templates/
```

The top-level folders are the controlled research area. File creation, deletion, and Markdown writes should stay inside the configured workspace or finance research directory.

## Default Templates

The workspace seeds four Markdown templates under `templates/`:

| Template | Use it for |
| --- | --- |
| `company-deep-research.md` | Company-level research with business model, financials, valuation assumptions, bull and bear cases, risks, and evidence ledger |
| `earnings-review.md` | Earnings releases, financial reports, announcement reviews, period comparisons, guidance, and cash-flow quality |
| `event-impact.md` | Company, industry, policy, announcement, or news events with direct impact, second-order impact, and open verification items |
| `industry-scan.md` | Industry value chain, supply and demand, cycle position, competition, representative companies, catalysts, and risks |

Each template includes an evidence ledger table. Material claims should cite finance data, a local knowledge file, a user document, a web source, or an explicit inference.

## Seeded Skills

The finance workspace also seeds lightweight skills under `skills/`:

- `company-deep-research`
- `earnings-review`
- `event-impact`
- `industry-scan`

These skills steer agents toward the same research contract: start with a workflow plan, search local knowledge before drafting, use finance market data when a ticker or instrument is available, and keep outputs in research language.

## Research Tools

The finance workflow centers on these session tools:

| Tool | Current role |
| --- | --- |
| `research_workflow` | Read-only planning. It classifies the research task, checks required inputs, returns role task cards, and asks for concise HITL clarification when target, event date, or earnings period is missing. |
| `analyst_orchestrate` | Execution entrypoint for substantial research. It selects the relevant subset of analyst roles and dispatches real subagent sessions through the session spawn bridge. |
| `analyst_validate_workflow` | Reads the controlled workflow manifest and checks completion, output files, evidence ledger fields, provider warnings, and quality flags. |
| `knowledge_search` | Searches the finance research folders for local evidence and returns file paths that can be cited in the evidence ledger. |
| `finance_market_data` | Routes read-only market data requests through configured providers and returns normalized data, source citations, and warnings. |

Use `research_workflow` when the user only needs a plan. Use `analyst_orchestrate` when the request is substantial enough to delegate to specialist analyst roles.

## Analyst Roles

The V1 analyst architecture uses a fixed role set:

- Industry Analyst
- Fundamental Analyst
- Forecast & Valuation Analyst
- Report Writer
- Technical Analyst
- Risk Control Analyst

The Research Manager does not have to dispatch every role. For each request, it should select the subset that matches the task, then evaluate returned deliverables before final synthesis.

Each subagent deliverable should include:

- facts;
- calculations;
- assumptions;
- inferences;
- evidence ledger;
- warnings;
- final view;
- handoff to the main agent.

## Data Providers

The market data router supports configured iFinD MCP access and optional Python-backed providers such as `tushare`, `akshare`, `yfinance`, `edgartools`, and `baostock`.

Provider failures are non-fatal. If a token is missing, a Python package is unavailable, or a provider times out, the tool returns warnings and the agent should continue with local knowledge, uploaded files, and user-provided evidence.

The iFinD token must come from the user's own `IFIND_MCP_AUTH_TOKEN`. Do not commit tokens, API keys, workspace credentials, local research materials, or `.env` files.

## Knowledge Search

`knowledge_search` searches the configured finance research directory, including:

- `knowledge/`
- `companies/`
- `industries/`
- `reports/`

Search results should cite local file paths. The current implementation is local-file search; future RAG can replace the backend without changing the evidence contract.

## Evidence Ledger

Use the evidence ledger to make research auditable. Each material row should include:

| Field | Meaning |
| --- | --- |
| Claim | The statement or calculation being supported |
| Source type | Finance data, knowledge file, user document, web source, or inference |
| Source | Provider name, file path, URL, or document reference |
| Data date | The as-of date for market or financial data |
| Inference | Whether the claim is derived rather than directly observed |
| Confidence | A calibrated confidence level with warnings when evidence is weak |

The Research Manager should downgrade confidence, request revisions, or list an open verification item when evidence is incomplete.

## Related Files

- `packages/shared/src/workspaces/finance.ts`
- `packages/session-tools-core/src/handlers/research-workflow.ts`
- `packages/session-tools-core/src/handlers/finance-market-data.ts`
- `packages/session-tools-core/src/handlers/knowledge-search.ts`
- `apps/electron/src/renderer/pages/settings/WorkspaceSettingsPage.tsx`
