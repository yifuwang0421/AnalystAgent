import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { successResponse } from '../response.ts';
import type { ToolResult } from '../types.ts';

export type ResearchTaskType =
  | 'auto'
  | 'company_deep_research'
  | 'earnings_review'
  | 'event_impact'
  | 'industry_scan';

export interface ResearchWorkflowArgs {
  taskType?: ResearchTaskType;
  target?: string;
  marketScope?: 'cn-hk' | 'us' | 'global';
  asOfDate?: string;
  depth?: 'quick' | 'standard' | 'deep';
  outputLanguage?: 'zh-Hans' | 'en';
  writeReport?: boolean;
}

export interface EvidenceLedgerEntry {
  claim: string;
  sourceType?: 'finance_data_provider' | 'knowledge_base_file' | 'user_document' | 'explicit_inference';
  source?: string;
  dataAsOf?: string;
  isInference?: boolean;
}

const TASK_LABELS: Record<Exclude<ResearchTaskType, 'auto'>, string> = {
  company_deep_research: 'Company Deep Research',
  earnings_review: 'Earnings Review',
  event_impact: 'Event Impact',
  industry_scan: 'Industry Scan',
};

const ROLE_PROMPTS = {
  fundamental: 'Fundamental Analyst: study business model, financial quality, valuation assumptions, and comparable context. Use evidence, not trading instructions.',
  market: 'Market & Technical Analyst: summarize price behavior, liquidity, volatility, and technical backdrop as research context only.',
  news: 'News/Event Analyst: collect recent news, announcements, filings, and event timeline. Separate confirmed facts from inference.',
  bull: 'Bull Reviewer: produce the strongest evidence-backed positive case and list what must be true.',
  bear: 'Bear/Risk Reviewer: produce the strongest evidence-backed negative case, risks, and disconfirming evidence.',
  manager: 'Research Manager: synthesize evidence into research view, confidence, open questions, and source citations. Do not give buy/sell instructions.',
};

function readFinanceConfig(workspacePath: string) {
  try {
    const config = JSON.parse(readFileSync(join(workspacePath, 'config.json'), 'utf-8')) as {
      finance?: { researchDirectory?: string; marketScope?: 'cn-hk' | 'us' | 'global' };
    };
    return config.finance ?? {};
  } catch {
    return {};
  }
}

function inferTaskType(args: ResearchWorkflowArgs): Exclude<ResearchTaskType, 'auto'> {
  if (args.taskType && args.taskType !== 'auto') return args.taskType;
  const target = (args.target ?? '').toLowerCase();
  if (target.includes('财报') || target.includes('earnings') || target.includes('业绩')) return 'earnings_review';
  if (target.includes('行业') || target.includes('industry') || target.includes('赛道')) return 'industry_scan';
  if (target.includes('事件') || target.includes('event') || target.includes('公告') || target.includes('news')) return 'event_impact';
  return 'company_deep_research';
}

