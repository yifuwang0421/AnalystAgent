import { describe, expect, it } from 'bun:test';
import { runPreToolUseChecks } from '../core/pre-tool-use.ts';
import { setPermissionMode } from '../mode-manager.ts';

const permissionManager = {
  isCommandWhitelisted: () => false,
  isDangerousCommand: () => false,
  getBaseCommand: () => '',
  extractDomainFromNetworkCommand: () => null,
  isDomainWhitelisted: () => false,
};

function run(toolName: string) {
  const sessionId = `alias-pretool-${toolName}`;
  setPermissionMode(sessionId, 'ask', { changedBy: 'system' });
  return runPreToolUseChecks({
    toolName,
    input: {},
    sessionId,
    permissionMode: 'ask',
    workspaceRootPath: 'D:\\Projects\\AnalystAgent',
    workspaceId: 'test-workspace',
    activeSourceSlugs: [],
    allSourceSlugs: [],
    hasSourceActivation: false,
    permissionManager,
  });
}

describe('session tool aliases in Pi pre-tool pipeline', () => {
  it('intercepts call_llm under prefixed and unprefixed names', () => {
    expect(run('mcp__session__call_llm').type).toBe('call_llm_intercept');
    expect(run('call_llm').type).toBe('call_llm_intercept');
  });

  it('intercepts spawn_session under prefixed and unprefixed names', () => {
    expect(run('mcp__session__spawn_session').type).toBe('spawn_session_intercept');
    expect(run('spawn_session').type).toBe('spawn_session_intercept');
  });
});
