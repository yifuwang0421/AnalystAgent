import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { successResponse } from '../response.ts';
import type { ToolResult } from '../types.ts';

export type FinanceRequestType =
  | 'search_instruments'
  | 'get_quote'
  | 'get_historical_prices'
  | 'get_financial_summary'
  | 'get_financial_statements'
  | 'get_valuation_metrics'
  | 'get_news'
  | 'get_announcements'
  | 'get_macro_data'
  | 'get_technical_indicators';

export type FinanceProvider = 'auto' | 'ifind' | 'tushare' | 'yfinance' | 'edgartools' | 'akshare' | 'baostock' | 'python';
export type FinanceMarketScope = 'cn-hk' | 'us' | 'global';

export interface FinanceMarketDataArgs {
  requestType: FinanceRequestType;
  query?: string;
  symbol?: string;
  assetType?: 'stock' | 'fund' | 'macro' | 'auto';
  provider?: FinanceProvider;
  marketScope?: FinanceMarketScope;
  startDate?: string;
  endDate?: string;
  period?: string;
  statementType?: 'income' | 'balance' | 'cashflow' | 'all';
}

interface JsonRpcResponse {
  result?: unknown;
  error?: { message?: string; code?: number; data?: unknown };
}

interface ProviderAttempt {
  provider: Exclude<FinanceProvider, 'auto'>;
  reason: string;
}

interface FinanceWorkspaceConfig {
  finance?: {
    dataProvider?: 'ifind' | 'none';
    marketScope?: FinanceMarketScope;
  };
}

const DEFAULT_IFIND_URLS = {
  stock: 'https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-stock-mcp',
  fund: 'https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-fund-mcp',
  macro: 'https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-edb-mcp',
};

const PYTHON_PROVIDERS = new Set<FinanceProvider>(['python', 'tushare', 'yfinance', 'edgartools', 'akshare', 'baostock']);

function getEndpoint(assetType: 'stock' | 'fund' | 'macro'): string {
  if (assetType === 'stock') return process.env.IFIND_STOCK_MCP_URL || DEFAULT_IFIND_URLS.stock;
  if (assetType === 'fund') return process.env.IFIND_FUND_MCP_URL || DEFAULT_IFIND_URLS.fund;
  return process.env.IFIND_EDB_MCP_URL || DEFAULT_IFIND_URLS.macro;
}

function readWorkspaceConfig(workspacePath: string): FinanceWorkspaceConfig {
  try {
    return JSON.parse(readFileSync(join(workspacePath, 'config.json'), 'utf-8')) as FinanceWorkspaceConfig;
  } catch {
    return {};
  }
}

function configuredProvider(workspacePath: string): 'ifind' | 'none' {
  return readWorkspaceConfig(workspacePath).finance?.dataProvider ?? 'ifind';
}

function configuredMarketScope(workspacePath: string): FinanceMarketScope {
  return readWorkspaceConfig(workspacePath).finance?.marketScope ?? 'cn-hk';
}

function inferAssetType(args: FinanceMarketDataArgs): 'stock' | 'fund' | 'macro' {
  if (args.assetType && args.assetType !== 'auto') return args.assetType;
  if (args.requestType === 'get_macro_data') return 'macro';
  const value = `${args.query ?? ''} ${args.symbol ?? ''}`.toLowerCase();
  if (value.includes('基金') || value.startsWith('fu')) return 'fund';
  return 'stock';
}

function inferMarketScope(args: FinanceMarketDataArgs, workspacePath: string): FinanceMarketScope {
  if (args.marketScope) return args.marketScope;
  const configured = configuredMarketScope(workspacePath);
  const symbol = (args.symbol ?? args.query ?? '').trim();
  if (/\.(us|nasdaq|nyse)$/i.test(symbol) || /^[A-Z]{1,5}$/.test(symbol)) return 'us';
  return configured;
}

