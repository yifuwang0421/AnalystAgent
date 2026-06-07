import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import {
  ANALYST_MANAGER_PROMPT,
  ANALYST_SUBAGENT_ROLES,
  SUBAGENT_DELIVERABLE_CONTRACT,
  type AnalystSubAgentId,
  buildAnalystRolePrompt,
} from '../analyst-roles.ts';
import type { SessionToolContext } from '../context.ts';
import { errorResponse, successResponse } from '../response.ts';
import type { ToolResult } from '../types.ts';

export type ResearchTaskType =
  | 'auto'
  | 'company_deep_research'
  | 'earnings_review'
  | 'event_impact'
  | 'industry_scan';

export interface ResearchWorkflowArgs {
  request?: string;
  taskType?: ResearchTaskType;
  target?: string;
  marketScope?: 'cn-hk' | 'us' | 'global';
  asOfDate?: string;
  depth?: 'quick' | 'standard' | 'deep';
  outputLanguage?: 'zh-Hans' | 'en';
  writeReport?: boolean;
}

export interface AnalystOrchestrateArgs extends ResearchWorkflowArgs {
  maxRevisionRounds?: number;
  selectedSubAgentIds?: AnalystSubAgentId[];
}

export interface AnalystValidateWorkflowArgs {
  workflowId?: string;
  manifestPath?: string;
}

export interface EvidenceLedgerEntry {
  claim: string;
  sourceType?: 'finance_data_provider' | 'knowledge_base_file' | 'user_document' | 'explicit_inference';
  source?: string;
  dataAsOf?: string;
  isInference?: boolean;
  confidence?: string | number;
}

export type AnalystDispatchMode = 'parallel' | 'chain' | 'single';
export type AnalystTaskStatus = 'planned' | 'started' | 'completed' | 'failed' | 'waived';
export type AnalystQualityFlag =
  | 'DEGRADED'
  | 'MISSING_EVIDENCE'
  | 'PROVIDER_WARNING'
  | 'PARTIAL_DELIVERABLE';

export interface AnalystTaskResult {
  roleId: AnalystSubAgentId;
  role: string;
  roleZh: string;
  status: AnalystTaskStatus;
  sessionId: string | null;
  durationMs: number;
  files: string[];
  textTail: string;
  toolCalls?: number;
  score?: number | null;
  reworkCount: number;
  warnings: string[];
  error?: string;
  evidenceLedger?: EvidenceLedgerEntry[];
}

export interface AnalystWorkflowPhase {
  phase: number;
  mode: AnalystDispatchMode;
  roleIds: AnalystSubAgentId[];
  status: 'planned' | 'started' | 'completed' | 'failed';
  results: AnalystTaskResult[];
}

export interface AnalystWorkflowRun {
  workflowId: string;
  parentSessionId: string;
  intent: {
    taskType: string;
    target: string | null;
    marketScope: string;
    asOfDate: string;
    depth: string;
    outputLanguage: string;
  };
  phases: AnalystWorkflowPhase[];
  results: AnalystTaskResult[];
  outputs: Record<string, string | null>;
  qualityFlags: AnalystQualityFlag[];
  status: 'dispatched' | 'partially_dispatched' | 'needs_user_clarification' | 'failed';
  manifestPath: string;
  createdAt: string;
  completedAt: string | null;
}

const TASK_LABELS: Record<Exclude<ResearchTaskType, 'auto'>, string> = {
  company_deep_research: 'Company Deep Research',
  earnings_review: 'Earnings Review',
  event_impact: 'Event Impact',
  industry_scan: 'Industry Scan',
};

