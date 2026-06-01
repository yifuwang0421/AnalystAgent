import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { isAbsolute, join, normalize, relative, resolve } from 'path';
import type { FinanceWorkspaceConfig, WorkspaceConfig } from './types.ts';

export const FINANCE_RESEARCH_DIRS = [
  'companies',
  'industries',
  'reports',
  'knowledge',
  'templates',
] as const;

const DEFAULT_COMPANY_DEEP_RESEARCH_TEMPLATE = `# Company Deep Research Template

## Core View
-

## Research Question And Boundaries
- Target:
- As-of date:
- This is not a trading recommendation:

## Key Data
- Market and valuation:
- Financial summary:
- Operating metrics:

## Business Model And Competition
-

## Financial Performance
- Revenue:
- Profit:
- Cash flow:
- Balance sheet:

## Valuation And Assumptions
-

## Bull Case
-

## Bear Case / Risks
-

## Open Questions
-

## Evidence Ledger
| Claim | Source Type | Source | Data Date | Inference | Confidence |
|---|---|---|---|---|---|
|  |  |  |  |  |  |
`;

const DEFAULT_EARNINGS_REVIEW_TEMPLATE = `# Earnings Review Template

## Core View
-

## Results Overview
- Revenue:
- Profit:
- Gross margin / expense ratio:
- Cash flow:

## Beats / Misses
-

## Drivers
-

## Management Guidance And Announcement Highlights
-

## Market Focus
-

## Risks
-

## Evidence Ledger
| Claim | Source Type | Source | Data Date | Inference | Confidence |
|---|---|---|---|---|---|
|  |  |  |  |  |  |
`;

const DEFAULT_EVENT_IMPACT_TEMPLATE = `# Event Impact Analysis Template

## Event Summary
- Event:
- Date:
- Target:

## Direct Impact
-

## Second-Order Impact
-

## Historical And Comparable Cases
-

## Price / Valuation / Fundamental Response
-

## Bull / Bear Split
- Bull:
- Bear:

## Key Risks And Open Questions
-

## Evidence Ledger
| Claim | Source Type | Source | Data Date | Inference | Confidence |
|---|---|---|---|---|---|
|  |  |  |  |  |  |
`;

const DEFAULT_INDUSTRY_SCAN_TEMPLATE = `# Industry Scan Template

## Core View
-

## Industry Scope And Value Chain
-

## Demand, Supply, And Cycle Position
-

## Competitive Landscape
-

## Representative Companies And Valuation Comparison
-

## Catalysts
-

## Risks And Disconfirming Evidence
-

## Evidence Ledger
| Claim | Source Type | Source | Data Date | Inference | Confidence |
|---|---|---|---|---|---|
|  |  |  |  |  |  |
`;

const COMPANY_DEEP_RESEARCH_SKILL = `---
name: company-deep-research
description: Build a structured company research draft for A-share, HK, or US-listed companies with evidence, assumptions, risks, and an evidence ledger.
---

When the user asks for company research:
1. Call \`research_workflow\` first with taskType \`company_deep_research\` or \`auto\`.
2. Search \`knowledge_search\` before drafting, then use \`finance_market_data\` for instrument search, quote, historical prices, financial summary, valuation metrics, news, and announcements.
3. Use \`spawn_session\` only for research roles such as Fundamental Analyst, Market & Technical Analyst, News/Event Analyst, Bull Reviewer, Bear/Risk Reviewer, and Research Manager.
4. Output core view, key data, business model, financial performance, competition, valuation assumptions, Bull/Bear review, risks, open questions, and evidence ledger.
5. Cite each material judgment as finance data, knowledge-base file, user document, or explicit inference.
6. Do not provide direct buy, sell, add, reduce, position sizing, leverage, order, or exchange execution instructions.
`;

const EARNINGS_REVIEW_SKILL = `---
name: earnings-review
description: Review earnings releases, financial reports, or announcements with facts, period comparison, guidance, risks, and an evidence ledger.
---

When the user asks for an earnings review:
1. Call \`research_workflow\` first with taskType \`earnings_review\`.
2. Read user-provided reports, announcements, or tables first, then search \`knowledge_search\` for prior research and industry context.
3. If a ticker is available, use \`finance_market_data\` for quote, financial summary, statements, valuation metrics, announcements, and news.
4. Clearly separate disclosed facts, calculations, management statements, and inference.
5. Output core view, results overview, beats/misses, drivers, cash-flow quality, guidance, market focus, risks, and evidence ledger.
6. Do not provide direct trading recommendations.
`;

