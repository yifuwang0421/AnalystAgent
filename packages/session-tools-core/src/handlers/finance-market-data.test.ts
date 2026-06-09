import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SessionToolContext } from '../context.ts';
import {
  buildProviderAttempts,
  handleFinanceMarketData,
  normalizeFinancePayload,
} from './finance-market-data.ts';

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

describe('finance_market_data provider router', () => {
  let tempDir: string;
  const originalToken = process.env.IFIND_MCP_AUTH_TOKEN;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'finance-market-data-'));
    delete process.env.IFIND_MCP_AUTH_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.IFIND_MCP_AUTH_TOKEN;
    } else {
      process.env.IFIND_MCP_AUTH_TOKEN = originalToken;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeConfig(marketScope = 'cn-hk', dataProvider = 'ifind') {
    writeFileSync(join(tempDir, 'config.json'), JSON.stringify({
      finance: {
        enabled: true,
        researchDirectory: tempDir,
        marketScope,
        dataProvider,
        knowledgeBaseEnabled: true,
      },
    }));
  }

  it('routes CN/HK auto requests to iFinD first with local Python fallbacks', () => {
    writeConfig('cn-hk');
    const attempts = buildProviderAttempts({
      requestType: 'get_quote',
      symbol: '600519',
      provider: 'auto',
    }, tempDir);

    expect(attempts.map(attempt => attempt.provider)).toEqual(['ifind', 'tushare', 'akshare', 'baostock']);
  });

  it('routes US financial statements to edgartools before yfinance', () => {
    writeConfig('global');
    const attempts = buildProviderAttempts({
      requestType: 'get_financial_statements',
      symbol: 'AAPL',
      marketScope: 'us',
      provider: 'auto',
    }, tempDir);

    expect(attempts.map(attempt => attempt.provider)).toEqual(['edgartools', 'yfinance']);
  });

  it('routes US quotes to yfinance before edgartools', () => {
    writeConfig('global');
    const attempts = buildProviderAttempts({
      requestType: 'get_quote',
      symbol: 'AAPL',
      marketScope: 'us',
      provider: 'auto',
    }, tempDir);

    expect(attempts.map(attempt => attempt.provider)).toEqual(['yfinance', 'edgartools']);
  });

  it('routes global auto requests through iFinD, CN fallbacks, yfinance, then akshare', () => {
    writeConfig('global');
    const attempts = buildProviderAttempts({
      requestType: 'search_instruments',
      query: 'semiconductor equipment',
      provider: 'auto',
    }, tempDir);

    expect(attempts.map(attempt => attempt.provider)).toEqual(['ifind', 'tushare', 'yfinance', 'akshare']);
  });

  it('returns unified unavailable output when iFinD token is missing', async () => {
    writeConfig('cn-hk');
    const result = await handleFinanceMarketData(ctx(tempDir), {
      requestType: 'get_quote',
      symbol: '600519',
      provider: 'ifind',
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      providerAvailable: boolean;
      raw: unknown;
      normalized: unknown;
      sourceCitation: { provider: string };
      warnings: string[];
    };

    expect(parsed.providerAvailable).toBe(false);
    expect(parsed.raw).toBeNull();
    expect(parsed.normalized).toBeNull();
    expect(parsed.sourceCitation.provider).toBe('ifind');
    expect(parsed.warnings.join('\n')).toContain('IFIND_MCP_AUTH_TOKEN is not set');
  });

  it('parses markdown tables into normalized rows', () => {
    const normalized = normalizeFinancePayload('| code | name |\n|---|---|\n| 600519 | 贵州茅台 |');
    expect(normalized.format).toBe('markdown_table');
    expect((normalized.rows as Array<Record<string, string>>)[0]?.code).toBe('600519');
  });
});