const ROLE_RUNTIME_SPECS: Record<AnalystSubAgentId, {
  deliverables: string[];
  dependsOn: AnalystSubAgentId[];
  recommendedTools: string[];
}> = {
  'industry-analyst': {
    deliverables: ['industry.md', 'industry_data.json'],
    dependsOn: [],
    recommendedTools: ['knowledge_search', 'finance_market_data', 'web/source tools'],
  },
  'fundamental-analyst': {
    deliverables: ['fundamental.md', 'financials.json'],
    dependsOn: [],
    recommendedTools: ['knowledge_search', 'finance_market_data', 'announcements/source tools'],
  },
  'technical-analyst': {
    deliverables: ['technical.md', 'indicators.json'],
    dependsOn: [],
    recommendedTools: ['finance_market_data', 'web/source tools'],
  },
  'forecast-valuation-analyst': {
    deliverables: ['valuation.md', 'valuation_inputs.json'],
    dependsOn: ['industry-analyst', 'fundamental-analyst'],
    recommendedTools: ['finance_market_data', 'knowledge_search'],
  },
  'risk-control-analyst': {
    deliverables: ['risk.md', 'risk_metrics.json'],
    dependsOn: ['forecast-valuation-analyst', 'technical-analyst'],
    recommendedTools: ['finance_market_data', 'knowledge_search'],
  },
  'report-writer': {
    deliverables: ['report.md', 'deliverable_manifest.json'],
    dependsOn: [
      'industry-analyst',
      'fundamental-analyst',
      'forecast-valuation-analyst',
      'technical-analyst',
      'risk-control-analyst',
    ],
    recommendedTools: ['knowledge_search', 'read/write workspace files'],
  },
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

function financeResearchRoot(workspacePath: string): string {
  const finance = readFinanceConfig(workspacePath);
  const configured = finance.researchDirectory?.trim();
  if (!configured) return resolve(workspacePath);
  return isAbsolute(configured) ? resolve(configured) : resolve(workspacePath, configured);
}

function inferTaskType(args: ResearchWorkflowArgs): Exclude<ResearchTaskType, 'auto'> {
  if (args.taskType && args.taskType !== 'auto') return args.taskType;
  const target = (args.target ?? args.request ?? '').toLowerCase();
  if (target.includes('财报') || target.includes('earnings') || target.includes('业绩')) return 'earnings_review';
  if (target.includes('行业') || target.includes('industry') || target.includes('赛道')) return 'industry_scan';
  if (target.includes('事件') || target.includes('event') || target.includes('公告') || target.includes('news')) return 'event_impact';
  return 'company_deep_research';
}

function normalizeAsOfDate(value?: string): string {
  if (value?.trim()) return value.trim();
  return new Date().toISOString().slice(0, 10);
}

function inferTargetFromRequest(request?: string): string {
  const text = request?.trim() ?? '';
  if (!text) return '';

  const parenTicker = text.match(/([\u4e00-\u9fffA-Za-z0-9 .&-]{1,40})\s*[（(]\s*([A-Z][A-Z0-9.-]{0,10})\s*[）)]/u);
  if (parenTicker?.[1] && parenTicker[2]) {
    const name = parenTicker[1].trim().replace(/^[对为]\s*/, '');
    return `${name} ${parenTicker[2].trim()}`.trim();
  }

  const cnTarget = text.match(/[对为]\s*([^，,。；;\n]+?)(?:启动|进行|做|开展|分析|研究|deep|research|$)/iu);
  if (cnTarget?.[1]?.trim()) {
    return cnTarget[1].trim();
  }

  const ticker = text.match(/\b[A-Z][A-Z0-9.-]{0,10}\b/);
  if (ticker?.[0]) return ticker[0];

  return text.length <= 80 ? text : '';
}

function normalizedTarget(args: ResearchWorkflowArgs): string {
  return args.target?.trim() || inferTargetFromRequest(args.request);
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function reportDirectory(workspacePath: string, taskType: Exclude<ResearchTaskType, 'auto'>, target: string): string {
  const root = financeResearchRoot(workspacePath);
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
  const target = normalizedTarget(args);
  if (!target) {
    missing.push('target: company, ticker, industry, event, or uploaded filing/report reference');
  }
  if (taskType === 'earnings_review' && !target.match(/\d{4}|Q[1-4]|财报|业绩|earnings/i)) {
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
    { id: 'subagent_dispatch', status: 'planned', owner: 'Analyst Agent / Research Manager', goal: 'Select the most relevant specialist subagents and spawn real independent sessions without asking for a second confirmation.' },
    { id: 'subagent_execution', status: 'planned', owner: 'Selected Analyst Subagents', goal: 'Each selected subagent gathers evidence through the unified data router and returns the standard deliverable contract.' },
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
      spawnPolicy: 'selected_by_research_manager',
      recommendedSessionName: `${role.titleZh} - ${args.target}`,
      labels: ['analyst-subagent', role.id, args.taskType],
      dataNeeds: role.dataNeeds,
      deliverableContract: SUBAGENT_DELIVERABLE_CONTRACT,
      prompt,
    };
  });
}

