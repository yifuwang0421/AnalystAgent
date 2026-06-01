import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SessionToolContext } from '../context.ts';
import { handleResearchWorkflow, validateEvidenceLedger } from './research-workflow.ts';

function ctx(workspacePath: string): SessionToolContext {
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
  });
});