export function buildProviderAttempts(args: FinanceMarketDataArgs, workspacePath: string): ProviderAttempt[] {
  const requested = args.provider ?? 'auto';
  if (requested !== 'auto') {
    return [{ provider: requested, reason: 'requested explicitly' }];
  }

  const scope = inferMarketScope(args, workspacePath);
  if (scope === 'us') {
    if (args.requestType === 'get_financial_summary' || args.requestType === 'get_financial_statements') {
      return [
        { provider: 'edgartools', reason: 'US filings first for financial statements' },
        { provider: 'yfinance', reason: 'US public market data fallback' },
      ];
    }
    return [
      { provider: 'yfinance', reason: 'US public market data first' },
      { provider: 'edgartools', reason: 'US filings fallback' },
    ];
  }

  if (scope === 'global') {
    return [
      { provider: 'ifind', reason: 'configured CN/HK provider first' },
      { provider: 'tushare', reason: 'optional CN public-market API fallback' },
      { provider: 'yfinance', reason: 'global public market data fallback' },
      { provider: 'akshare', reason: 'optional local Python fallback' },
    ];
  }

  return [
    { provider: 'ifind', reason: 'A-share/HK first provider' },
    { provider: 'tushare', reason: 'optional CN public-market API fallback' },
    { provider: 'akshare', reason: 'optional local Python fallback' },
    { provider: 'baostock', reason: 'optional local Python fallback' },
  ];
}

async function postJsonRpc(url: string, body: Record<string, unknown>, token?: string): Promise<JsonRpcResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  if (!response.ok) {
    return { error: { message: `HTTP ${response.status}: ${text.slice(0, 500)}` } };
  }

  try {
    return JSON.parse(text) as JsonRpcResponse;
  } catch {
    return { result: text };
  }
}

async function callIfindTool(
  endpoint: string,
  toolName: string,
  args: Record<string, unknown>,
  token?: string
): Promise<JsonRpcResponse> {
  await postJsonRpc(endpoint, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'analyst-agent-finance', version: '0.2.0' },
    },
  }, token);

  await postJsonRpc(endpoint, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  }, token);

  return postJsonRpc(endpoint, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
  }, token);
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractText).join('\n');
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.content)) return extractText(record.content);
    if (typeof record.text === 'string') return record.text;
    if (typeof record.data_markdown === 'string') return record.data_markdown;
    if (typeof record.answer1 === 'string') return record.answer1;
    if (Array.isArray(record.datas)) return extractText(record.datas);
    return JSON.stringify(value);
  }
  return String(value ?? '');
}

function parseMarkdownTable(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith('|'));
  if (lines.length < 2) return [];
  const headers = lines[0]!.split('|').map(cell => cell.trim()).filter(Boolean);
  const rows: Array<Record<string, string>> = [];

  for (const line of lines.slice(2)) {
    const cells = line.split('|').map(cell => cell.trim()).filter((_, index, arr) => index > 0 && index < arr.length - 1);
    if (cells.length === 0) continue;
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? '';
    });
    rows.push(row);
  }

  return rows;
}

export function normalizeFinancePayload(raw: unknown): Record<string, unknown> {
  const text = extractText(raw);
  const markdownRows = parseMarkdownTable(text);
  if (markdownRows.length > 0) {
    return { format: 'markdown_table', rows: markdownRows, text };
  }

  try {
    const parsed = JSON.parse(text);
    return { format: 'json_text', data: parsed, text };
  } catch {
    return { format: 'text', text };
  }
}