function hasAnyText(value: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(value));
}

function selectSubAgentTaskCards(
  cards: ReturnType<typeof buildSubAgentTaskCards>,
  args: AnalystOrchestrateArgs,
  workflow: { taskType: string; depth: string; target: string | null }
) {
  const explicit = args.selectedSubAgentIds?.filter((id): id is AnalystSubAgentId =>
    ANALYST_SUBAGENT_ROLES.some(role => role.id === id)
  );
  if (explicit?.length) {
    const explicitSet = new Set(explicit);
    return cards.filter(card => explicitSet.has(card.id as AnalystSubAgentId));
  }

  const requestText = `${args.request ?? ''} ${workflow.target ?? ''}`.toLowerCase();
  const selected = new Set<AnalystSubAgentId>();
  const add = (...ids: AnalystSubAgentId[]) => ids.forEach(id => selected.add(id));

  if (workflow.taskType === 'industry_scan') {
    add('industry-analyst', 'forecast-valuation-analyst', 'risk-control-analyst');
  } else if (workflow.taskType === 'earnings_review') {
    add('fundamental-analyst', 'forecast-valuation-analyst', 'risk-control-analyst');
  } else if (workflow.taskType === 'event_impact') {
    add('industry-analyst', 'fundamental-analyst', 'risk-control-analyst');
  } else {
    add('industry-analyst', 'fundamental-analyst', 'forecast-valuation-analyst', 'risk-control-analyst');
  }

  if (workflow.taskType === 'company_deep_research' && workflow.depth === 'deep') {
    add('technical-analyst');
  }

  if (workflow.depth === 'quick') {
    selected.delete('forecast-valuation-analyst');
  }

  if (workflow.depth === 'deep' || args.writeReport === true || hasAnyText(requestText, [/report|write|报告|研报|汇总/])) {
    selected.add('report-writer');
  }

  if (hasAnyText(requestText, [/technical|price|chart|trend|k.?line|走势|股价|技术|图表|价格/])) {
    selected.add('technical-analyst');
  }

  return cards.filter(card => selected.has(card.id as AnalystSubAgentId));
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
    if (entry.confidence === undefined || entry.confidence === null || String(entry.confidence).trim() === '') {
      warnings.push(`entry ${index + 1}: missing confidence`);
    }
  });
  return warnings;
}

type SubAgentTaskCard = ReturnType<typeof buildSubAgentTaskCards>[number];

function workflowManifestDirectory(workspacePath: string, workflowId: string): string {
  const root = financeResearchRoot(workspacePath);
  const safeWorkflowId = workflowId.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120);
  const candidate = normalize(join(root, 'reports', '.analyst-workflows', safeWorkflowId));
  if (!isInside(root, candidate)) {
    throw new Error('workflow manifest path escaped the finance research directory');
  }
  return candidate;
}

function workflowManifestPath(workspacePath: string, workflowId: string): string {
  return join(workflowManifestDirectory(workspacePath, workflowId), 'manifest.json');
}

function resolveManifestPath(ctx: SessionToolContext, args: AnalystValidateWorkflowArgs): string {
  const root = financeResearchRoot(ctx.workspacePath);
  if (args.workflowId?.trim()) {
    const workflowId = args.workflowId.trim();
    if (!/^[A-Za-z0-9._-]+$/.test(workflowId)) {
      throw new Error('workflowId may only contain letters, numbers, dot, underscore, and dash');
    }
    return workflowManifestPath(ctx.workspacePath, workflowId);
  }
  if (args.manifestPath?.trim()) {
    const rawPath = args.manifestPath.trim();
    const candidate = normalize(isAbsolute(rawPath) ? resolve(rawPath) : resolve(root, rawPath));
    if (!isInside(root, candidate)) {
      throw new Error('manifestPath must stay inside the finance research directory');
    }
    return candidate;
  }
  throw new Error('workflowId or manifestPath is required');
}

