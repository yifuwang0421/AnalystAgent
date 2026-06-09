import { describe, expect, it } from 'bun:test';
import { getSessionToolProxyDefs } from './session-tool-defs.ts';

describe('Pi session tool proxy definitions', () => {
  it('registers the investment research session tools under Pi runtime names', () => {
    const defs = getSessionToolProxyDefs();
    const names = defs.map(def => def.name);

    expect(names).toContain('mcp__session__analyst_orchestrate');
    expect(names).toContain('mcp__session__spawn_session');
    expect(names).toContain('mcp__session__knowledge_search');
    expect(names).toContain('mcp__session__finance_market_data');
    expect(names).toContain('analyst_orchestrate');
    expect(names).toContain('spawn_session');
    expect(names).toContain('knowledge_search');
    expect(names).toContain('finance_market_data');
  });

  it('keeps proxy tools visible in the Pi available-tools prompt section', () => {
    const defs = getSessionToolProxyDefs();
    const researchDefs = defs.filter(def => [
      'mcp__session__analyst_orchestrate',
      'mcp__session__knowledge_search',
      'mcp__session__finance_market_data',
      'analyst_orchestrate',
      'knowledge_search',
      'finance_market_data',
    ].includes(def.name));

    expect(researchDefs).toHaveLength(6);
    for (const def of researchDefs) {
      expect(def.description.trim().length).toBeGreaterThan(0);
      expect(def.inputSchema).toBeTruthy();
    }
  });
});