function ifindCandidates(args: FinanceMarketDataArgs, assetType: 'stock' | 'fund' | 'macro') {
  const query = args.query || args.symbol || '';
  const symbol = args.symbol || args.query || '';

  if (args.requestType === 'search_instruments') {
    return assetType === 'fund'
      ? [{ name: 'search_funds', args: { query } }]
      : [{ name: 'search_stocks', args: { query } }];
  }

  if (args.requestType === 'get_macro_data') {
    return [
      { name: 'get_edb_data', args: { query } },
      { name: 'get_edb_data', args: { indicator: query } },
      { name: 'get_edb_data', args: { index_name: query } },
    ];
  }

  if (assetType === 'fund') {
    return [
      { name: 'get_fund_market_performance', args: { code: symbol } },
      { name: 'get_fund_market_performance', args: { symbol } },
      { name: 'search_funds', args: { query: symbol } },
    ];
  }

  const dateArgs = {
    ...(args.startDate ? { start_date: args.startDate } : {}),
    ...(args.endDate ? { end_date: args.endDate } : {}),
    ...(args.period ? { period: args.period } : {}),
  };

  switch (args.requestType) {
    case 'get_quote':
      return [
        { name: 'get_stock_performance', args: { code: symbol } },
        { name: 'get_stock_info', args: { code: symbol } },
        { name: 'get_stock_performance', args: { symbol } },
      ];
    case 'get_historical_prices':
      return [
        { name: 'get_stock_kline', args: { code: symbol, ...dateArgs } },
        { name: 'get_stock_performance', args: { code: symbol, ...dateArgs } },
      ];
    case 'get_financial_summary':
    case 'get_financial_statements':
      return [
        { name: 'get_stock_financial', args: { code: symbol, statement_type: args.statementType ?? 'all' } },
        { name: 'get_stock_info', args: { code: symbol } },
      ];
    case 'get_valuation_metrics':
      return [
        { name: 'get_stock_valuation', args: { code: symbol } },
        { name: 'get_stock_performance', args: { code: symbol } },
      ];
    case 'get_news':
    case 'get_announcements':
      return [
        { name: 'get_stock_news', args: { code: symbol, query } },
        { name: 'search_stocks', args: { query: symbol || query } },
      ];
    case 'get_technical_indicators':
      return [
        { name: 'get_stock_technical', args: { code: symbol, ...dateArgs } },
        { name: 'get_stock_kline', args: { code: symbol, ...dateArgs } },
      ];
    default:
      return [{ name: 'search_stocks', args: { query: symbol || query } }];
  }
}