function writeWorkflowManifest(ctx: SessionToolContext, run: AnalystWorkflowRun): void {
  const manifestPath = resolve(run.manifestPath);
  const root = financeResearchRoot(ctx.workspacePath);
  if (!isInside(root, manifestPath)) {
    throw new Error('workflow manifest path escaped the finance research directory');
  }
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(run, null, 2));
}

function buildWorkflowPhases(selectedCards: SubAgentTaskCard[]): AnalystWorkflowPhase[] {
  const selected = new Set(selectedCards.map(card => card.id as AnalystSubAgentId));
  const parallelRoleIds: AnalystSubAgentId[] = ['industry-analyst', 'fundamental-analyst', 'technical-analyst'];
  const chainRoleIds: AnalystSubAgentId[] = ['forecast-valuation-analyst', 'risk-control-analyst'];
  const singleRoleIds: AnalystSubAgentId[] = ['report-writer'];
  const phases: Array<{ mode: AnalystDispatchMode; roleIds: AnalystSubAgentId[] }> = [
    { mode: 'parallel', roleIds: parallelRoleIds.filter(id => selected.has(id)) },
    { mode: 'chain', roleIds: chainRoleIds.filter(id => selected.has(id)) },
    { mode: 'single', roleIds: singleRoleIds.filter(id => selected.has(id)) },
  ];
  const known = new Set(phases.flatMap(phase => phase.roleIds));
  const remaining = selectedCards
    .map(card => card.id as AnalystSubAgentId)
    .filter(roleId => !known.has(roleId));
  if (remaining.length > 0) {
    phases.push({ mode: 'single', roleIds: remaining });
  }

  return phases
    .filter(phase => phase.roleIds.length > 0)
    .map((phase, index) => ({
      phase: index + 1,
      mode: phase.mode,
      roleIds: phase.roleIds,
      status: 'planned',
      results: [],
    }));
}

function roleRuntimeContract(roleId: AnalystSubAgentId) {
  return ROLE_RUNTIME_SPECS[roleId];
}

function summarizePreviousResults(previousResults: AnalystTaskResult[]): string {
  if (previousResults.length === 0) return '[]';
  return JSON.stringify(previousResults.map(result => ({
    roleId: result.roleId,
    role: result.role,
    status: result.status,
    sessionId: result.sessionId,
    files: result.files,
    textTail: result.textTail,
    score: result.score ?? null,
    warnings: result.warnings,
  })), null, 2);
}

function buildPhasePrompt(args: {
  card: SubAgentTaskCard;
  workflowId: string;
  parentSessionId: string;
  maxRevisionRounds: number;
  manifestPath: string;
  previousResults: AnalystTaskResult[];
}): string {
  const spec = roleRuntimeContract(args.card.id as AnalystSubAgentId);
  return [
    args.card.prompt,
    '',
    '<orchestration_contract>',
    `workflowId: ${args.workflowId}`,
    `parentSessionId: ${args.parentSessionId}`,
    `roleId: ${args.card.id}`,
    `maxRevisionRounds: ${args.maxRevisionRounds}`,
    `workflowManifestPath: ${args.manifestPath}`,
    `expectedDeliverables: ${JSON.stringify(spec.deliverables)}`,
    `dependsOn: ${JSON.stringify(spec.dependsOn)}`,
    `recommendedTools: ${JSON.stringify(spec.recommendedTools)}`,
    '',
    'You are a real independent subagent session, not a simulated section inside the main answer.',
    'Use available MCP, skills, sources, knowledge_search, and finance_market_data as needed for your role.',
    'Treat recommendedTools as a tool contract and do not request unrelated trading/execution permissions.',
    'Write role outputs to the finance research workspace when possible, using the expected deliverable names or clearly equivalent filenames.',
    'Return only the standard structured deliverable contract: facts, calculations, assumptions, inferences, evidenceLedger, warnings, finalView, handoffToMainAgent.',
    'Every material evidenceLedger entry must include claim, sourceType, source when not inference, dataAsOf for finance data, and confidence.',
    `When your deliverable is ready, call send_agent_message with sessionId "${args.parentSessionId}" and include workflowId, roleId, quality self-check, output files, evidenceLedger, warnings, and the structured deliverable.`,
    'If the Research Manager sends revision feedback, revise until the quality gate passes or explicitly explain why evidence is unavailable.',
    '</orchestration_contract>',
    '',
    '<previousResults>',
    summarizePreviousResults(args.previousResults),
    '</previousResults>',
  ].join('\n');
}

