import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import {
  ANALYST_MANAGER_PROMPT,
  ANALYST_SUBAGENT_ROLES,
  SUBAGENT_DELIVERABLE_CONTRACT,
  buildAnalystRolePrompt,
} from '../analyst-roles.ts';
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
    'enabled MCP sources: iFinD, Wind, Eastmoney Miaoxiang, or other configured finance MCP servers',
    'enabled API sources: tushare, akshare, yfinance, edgartools, baostock, or configured custom APIs',
    'web search/source tools: recent public news, filings, policy, and event context when available',
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

function dataLayerSummary(taskType: Exclude<ResearchTaskType, 'auto'>, marketScope: ResearchWorkflowArgs['marketScope']) {
  return {
    mode: 'unified_router_v1',
    marketScope: marketScope ?? 'cn-hk',
    sources: [
      {
        layer: 'mcp_or_skill_sources',
        examples: ['eastmoney-miaoxiang', 'ifind', 'wind'],
        access: 'Use enabled workspace Sources/MCP tools or finance_market_data provider routing. Credentials must stay in source credentials or environment variables.',
      },
      {
        layer: 'api_providers',
        examples: ['tushare', 'akshare', 'yfinance', 'edgartools', 'baostock'],
        access: 'Use finance_market_data first so provider warnings and citations are normalized.',
      },
      {
        layer: 'knowledge_base',
        examples: ['knowledge/', 'companies/', 'industries/', 'reports/'],
        access: 'Use knowledge_search before drafting. V1 uses local optimized search; future RAG can replace this behind the same contract.',
      },
      {
        layer: 'web_search',
        examples: ['public news', 'filings', 'policy releases', 'company websites'],
        access: 'Use enabled web/search source tools when current information is needed. Cite URL/source and search date.',
      },
    ],
    requiredRequests: dataRequests(taskType),
  };
}

function workflowSteps(taskType: Exclude<ResearchTaskType, 'auto'>, depth: ResearchWorkflowArgs['depth']) {
  const steps = [
    { id: 'manager_triage', status: 'planned', owner: 'Analyst Agent / Research Manager', goal: `Classify request as ${TASK_LABELS[taskType]}, lock assumptions, and decide whether HITL clarification is needed.` },
    { id: 'subagent_dispatch', status: 'planned', owner: 'Analyst Agent / Research Manager', goal: 'Create six fixed subagent task cards and spawn real independent sessions by default.' },
    { id: 'subagent_execution', status: 'planned', owner: 'Six Analyst Subagents', goal: 'Each subagent gathers evidence through the unified data router and returns the standard deliverable contract.' },
    { id: 'quality_gate', status: 'planned', owner: 'Analyst Agent / Research Manager', goal: 'Evaluate evidence, provider warnings, missing citations, stale data, and trading-language violations.' },
    { id: 'revision_loop', status: 'planned', owner: 'Analyst Agent / Research Manager', goal: 'Use send_agent_message to request补证, correction, or confidence downgrades when a subagent output fails the quality gate.' },
    { id: 'manager_synthesis', status: 'planned', owner: 'Analyst Agent / Research Manager', goal: 'Produce the final research deliverable with conclusions, disagreements, risks, open questions, and evidence ledger.' },
  ];
  if (depth === 'quick') return steps.filter(step => step.id !== 'revision_loop');
  return steps;
}

function buildSubAgentTaskCards(args: {
  taskType: Exclude<ResearchTaskType, 'auto'>;
  target: string;
  marketScope: 'cn-hk' | 'us' | 'global';
  asOfDate: string;
  depth: NonNullable<ResearchWorkflowArgs['depth']>;
  outputLanguage: NonNullable<ResearchWorkflowArgs['outputLanguage']>;
}) {
  return ANALYST_SUBAGENT_ROLES.map((role, index) => {
    const prompt = [
      buildAnalystRolePrompt(role),
      '',
      '本次任务：',
      `- taskType: ${args.taskType}`,
      `- target: ${args.target}`,
      `- marketScope: ${args.marketScope}`,
      `- asOfDate: ${args.asOfDate}`,
      `- depth: ${args.depth}`,
      `- outputLanguage: ${args.outputLanguage}`,
      '',
      '执行要求：',
      '- 先列出你需要的数据，再调用可用 tools/sources 获取证据。',
      '- 如果 provider 缺失、超时或口径冲突，把它放入 warnings，不要中断研究。',
      '- 完成后按标准交付结构返回，供主 agent 质检和汇总。',
    ].join('\n');

    return {
      id: role.id,
      role: role.title,
      roleZh: role.titleZh,
      sequence: index + 1,
      status: 'planned',
      spawnPolicy: 'spawn_session_by_default',
      recommendedSessionName: `${role.titleZh} - ${args.target}`,
      labels: ['analyst-subagent', role.id, args.taskType],
      dataNeeds: role.dataNeeds,
      deliverableContract: SUBAGENT_DELIVERABLE_CONTRACT,
      prompt,
    };
  });
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
  const outputLanguage = args.outputLanguage ?? 'zh-Hans';
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
      outputLanguage,
      mode: missingInputs.length > 0 ? 'hitl_clarification_required' : 'ready_to_execute',
      tradingPolicy: 'Research only. Do not place trades, connect exchanges, or give direct buy/sell instructions.',
      architecture: 'main_agent_plus_six_fixed_subagents',
    },
    missingInputs,
    manager: {
      id: 'research-manager',
      role: 'Analyst Agent / Research Manager',
      prompt: ANALYST_MANAGER_PROMPT,
      responsibilities: [
        'break down the task',
        'spawn six real independent subagent sessions by default',
        'evaluate subagent deliverables against the quality rubric',
        'request补证 or corrections when deliverables are not acceptable',
        'synthesize the final research deliverable',
      ],
    },
    plan: workflowSteps(taskType, depth),
    dataLayer: dataLayerSummary(taskType, marketScope),
    requiredTools: dataRequests(taskType),
    subAgents: buildSubAgentTaskCards({ taskType, target, marketScope, asOfDate, depth, outputLanguage }),
    qualityGate: {
      passCriteria: [
        'Each material claim has an evidenceLedger entry or is explicitly marked as inference.',
        'Provider warnings and missing data are disclosed instead of hidden.',
        'Facts, calculations, assumptions, and inferences are separated.',
        'No direct buy/sell/order/position/leverage/stop-loss/take-profit language appears.',
        'Stale data, conflicting口径, and weak evidence are flagged for revision or confidence downgrade.',
      ],
      revisionAction: 'Use send_agent_message to request missing evidence, correction, or confidence downgrade before final synthesis.',
    },
    deliverableContract: SUBAGENT_DELIVERABLE_CONTRACT,
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