async function callIfind(args: FinanceMarketDataArgs, token?: string) {
  const assetType = inferAssetType(args);
  const endpoint = getEndpoint(assetType);
  const errors: string[] = [];

  for (const candidate of ifindCandidates(args, assetType)) {
    try {
      const response = await callIfindTool(endpoint, candidate.name, candidate.args, token);
      if (!response.error) {
        return {
          ok: true,
          endpoint,
          tool: candidate.name,
          assetType,
          raw: response.result,
          normalized: normalizeFinancePayload(response.result),
        };
      }
      errors.push(`${candidate.name}: ${response.error.message ?? JSON.stringify(response.error)}`);
    } catch (error) {
      errors.push(`${candidate.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { ok: false, endpoint, assetType, errors };
}

function pythonProviderScriptPath(): string {
  return fileURLToPath(new URL('../../scripts/finance_python_provider.py', import.meta.url));
}

async function callPythonProvider(provider: FinanceProvider, args: FinanceMarketDataArgs): Promise<Record<string, unknown>> {
  const python = process.env.ANALYST_FINANCE_PYTHON || process.env.PYTHON || 'python';
  const payload = JSON.stringify({ provider, request: args });

  return new Promise((resolve) => {
    const child = spawn(python, [pythonProviderScriptPath()], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve({
        providerAvailable: false,
        reason: 'Python finance provider timed out.',
      });
    }, 20_000);

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      clearTimeout(timer);
      resolve({
        providerAvailable: false,
        reason: `Python finance provider failed to start: ${error.message}`,
      });
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch {
        resolve({
          providerAvailable: false,
          reason: 'Python finance provider returned non-JSON output.',
          stderr: stderr.slice(0, 1000),
          stdout: stdout.slice(0, 1000),
        });
      }
    });
    child.stdin.end(payload);
  });
}

function makeCitation(provider: string, args: FinanceMarketDataArgs, extra?: Record<string, unknown>) {
  return {
    type: 'finance_data_provider',
    provider,
    requestType: args.requestType,
    symbol: args.symbol,
    query: args.query,
    dataAsOf: new Date().toISOString(),
    ...extra,
  };
}

function unavailable(provider: string, args: FinanceMarketDataArgs, reason: string, warnings: string[] = []) {
  return {
    provider,
    providerAvailable: false,
    request: args,
    dataAsOf: new Date().toISOString(),
    normalized: null,
    raw: null,
    sourceCitation: makeCitation(provider, args),
    warnings: [reason, ...warnings],
    reason,
  };
}

async function runAttempt(provider: ProviderAttempt, args: FinanceMarketDataArgs, workspacePath: string) {
  if (provider.provider === 'ifind') {
    if (configuredProvider(workspacePath) === 'none') {
      return unavailable('ifind', args, 'Finance data provider is disabled for this workspace.');
    }
    const token = process.env.IFIND_MCP_AUTH_TOKEN;
    if (!token) {
      return unavailable('ifind', args, 'IFIND_MCP_AUTH_TOKEN is not set.');
    }
    const result = await callIfind(args, token);
    return {
      provider: 'ifind',
      providerAvailable: result.ok,
      request: args,
      dataAsOf: new Date().toISOString(),
      raw: result.ok ? result.raw : null,
      normalized: result.ok ? result.normalized : null,
      sourceCitation: makeCitation('ifind', args, { endpoint: result.endpoint, tool: result.ok ? result.tool : undefined }),
      warnings: result.ok ? [] : result.errors,
      ...result,
    };
  }

  if (PYTHON_PROVIDERS.has(provider.provider)) {
    const result = await callPythonProvider(provider.provider, args);
    const providerAvailable = result.providerAvailable === true;
    return {
      provider: provider.provider,
      providerAvailable,
      request: args,
      dataAsOf: typeof result.dataAsOf === 'string' ? result.dataAsOf : new Date().toISOString(),
      raw: result.raw ?? null,
      normalized: result.normalized ?? null,
      sourceCitation: makeCitation(provider.provider, args, { library: result.library }),
      warnings: Array.isArray(result.warnings) ? result.warnings : (providerAvailable ? [] : [String(result.reason ?? 'Provider unavailable.')]),
      ...result,
    };
  }

  return unavailable(provider.provider, args, 'Unsupported provider.');
}

export async function handleFinanceMarketData(
  ctx: SessionToolContext,
  args: FinanceMarketDataArgs
): Promise<ToolResult> {
  const attempts = buildProviderAttempts(args, ctx.workspacePath);
  const attemptResults: unknown[] = [];

  for (const attempt of attempts) {
    const result = await runAttempt(attempt, args, ctx.workspacePath);
    attemptResults.push({ reason: attempt.reason, ...result });
    if ((result as { providerAvailable?: boolean }).providerAvailable) {
      return successResponse(JSON.stringify({
        providerRouter: {
          selectedProvider: attempt.provider,
          attempts: attemptResults,
        },
        ...result,
      }, null, 2));
    }
  }

  const warnings = attemptResults.flatMap(result => {
    const maybeWarnings = (result as { warnings?: unknown }).warnings;
    return Array.isArray(maybeWarnings) ? maybeWarnings.map(String) : [];
  });

  return successResponse(JSON.stringify({
    providerRouter: {
      selectedProvider: attempts[0]?.provider ?? args.provider ?? 'auto',
      attempts: attemptResults,
    },
    providerAvailable: false,
    request: args,
    dataAsOf: new Date().toISOString(),
    raw: null,
    normalized: null,
    sourceCitation: makeCitation(attempts[0]?.provider ?? 'auto', args),
    warnings: [
      ...warnings,
      'No configured finance provider returned usable data. Continue with knowledge-base and user-provided files, and disclose the limitation.',
    ],
  }, null, 2));
}