function createTaskResult(args: {
  card: SubAgentTaskCard;
  status: AnalystTaskStatus;
  startedAt: number;
  sessionId?: string | null;
  warnings?: string[];
  error?: string;
}): AnalystTaskResult {
  return {
    roleId: args.card.id as AnalystSubAgentId,
    role: args.card.role,
    roleZh: args.card.roleZh,
    status: args.status,
    sessionId: args.sessionId ?? null,
    durationMs: Date.now() - args.startedAt,
    files: [],
    textTail: args.status === 'started'
      ? `Started ${args.card.role} as session ${args.sessionId ?? 'unknown'}.`
      : `Failed to start ${args.card.role}.`,
    toolCalls: 0,
    score: null,
    reworkCount: 0,
    warnings: args.warnings ?? [],
    ...(args.error ? { error: args.error } : {}),
  };
}

function collectQualityFlags(results: AnalystTaskResult[]): AnalystQualityFlag[] {
  const flags = new Set<AnalystQualityFlag>();
  if (results.some(result => result.status === 'failed')) flags.add('PARTIAL_DELIVERABLE');
  if (results.some(result => result.warnings.some(warning => /provider/i.test(warning)))) flags.add('PROVIDER_WARNING');
  if (results.some(result => result.warnings.some(warning => /evidence|citation|source/i.test(warning)))) flags.add('MISSING_EVIDENCE');
  if (results.some(result => result.warnings.length > 0 || result.status === 'failed')) flags.add('DEGRADED');
  return Array.from(flags);
}

function buildWorkflowOutputs(results: AnalystTaskResult[]): Record<string, string | null> {
  return Object.fromEntries(results.map(result => [result.roleId, result.files[0] ?? null]));
}