const EVENT_IMPACT_SKILL = `---
name: event-impact-analysis
description: Analyze how announcements, policy, news, or events affect a company or industry with clear timing, transmission path, and disconfirming evidence.
---

When the user asks for event impact analysis:
1. Call \`research_workflow\` first with taskType \`event_impact\` and confirm asOfDate.
2. Collect announcements, news, historical prices, comparable cases, and knowledge-base files.
3. Separate direct impact, second-order impact, market expectation changes, and open verification items.
4. Output Bull/Bear split, key risks, evidence ledger, and information gaps.
5. Do not provide order, stop-loss, take-profit, position, or execution advice.
`;

const INDUSTRY_SCAN_SKILL = `---
name: industry-scan
description: Scan industry demand, supply, cycle, competition, representative companies, valuation, and catalysts into a structured research view.
---

When the user asks for industry analysis:
1. Call \`research_workflow\` first with taskType \`industry_scan\`.
2. Search knowledge-base industry files, representative company research, macro data, and news.
3. Use \`finance_market_data\` for macro indicators, representative company quotes, valuation, and financial summaries.
4. Output industry scope, value chain, supply/demand, competition, representative companies, valuation comparison, catalysts, risks, and evidence ledger.
5. Keep research language and do not output trading instructions.
`;

export function getDefaultFinanceWorkspaceConfig(rootPath: string): FinanceWorkspaceConfig {
  return {
    enabled: true,
    researchDirectory: rootPath,
    marketScope: 'cn-hk',
    dataProvider: 'ifind',
    knowledgeBaseEnabled: true,
  };
}

function writeIfMissing(path: string, content: string): void {
  if (!existsSync(path)) {
    writeFileSync(path, content, 'utf-8');
  }
}

function ensureSkill(rootPath: string, slug: string, content: string): void {
  const skillDir = join(rootPath, 'skills', slug);
  mkdirSync(skillDir, { recursive: true });
  writeIfMissing(join(skillDir, 'SKILL.md'), content);
}

export function ensureFinanceResearchWorkspace(rootPath: string): void {
  for (const dir of FINANCE_RESEARCH_DIRS) {
    mkdirSync(join(rootPath, dir), { recursive: true });
  }

  writeIfMissing(join(rootPath, 'templates', 'company-deep-research.md'), DEFAULT_COMPANY_DEEP_RESEARCH_TEMPLATE);
  writeIfMissing(join(rootPath, 'templates', 'earnings-review.md'), DEFAULT_EARNINGS_REVIEW_TEMPLATE);
  writeIfMissing(join(rootPath, 'templates', 'event-impact.md'), DEFAULT_EVENT_IMPACT_TEMPLATE);
  writeIfMissing(join(rootPath, 'templates', 'industry-scan.md'), DEFAULT_INDUSTRY_SCAN_TEMPLATE);
  writeIfMissing(join(rootPath, 'knowledge', 'README.md'), `# Knowledge Base

Place research reports, earnings excerpts, announcements, industry materials, meeting notes, or Markdown/CSV documents here. The agent should search these files with \`knowledge_search\` before drafting research and cite file paths in outputs.
`);

  ensureSkill(rootPath, 'company-deep-research', COMPANY_DEEP_RESEARCH_SKILL);
  ensureSkill(rootPath, 'earnings-review', EARNINGS_REVIEW_SKILL);
  ensureSkill(rootPath, 'event-impact', EVENT_IMPACT_SKILL);
  ensureSkill(rootPath, 'industry-scan', INDUSTRY_SCAN_SKILL);
}

export function normalizeFinanceWorkspaceConfig(
  rootPath: string,
  config?: FinanceWorkspaceConfig
): FinanceWorkspaceConfig {
  return {
    ...getDefaultFinanceWorkspaceConfig(rootPath),
    ...config,
    researchDirectory: config?.researchDirectory || rootPath,
  };
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

export function ensureFinanceWorkspaceConfig(rootPath: string, config: WorkspaceConfig): boolean {
  const normalized = normalizeFinanceWorkspaceConfig(rootPath, config.finance);
  const researchDirectory = normalize(resolve(normalized.researchDirectory));
  const root = normalize(resolve(rootPath));

  normalized.researchDirectory = isInside(root, researchDirectory)
    ? researchDirectory
    : root;

  const changed = JSON.stringify(config.finance) !== JSON.stringify(normalized);
  config.finance = normalized;
  ensureFinanceResearchWorkspace(normalized.researchDirectory);
  return changed;
}