function normalizeAsOfDate(value?: string): string {
  if (value?.trim()) return value.trim();
  return new Date().toISOString().slice(0, 10);
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function reportDirectory(workspacePath: string, taskType: Exclude<ResearchTaskType, 'auto'>, target: string): string {
  const finance = readFinanceConfig(workspacePath);
  const root = resolve(finance.researchDirectory || workspacePath);
  const cleaned = target
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'untitled';
  const candidate = taskType === 'industry_scan'
    ? join(root, 'industries', cleaned)
    : join(root, 'companies', cleaned);
  const normalized = normalize(candidate);
  return isInside(root, normalized) ? normalized : join(root, 'reports');
}

function requiredInputs(taskType: Exclude<ResearchTaskType, 'auto'>, args: ResearchWorkflowArgs): string[] {
  const missing: string[] = [];
  if (!args.target?.trim()) {
    missing.push('target: company, ticker, industry, event, or uploaded filing/report reference');
  }
  if (taskType === 'earnings_review' && !args.target?.match(/\d{4}|Q[1-4]|财报|业绩|earnings/i)) {
    missing.push('earnings period or specific filing/report reference');
  }
  if (taskType === 'event_impact' && !args.asOfDate) {
    missing.push('asOfDate: event analysis needs a concrete date boundary');
  }
  return missing;
}

function dataRequests(taskType: Exclude<ResearchTaskType, 'auto'>) {
  const common = [
    'knowledge_search: target, aliases, industry keywords, prior reports',
    'finance_market_data: search_instruments',
    'finance_market_data: get_quote',
    'finance_market_data: get_news or get_announcements',
  ];
  if (taskType === 'company_deep_research') {
    return [
      ...common,
      'finance_market_data: get_financial_summary',
      'finance_market_data: get_valuation_metrics',
      'finance_market_data: get_historical_prices',
    ];
  }
  if (taskType === 'earnings_review') {
    return [
      ...common,
      'finance_market_data: get_financial_statements',
      'finance_market_data: get_valuation_metrics',
    ];
  }
  if (taskType === 'event_impact') {
    return [
      ...common,
      'finance_market_data: get_historical_prices around event window',
      'finance_market_data: get_technical_indicators',
    ];
  }
  return [
    ...common,
    'finance_market_data: get_macro_data',
    'finance_market_data: get_valuation_metrics for representative companies',
  ];
}

function workflowSteps(taskType: Exclude<ResearchTaskType, 'auto'>, depth: ResearchWorkflowArgs['depth']) {
  const steps = [
    { id: 'super_triage', status: 'planned', owner: 'Research Manager', goal: `Classify request as ${TASK_LABELS[taskType]} and lock assumptions.` },
    { id: 'research_plan', status: 'planned', owner: 'Research Planner', goal: 'Define evidence needs, missing inputs, provider route, and report outline.' },
    { id: 'evidence_gathering', status: 'planned', owner: 'Fundamental/Market/News Analysts', goal: 'Collect knowledge-base, finance data, filings, news, and user document evidence.' },
    { id: 'bull_bear_review', status: 'planned', owner: 'Bull Reviewer + Bear/Risk Reviewer', goal: 'Build positive and negative cases from evidence.' },
    { id: 'risk_verifier', status: 'planned', owner: 'Risk/Verifier', goal: 'Flag stale data, uncited claims, unsupported calculations, and trading-language violations.' },
    { id: 'manager_synthesis', status: 'planned', owner: 'Research Manager', goal: 'Produce cited research view, confidence level, risks, open questions, and evidence ledger.' },
  ];
  if (depth === 'quick') return steps.filter(step => step.id !== 'bull_bear_review');
  return steps;
}

export function validateEvidenceLedger(entries: EvidenceLedgerEntry[]): string[] {
  const warnings: string[] = [];
  entries.forEach((entry, index) => {
    if (!entry.claim?.trim()) warnings.push(`entry ${index + 1}: missing claim`);
    if (!entry.sourceType) warnings.push(`entry ${index + 1}: missing sourceType`);
    if (entry.sourceType !== 'explicit_inference' && !entry.source?.trim()) {
      warnings.push(`entry ${index + 1}: non-inference claim needs a source`);
    }
    if (entry.sourceType === 'finance_data_provider' && !entry.dataAsOf) {
      warnings.push(`entry ${index + 1}: finance data needs dataAsOf`);
    }
  });
  return warnings;
}

export async function handleResearchWorkflow(
  ctx: SessionToolContext,
  args: ResearchWorkflowArgs
): Promise<ToolResult> {
  const taskType = inferTaskType(args);
  const finance = readFinanceConfig(ctx.workspacePath);
  const marketScope = args.marketScope ?? finance.marketScope ?? 'cn-hk';
  const depth = args.depth ?? 'standard';
  const asOfDate = normalizeAsOfDate(args.asOfDate);
  const target = args.target?.trim() ?? '';
  const missingInputs = requiredInputs(taskType, args);
  const shouldWrite = args.writeReport === true;
  const reportPath = shouldWrite && target
    ? join(reportDirectory(ctx.workspacePath, taskType, target), `${taskType}-${asOfDate}.md`)
    : null;

  const response = {
    workflow: {
      name: TASK_LABELS[taskType],
      taskType,
      target: target || null,
      marketScope,
      asOfDate,
      depth,
      outputLanguage: args.outputLanguage ?? 'zh-Hans',
      mode: missingInputs.length > 0 ? 'hitl_clarification_required' : 'ready_to_execute',
      tradingPolicy: 'Research only. Do not place trades, connect exchanges, or give direct buy/sell instructions.',
    },
    missingInputs,
    plan: workflowSteps(taskType, depth),
    requiredTools: dataRequests(taskType),
    subAgents: [
      { role: 'Fundamental Analyst', prompt: ROLE_PROMPTS.fundamental },
      { role: 'Market & Technical Analyst', prompt: ROLE_PROMPTS.market },
      { role: 'News/Event Analyst', prompt: ROLE_PROMPTS.news },
      { role: 'Bull Reviewer', prompt: ROLE_PROMPTS.bull },
      { role: 'Bear/Risk Reviewer', prompt: ROLE_PROMPTS.bear },
      { role: 'Research Manager', prompt: ROLE_PROMPTS.manager },
    ],
    evidenceLedgerTemplate: [
      {
        claim: '<material conclusion>',
        sourceType: 'finance_data_provider | knowledge_base_file | user_document | explicit_inference',
        source: '<provider/tool/file path/user document>',
        dataAsOf: '<YYYY-MM-DD or provider timestamp>',
        isInference: false,
        confidence: 'low | medium | high',
      },
    ],
    reportWritePlan: reportPath ? {
      reportPath,
      containment: 'inside finance research directory',
      permissionReminder: 'Writing requires current session permission mode to allow edits.',
    } : null,
  };

  return successResponse(JSON.stringify(response, null, 2));
}