function buildResearchWorkflowResponse(
  ctx: SessionToolContext,
  args: ResearchWorkflowArgs
): Record<string, unknown> {
  const taskType = inferTaskType(args);
  const finance = readFinanceConfig(ctx.workspacePath);
  const marketScope = args.marketScope ?? finance.marketScope ?? 'cn-hk';
  const depth = args.depth ?? 'standard';
  const asOfDate = normalizeAsOfDate(args.asOfDate);
  const outputLanguage = args.outputLanguage ?? 'zh-Hans';
  const target = normalizedTarget(args);
  const missingInputs = requiredInputs(taskType, args);
  const shouldWrite = args.writeReport === true;
  const reportPath = shouldWrite && target
    ? join(reportDirectory(ctx.workspacePath, taskType, target), `${taskType}-${asOfDate}.md`)
    : null;

  return {
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
        'select the most relevant specialist subagents and dispatch them without asking the user for a second confirmation',
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
}

export async function handleResearchWorkflow(
  ctx: SessionToolContext,
  args: ResearchWorkflowArgs
): Promise<ToolResult> {
  return successResponse(JSON.stringify(buildResearchWorkflowResponse(ctx, args), null, 2));
}

function extractSessionId(result: Record<string, unknown>): string | null {
  const value = result.sessionId;
  return typeof value === 'string' && value.trim() ? value : null;
}

export async function handleAnalystOrchestrate(
  ctx: SessionToolContext,
  args: AnalystOrchestrateArgs
): Promise<ToolResult> {
  const plan = buildResearchWorkflowResponse(ctx, args) as {
    workflow: { mode: string; taskType: string; target: string | null; marketScope: string; asOfDate: string; depth: string; outputLanguage: string };
    missingInputs: string[];
    qualityGate: { passCriteria: string[] };
    subAgents: Array<{
      id: AnalystSubAgentId;
      role: string;
      roleZh: string;
      sequence: number;
      status: string;
      spawnPolicy: string;
      recommendedSessionName: string;
      labels: string[];
      dataNeeds: string[];
      deliverableContract: string;
      prompt: string;
    }>;
  };

  if (plan.workflow.mode !== 'ready_to_execute') {
    return successResponse(JSON.stringify({
      status: 'needs_user_clarification',
      missingInputs: plan.missingInputs,
      assistantInstruction: 'Ask the user one concise clarification question. Do not show the workflow, task cards, internal state table, or implementation details.',
    }, null, 2));
  }

  if (!ctx.spawnSession) {
    return errorResponse('analyst_orchestrate could not access the session spawn bridge. Do not try bash/write/raw spawn_session as a workaround. Ask the user to restart this session or the Electron dev server so the updated session tool context is loaded.');
  }

  const workflowId = `analyst-${Date.now().toString(36)}`;
  const maxRevisionRounds = Math.max(0, Math.min(args.maxRevisionRounds ?? 2, 5));
  const selectedCards = selectSubAgentTaskCards(plan.subAgents, args, plan.workflow);
  const phases = buildWorkflowPhases(selectedCards);
  const cardsById = new Map(selectedCards.map(card => [card.id as AnalystSubAgentId, card]));
  const manifestPath = workflowManifestPath(ctx.workspacePath, workflowId);
  const startedAt = new Date().toISOString();
  const allResults: AnalystTaskResult[] = [];

  const dispatchRole = async (card: SubAgentTaskCard, previousResults: AnalystTaskResult[]): Promise<AnalystTaskResult> => {
    const roleStartedAt = Date.now();
    const prompt = buildPhasePrompt({
      card,
      workflowId,
      parentSessionId: ctx.sessionId,
      maxRevisionRounds,
      manifestPath,
      previousResults,
    });

    try {
      const result = await ctx.spawnSession!({
        prompt,
        name: card.recommendedSessionName,
        labels: [...card.labels, 'analyst-workflow', workflowId, `parent:${ctx.sessionId}`],
        workingDirectory: ctx.workingDirectory,
      });

      return createTaskResult({
        card,
        status: 'started',
        startedAt: roleStartedAt,
        sessionId: extractSessionId(result),
      });
    } catch (error) {
      return createTaskResult({
        card,
        status: 'failed',
        startedAt: roleStartedAt,
        warnings: ['spawnSession failed before the subagent could start'],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  for (const phase of phases) {
    phase.status = 'started';
    if (phase.mode === 'parallel') {
      const phaseBaseline = [...allResults];
      phase.results = await Promise.all(phase.roleIds.map(async (roleId) => {
        const card = cardsById.get(roleId);
        if (!card) throw new Error(`Missing selected role card for ${roleId}`);
        return dispatchRole(card, phaseBaseline);
      }));
    } else {
      const phaseResults: AnalystTaskResult[] = [];
      for (const roleId of phase.roleIds) {
        const card = cardsById.get(roleId);
        if (!card) throw new Error(`Missing selected role card for ${roleId}`);
        const result = await dispatchRole(card, [...allResults, ...phaseResults]);
        phaseResults.push(result);
      }
      phase.results = phaseResults;
    }
    allResults.push(...phase.results);
    phase.status = phase.results.some(result => result.status === 'failed') ? 'failed' : 'completed';
  }

  const failed = allResults.filter(item => item.status === 'failed');
  const qualityFlags = collectQualityFlags(allResults);
  const run: AnalystWorkflowRun = {
    workflowId,
    parentSessionId: ctx.sessionId,
    intent: {
      taskType: plan.workflow.taskType,
      target: plan.workflow.target,
      marketScope: plan.workflow.marketScope,
      asOfDate: plan.workflow.asOfDate,
      depth: plan.workflow.depth,
      outputLanguage: plan.workflow.outputLanguage,
    },
    phases,
    results: allResults,
    outputs: buildWorkflowOutputs(allResults),
    qualityFlags,
    status: failed.length === 0 ? 'dispatched' : 'partially_dispatched',
    manifestPath,
    createdAt: startedAt,
    completedAt: new Date().toISOString(),
  };

  writeWorkflowManifest(ctx, run);

  return successResponse(JSON.stringify({
    status: run.status,
    workflow: plan.workflow,
    summary: `${allResults.length - failed.length}/${allResults.length} analyst roles dispatched. Manifest: ${manifestPath}`,
    manifestPath,
    qualityFlags,
    selectedSubAgents: selectedCards.map(card => ({
      roleId: card.id,
      role: card.role,
      roleZh: card.roleZh,
    })),
    progress: {
      display: failed.length === 0
        ? 'Analyst workflow dispatched. Expand details for phase, role, warning, and manifest path.'
        : 'Analyst workflow partially dispatched. Expand details for failed roles and warnings.',
      phases: phases.map(phase => ({
        phase: phase.phase,
        mode: phase.mode,
        status: phase.status,
        roles: phase.results.map(result => ({
          roleId: result.roleId,
          role: result.role,
          roleZh: result.roleZh,
          status: result.status,
          sessionId: result.sessionId,
          score: result.score ?? null,
          reworkCount: result.reworkCount,
          warnings: result.warnings,
          files: result.files,
        })),
      })),
    },
    orchestration: {
      workflowId,
      status: run.status,
      parentSessionId: ctx.sessionId,
      maxRevisionRounds,
      dispatches: allResults.map(result => ({
        roleId: result.roleId,
        status: result.status,
        sessionId: result.sessionId,
        durationMs: result.durationMs,
        warnings: result.warnings,
        error: result.error,
      })),
      manifestPath,
      managerProtocol: [
        'Do not ask the user for a second confirmation before dispatching; dispatch has already happened.',
        'Do not use bash, write, or raw spawn_session to create child sessions for this workflow.',
        'Wait for each subagent to reply through send_agent_message.',
        'Evaluate every deliverable against qualityGate.passCriteria.',
        'Use analyst_validate_workflow with the workflowId or manifestPath before final synthesis.',
        'For failed deliverables, send revision feedback with send_agent_message and keep the revision count within maxRevisionRounds.',
        'Only synthesize the final answer after all required roles pass, are explicitly waived, or have documented unavailable evidence.',
      ],
    },
  }, null, 2));
}

function resultFilePath(root: string, filePath: string): string {
  const candidate = normalize(isAbsolute(filePath) ? resolve(filePath) : resolve(root, filePath));
  if (!isInside(root, candidate)) {
    throw new Error(`output path escaped the finance research directory: ${filePath}`);
  }
  return candidate;
}

function isCompletedResult(result: Record<string, unknown>): boolean {
  return ['completed', 'done', 'passed'].includes(String(result.status ?? '').toLowerCase());
}

function hasDeliverable(files: string[], deliverable: string): boolean {
  return files.some(filePath => {
    const name = basename(filePath).toLowerCase();
    const expected = deliverable.toLowerCase();
    return name === expected || filePath.toLowerCase().endsWith(`/${expected}`) || filePath.toLowerCase().endsWith(`\\${expected}`);
  });
}

export async function handleAnalystValidateWorkflow(
  ctx: SessionToolContext,
  args: AnalystValidateWorkflowArgs
): Promise<ToolResult> {
  let manifestPath: string;
  try {
    manifestPath = resolveManifestPath(ctx, args);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }

  const root = financeResearchRoot(ctx.workspacePath);
  const errors: string[] = [];
  const warnings: string[] = [];
  const qualityFlags = new Set<AnalystQualityFlag>();

  if (!existsSync(manifestPath)) {
    return successResponse(JSON.stringify({
      ok: false,
      manifestPath,
      workflowId: args.workflowId ?? null,
      summary: 'Workflow manifest was not found.',
      errors: [`manifest not found: ${manifestPath}`],
      warnings: [],
      qualityFlags: ['PARTIAL_DELIVERABLE'],
    }, null, 2));
  }

  let manifest: Record<string, unknown>;
  try {
    const stat = statSync(manifestPath);
    if (!stat.isFile()) {
      throw new Error('manifestPath is not a file');
    }
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
  } catch (error) {
    return successResponse(JSON.stringify({
      ok: false,
      manifestPath,
      workflowId: args.workflowId ?? null,
      summary: 'Workflow manifest could not be parsed.',
      errors: [error instanceof Error ? error.message : String(error)],
      warnings: [],
      qualityFlags: ['PARTIAL_DELIVERABLE'],
    }, null, 2));
  }

  const workflowId = typeof manifest.workflowId === 'string' ? manifest.workflowId : null;
  if (!workflowId) errors.push('manifest missing workflowId');
  if (typeof manifest.parentSessionId !== 'string' || !manifest.parentSessionId.trim()) {
    errors.push('manifest missing parentSessionId');
  }
  if (!manifest.intent || typeof manifest.intent !== 'object') {
    errors.push('manifest missing intent');
  }
  if (!Array.isArray(manifest.phases)) {
    errors.push('manifest missing phases');
  }
  const results = Array.isArray(manifest.results)
    ? manifest.results as Array<Record<string, unknown>>
    : [];
  if (results.length === 0) {
    errors.push('manifest missing results');
  }

  const manifestFlags = Array.isArray(manifest.qualityFlags) ? manifest.qualityFlags : [];
  for (const flag of manifestFlags) {
    if (['DEGRADED', 'MISSING_EVIDENCE', 'PROVIDER_WARNING', 'PARTIAL_DELIVERABLE'].includes(String(flag))) {
      qualityFlags.add(flag as AnalystQualityFlag);
    }
  }

  for (const [index, result] of results.entries()) {
    const label = `result ${index + 1}`;
    const roleId = result.roleId as AnalystSubAgentId | undefined;
    const status = String(result.status ?? '').toLowerCase();
    if (!roleId || !ROLE_RUNTIME_SPECS[roleId]) {
      errors.push(`${label}: missing or unknown roleId`);
      qualityFlags.add('PARTIAL_DELIVERABLE');
      continue;
    }
    if (!status) {
      errors.push(`${label} (${roleId}): missing status`);
      qualityFlags.add('PARTIAL_DELIVERABLE');
    }
    if (['started', 'completed', 'done', 'passed'].includes(status) && typeof result.sessionId !== 'string') {
      errors.push(`${label} (${roleId}): started/completed result missing sessionId`);
      qualityFlags.add('PARTIAL_DELIVERABLE');
    }
    if (status === 'failed') {
      qualityFlags.add('PARTIAL_DELIVERABLE');
      qualityFlags.add('DEGRADED');
      errors.push(`${label} (${roleId}): failed${result.error ? ` - ${String(result.error)}` : ''}`);
    }

    const resultWarnings = Array.isArray(result.warnings) ? result.warnings.map(String) : [];
    if (resultWarnings.some(warning => /provider/i.test(warning))) {
      qualityFlags.add('PROVIDER_WARNING');
    }
    if (resultWarnings.some(warning => /evidence|source|citation/i.test(warning))) {
      qualityFlags.add('MISSING_EVIDENCE');
    }

    const files = Array.isArray(result.files) ? result.files.map(String) : [];
    if (isCompletedResult(result)) {
      const missingDeliverables = ROLE_RUNTIME_SPECS[roleId].deliverables.filter(deliverable => !hasDeliverable(files, deliverable));
      if (missingDeliverables.length > 0) {
        qualityFlags.add('PARTIAL_DELIVERABLE');
        errors.push(`${label} (${roleId}): missing deliverables ${missingDeliverables.join(', ')}`);
      }
      for (const filePath of files) {
        try {
          const absolutePath = resultFilePath(root, filePath);
          if (!existsSync(absolutePath)) {
            qualityFlags.add('PARTIAL_DELIVERABLE');
            errors.push(`${label} (${roleId}): output file not found ${filePath}`);
          }
        } catch (error) {
          qualityFlags.add('PARTIAL_DELIVERABLE');
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      const evidenceLedger = Array.isArray(result.evidenceLedger)
        ? result.evidenceLedger as EvidenceLedgerEntry[]
        : [];
      if (evidenceLedger.length === 0) {
        qualityFlags.add('MISSING_EVIDENCE');
        warnings.push(`${label} (${roleId}): completed result missing evidenceLedger`);
      } else {
        const evidenceWarnings = validateEvidenceLedger(evidenceLedger);
        if (evidenceWarnings.length > 0) {
          qualityFlags.add('MISSING_EVIDENCE');
          warnings.push(...evidenceWarnings.map(warning => `${label} (${roleId}): ${warning}`));
        }
      }
    }
  }

  if (qualityFlags.size > 0 && !qualityFlags.has('DEGRADED')) {
    qualityFlags.add('DEGRADED');
  }

  return successResponse(JSON.stringify({
    ok: errors.length === 0,
    manifestPath,
    workflowId,
    summary: errors.length === 0
      ? `Workflow manifest validated with ${warnings.length} warning(s).`
      : `Workflow manifest has ${errors.length} error(s) and ${warnings.length} warning(s).`,
    errors,
    warnings,
    qualityFlags: Array.from(qualityFlags),
  }, null, 2));
}
