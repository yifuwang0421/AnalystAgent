import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SessionToolContext } from '../context.ts';
import { handleAnalystOrchestrate, handleAnalystValidateWorkflow, handleResearchWorkflow, validateEvidenceLedger } from './research-workflow.ts';

function ctx(workspacePath: string, overrides: Partial<SessionToolContext> = {}): SessionToolContext {
  return {
    sessionId: 'test-session',
    workspacePath,
    sourcesPath: join(workspacePath, 'sources'),
    skillsPath: join(workspacePath, 'skills'),
    plansFolderPath: join(workspacePath, 'plans'),
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: {
      exists: () => false,
      readFile: () => '',
      readFileBuffer: () => Buffer.from(''),
      writeFile: () => {},
      isDirectory: () => false,
      readdir: () => [],
      stat: () => ({ size: 0, isDirectory: () => false }),
    },
    loadSourceConfig: () => null,
    ...overrides,
  };
}

describe('research_workflow', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'research-workflow-'));
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'config.json'), JSON.stringify({
      finance: {
        enabled: true,
        researchDirectory: tempDir,
        marketScope: 'cn-hk',
        dataProvider: 'ifind',
        knowledgeBaseEnabled: true,
      },
    }));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns HITL clarification instead of guessing when target is missing', async () => {
    const result = await handleResearchWorkflow(ctx(tempDir), {
      taskType: 'company_deep_research',
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      workflow: { mode: string };
      missingInputs: string[];
    };

    expect(parsed.workflow.mode).toBe('hitl_clarification_required');
    expect(parsed.missingInputs.join('\n')).toContain('target');
  });

  it('builds a company deep research workflow with role prompts and evidence template', async () => {
    const result = await handleResearchWorkflow(ctx(tempDir), {
      taskType: 'company_deep_research',
      target: '600519 贵州茅台',
      depth: 'deep',
      writeReport: true,
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      workflow: { mode: string; tradingPolicy: string };
      requiredTools: string[];
      subAgents: Array<{ id: string; prompt: string; deliverableContract: string }>;
      manager: { role: string };
      dataLayer: { mode: string };
      qualityGate: { passCriteria: string[] };
      evidenceLedgerTemplate: unknown[];
      reportWritePlan: { reportPath: string };
    };

    expect(parsed.workflow.mode).toBe('ready_to_execute');
    expect(parsed.workflow.tradingPolicy).toContain('Research only');
    expect(parsed.requiredTools).toContain('finance_market_data: get_financial_summary');
    expect(parsed.manager.role).toBe('Analyst Agent / Research Manager');
    expect(parsed.dataLayer.mode).toBe('unified_router_v1');
    expect(parsed.subAgents.map(agent => agent.id)).toEqual([
      'industry-analyst',
      'fundamental-analyst',
      'forecast-valuation-analyst',
      'report-writer',
      'technical-analyst',
      'risk-control-analyst',
    ]);
    expect(parsed.subAgents[0]?.prompt).toContain('taskType: company_deep_research');
    expect(parsed.subAgents[0]?.deliverableContract).toContain('evidenceLedger');
    expect(parsed.qualityGate.passCriteria.join('\n')).toContain('No direct buy/sell');
    expect(parsed.evidenceLedgerTemplate.length).toBe(1);
    expect(parsed.reportWritePlan.reportPath).toContain(tempDir);
  });

  it('supports the four v1 task templates', async () => {
    for (const taskType of ['company_deep_research', 'earnings_review', 'event_impact', 'industry_scan'] as const) {
      const result = await handleResearchWorkflow(ctx(tempDir), {
        taskType,
        target: taskType === 'earnings_review' ? 'AAPL 2025 Q4 earnings' : 'AAPL',
        asOfDate: taskType === 'event_impact' ? '2026-05-24' : undefined,
      });
      const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { workflow: { taskType: string } };
      expect(parsed.workflow.taskType).toBe(taskType);
    }
  });

  it('warns when evidence ledger entries have uncited material claims', () => {
    const warnings = validateEvidenceLedger([
      { claim: 'Revenue growth improved', sourceType: 'finance_data_provider' },
      { claim: 'Margin recovery is likely', sourceType: 'explicit_inference', isInference: true },
    ]);

    expect(warnings.join('\n')).toContain('non-inference claim needs a source');
    expect(warnings.join('\n')).toContain('finance data needs dataAsOf');
    expect(warnings.join('\n')).toContain('missing confidence');
  });

  it('orchestrates ready workflows through parallel, chain, and single phases', async () => {
    const spawnInputs: Record<string, unknown>[] = [];
    const result = await handleAnalystOrchestrate(ctx(tempDir, {
      spawnSession: async (input) => {
        spawnInputs.push(input);
        return { sessionId: `child-${spawnInputs.length}`, status: 'started' };
      },
    }), {
      taskType: 'company_deep_research',
      target: 'AAPL',
      depth: 'deep',
      maxRevisionRounds: 1,
    });

    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      status: string;
      manifestPath: string;
      selectedSubAgents: Array<{ roleId: string }>;
      progress: { phases: Array<{ mode: string; roles: Array<{ roleId: string; sessionId: string | null }> }> };
      orchestration: { status: string; dispatches: Array<{ sessionId: string | null }> };
    };

    expect(result.isError).toBe(false);
    expect(spawnInputs).toHaveLength(6);
    expect(parsed.status).toBe('dispatched');
    expect(parsed.orchestration.status).toBe('dispatched');
    expect(parsed.orchestration.dispatches.map(item => item.sessionId)).toEqual([
      'child-1',
      'child-2',
      'child-3',
      'child-4',
      'child-5',
      'child-6',
    ]);
    expect(parsed.progress.phases.map(phase => phase.mode)).toEqual(['parallel', 'chain', 'single']);
    expect(parsed.progress.phases[0]?.roles.map(role => role.roleId)).toEqual([
      'industry-analyst',
      'fundamental-analyst',
      'technical-analyst',
    ]);
    expect(parsed.progress.phases[1]?.roles.map(role => role.roleId)).toEqual([
      'forecast-valuation-analyst',
      'risk-control-analyst',
    ]);
    expect(parsed.progress.phases[2]?.roles.map(role => role.roleId)).toEqual(['report-writer']);
    expect(parsed.selectedSubAgents.map(item => item.roleId).sort()).toEqual([
      'forecast-valuation-analyst',
      'fundamental-analyst',
      'industry-analyst',
      'report-writer',
      'risk-control-analyst',
      'technical-analyst',
    ].sort());
    expect(String(spawnInputs[0]?.prompt)).toContain('parentSessionId: test-session');
    expect(spawnInputs[0]?.labels as string[]).toContain('analyst-workflow');
    expect(String(spawnInputs[4]?.prompt)).toContain('<previousResults>');
    expect(String(spawnInputs[4]?.prompt)).toContain('forecast-valuation-analyst');
    expect(String(spawnInputs[4]?.prompt)).toContain('child-4');
    expect(existsSync(parsed.manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(parsed.manifestPath, 'utf-8')) as {
      workflowId: string;
      phases: Array<{ mode: string }>;
      results: unknown[];
    };
    expect(parsed.manifestPath).toContain(manifest.workflowId);
    expect(manifest.phases.map(phase => phase.mode)).toEqual(['parallel', 'chain', 'single']);
    expect(manifest.results).toHaveLength(6);
  });

  it('does not dispatch orchestration when HITL inputs are missing', async () => {
    let spawnCount = 0;
    const result = await handleAnalystOrchestrate(ctx(tempDir, {
      spawnSession: async () => {
        spawnCount += 1;
        return { sessionId: 'should-not-start' };
      },
    }), {
      taskType: 'company_deep_research',
    });

    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      status: string;
      assistantInstruction: string;
    };

    expect(spawnCount).toBe(0);
    expect(parsed.status).toBe('needs_user_clarification');
    expect(parsed.assistantInstruction).toContain('Do not show the workflow');
  });

  it('infers target from original request before asking for HITL clarification', async () => {
    const spawnInputs: Record<string, unknown>[] = [];
    const result = await handleAnalystOrchestrate(ctx(tempDir, {
      spawnSession: async (input) => {
        spawnInputs.push(input);
        return { sessionId: `child-${spawnInputs.length}`, status: 'started' };
      },
    }), {
      request: '对英伟达(NVDA)启动深度研究工作流',
      taskType: 'company_deep_research',
      depth: 'standard',
    });

    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      workflow: { target: string | null };
      orchestration: { status: string };
    };

    expect(parsed.workflow.target).toBe('英伟达 NVDA');
    expect(parsed.orchestration.status).toBe('dispatched');
    expect(spawnInputs.length).toBeGreaterThan(0);
  });

  it('does not dispatch event analysis when asOfDate is missing', async () => {
    let spawnCount = 0;
    const result = await handleAnalystOrchestrate(ctx(tempDir, {
      spawnSession: async () => {
        spawnCount += 1;
        return { sessionId: 'should-not-start' };
      },
    }), {
      taskType: 'event_impact',
      target: 'AAPL product event',
    });

    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { status: string; missingInputs: string[] };
    expect(spawnCount).toBe(0);
    expect(parsed.status).toBe('needs_user_clarification');
    expect(parsed.missingInputs.join('\n')).toContain('asOfDate');
  });

  it('validates a complete workflow manifest', async () => {
    const workflowId = 'validator-complete';
    const runDir = join(tempDir, 'reports', '.analyst-workflows', workflowId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'industry.md'), 'industry');
    writeFileSync(join(runDir, 'industry_data.json'), '{}');
    writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({
      workflowId,
      parentSessionId: 'parent',
      intent: { taskType: 'industry_scan', target: 'AI', marketScope: 'us', asOfDate: '2026-06-07', depth: 'standard', outputLanguage: 'en' },
      phases: [{ phase: 1, mode: 'parallel', roleIds: ['industry-analyst'], status: 'completed', results: [] }],
      results: [{
        roleId: 'industry-analyst',
        role: 'Industry Analyst',
        roleZh: '行业分析师',
        status: 'completed',
        sessionId: 'child-1',
        durationMs: 1,
        files: [
          'reports/.analyst-workflows/validator-complete/industry.md',
          'reports/.analyst-workflows/validator-complete/industry_data.json',
        ],
        textTail: 'done',
        reworkCount: 0,
        warnings: [],
        evidenceLedger: [{
          claim: 'AI capex is rising',
          sourceType: 'finance_data_provider',
          source: 'provider-x',
          dataAsOf: '2026-06-07',
          confidence: 'medium',
        }],
      }],
      outputs: { 'industry-analyst': 'reports/.analyst-workflows/validator-complete/industry.md' },
      qualityFlags: [],
      status: 'dispatched',
      manifestPath: join(runDir, 'manifest.json'),
      createdAt: '2026-06-07T00:00:00.000Z',
      completedAt: '2026-06-07T00:00:01.000Z',
    }));

    const result = await handleAnalystValidateWorkflow(ctx(tempDir), { workflowId });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { ok: boolean; errors: string[] };

    expect(parsed.ok).toBe(true);
    expect(parsed.errors).toEqual([]);
  });

  it('flags partial deliverables when completed role outputs are missing', async () => {
    const workflowId = 'validator-partial';
    const runDir = join(tempDir, 'reports', '.analyst-workflows', workflowId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'industry.md'), 'industry');
    writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({
      workflowId,
      parentSessionId: 'parent',
      intent: { taskType: 'industry_scan', target: 'AI', marketScope: 'us', asOfDate: '2026-06-07', depth: 'standard', outputLanguage: 'en' },
      phases: [{ phase: 1, mode: 'parallel', roleIds: ['industry-analyst'], status: 'completed', results: [] }],
      results: [{
        roleId: 'industry-analyst',
        role: 'Industry Analyst',
        roleZh: '行业分析师',
        status: 'completed',
        sessionId: 'child-1',
        durationMs: 1,
        files: ['reports/.analyst-workflows/validator-partial/industry.md'],
        textTail: 'done',
        reworkCount: 0,
        warnings: [],
        evidenceLedger: [{
          claim: 'AI capex is rising',
          sourceType: 'knowledge_base_file',
          source: 'reports/source.md',
          confidence: 'medium',
        }],
      }],
      outputs: {},
      qualityFlags: [],
      status: 'dispatched',
      manifestPath: join(runDir, 'manifest.json'),
      createdAt: '2026-06-07T00:00:00.000Z',
      completedAt: '2026-06-07T00:00:01.000Z',
    }));

    const result = await handleAnalystValidateWorkflow(ctx(tempDir), { workflowId });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { ok: boolean; errors: string[]; qualityFlags: string[] };

    expect(parsed.ok).toBe(false);
    expect(parsed.errors.join('\n')).toContain('industry_data.json');
    expect(parsed.qualityFlags).toContain('PARTIAL_DELIVERABLE');
  });

  it('warns on incomplete evidence ledger fields and provider warnings', async () => {
    const workflowId = 'validator-evidence';
    const runDir = join(tempDir, 'reports', '.analyst-workflows', workflowId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'industry.md'), 'industry');
    writeFileSync(join(runDir, 'industry_data.json'), '{}');
    writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({
      workflowId,
      parentSessionId: 'parent',
      intent: { taskType: 'industry_scan', target: 'AI', marketScope: 'us', asOfDate: '2026-06-07', depth: 'standard', outputLanguage: 'en' },
      phases: [{ phase: 1, mode: 'parallel', roleIds: ['industry-analyst'], status: 'completed', results: [] }],
      results: [{
        roleId: 'industry-analyst',
        role: 'Industry Analyst',
        roleZh: '行业分析师',
        status: 'completed',
        sessionId: 'child-1',
        durationMs: 1,
        files: [
          'reports/.analyst-workflows/validator-evidence/industry.md',
          'reports/.analyst-workflows/validator-evidence/industry_data.json',
        ],
        textTail: 'done',
        reworkCount: 0,
        warnings: ['provider warning: provider-x timed out'],
        evidenceLedger: [{
          claim: 'Revenue improved',
          sourceType: 'finance_data_provider',
          source: 'provider-x',
        }],
      }],
      outputs: {},
      qualityFlags: [],
      status: 'dispatched',
      manifestPath: join(runDir, 'manifest.json'),
      createdAt: '2026-06-07T00:00:00.000Z',
      completedAt: '2026-06-07T00:00:01.000Z',
    }));

    const result = await handleAnalystValidateWorkflow(ctx(tempDir), { workflowId });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { ok: boolean; warnings: string[]; qualityFlags: string[] };

    expect(parsed.ok).toBe(true);
    expect(parsed.warnings.join('\n')).toContain('finance data needs dataAsOf');
    expect(parsed.warnings.join('\n')).toContain('missing confidence');
    expect(parsed.qualityFlags).toContain('MISSING_EVIDENCE');
    expect(parsed.qualityFlags).toContain('PROVIDER_WARNING');
  });

  it('protects workflow manifest validation path containment', async () => {
    const result = await handleAnalystValidateWorkflow(ctx(tempDir), {
      manifestPath: '..\\outside-manifest.json',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('inside the finance research directory');
  });
});
