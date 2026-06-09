import { describe, expect, it } from 'bun:test';
import type { AgentSession } from '@mariozechner/pi-coding-agent';
import { applySystemPromptOverride, mergePromptWithRuntimeTools } from './system-prompt-override.ts';

type StampedSession = {
  agent: { state: { systemPrompt?: string } };
  _baseSystemPrompt?: string;
  _rebuildSystemPrompt?: (toolNames: string[]) => string;
};

function makeSdkPrompt(toolNames: string[]): string {
  return `You are pi.

Available tools:
${toolNames.map(name => `- ${name}: runtime snippet`).join('\n')}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
- Be concise

Pi documentation:
- Docs path

Current date: 2026-06-09`;
}

function makeFakeSession(toolNames = ['read', 'mcp__session__analyst_orchestrate']): StampedSession {
  return {
    agent: { state: {} },
    _baseSystemPrompt: makeSdkPrompt(toolNames),
    _rebuildSystemPrompt: makeSdkPrompt,
  };
}

describe('mergePromptWithRuntimeTools', () => {
  it('merges the Pi runtime tool registry into the Craft prompt', () => {
    const merged = mergePromptWithRuntimeTools(
      'CRAFT_PROMPT',
      makeSdkPrompt(['read', 'mcp__session__finance_market_data']),
    );

    expect(merged).toContain('CRAFT_PROMPT');
    expect(merged).toContain('## Pi Runtime Tool Registry');
    expect(merged).toContain('Available tools:');
    expect(merged).toContain('mcp__session__finance_market_data');
    expect(merged).not.toContain('Pi documentation:');
  });

  it('does not duplicate a previous runtime tool registry appendix', () => {
    const first = mergePromptWithRuntimeTools('CRAFT_PROMPT', makeSdkPrompt(['read']));
    const second = mergePromptWithRuntimeTools(first, makeSdkPrompt(['mcp__session__knowledge_search']));

    expect(second.match(/## Pi Runtime Tool Registry/g)?.length).toBe(1);
    expect(second).toContain('mcp__session__knowledge_search');
    expect(second).not.toContain('- read: runtime snippet');
  });
});

describe('applySystemPromptOverride', () => {
  it('stamps state.systemPrompt with Craft prompt plus Pi runtime tools', () => {
    const session = makeFakeSession();

    applySystemPromptOverride(session as unknown as AgentSession, 'CRAFT_PROMPT');

    expect(session.agent.state.systemPrompt).toContain('CRAFT_PROMPT');
    expect(session.agent.state.systemPrompt).toContain('Available tools:');
    expect(session.agent.state.systemPrompt).toContain('mcp__session__analyst_orchestrate');
  });

  it('stamps the private _baseSystemPrompt field so session.prompt() reset survives', () => {
    const session = makeFakeSession();

    applySystemPromptOverride(session as unknown as AgentSession, 'CRAFT_PROMPT');

    expect(session._baseSystemPrompt).toContain('CRAFT_PROMPT');
    expect(session._baseSystemPrompt).toContain('mcp__session__analyst_orchestrate');
  });

  it('preserves runtime tool rebuilds after SDK tool changes', () => {
    const session = makeFakeSession();

    applySystemPromptOverride(session as unknown as AgentSession, 'CRAFT_PROMPT');

    expect(typeof session._rebuildSystemPrompt).toBe('function');
    const rebuilt = session._rebuildSystemPrompt!([
      'read',
      'mcp__session__finance_market_data',
      'mcp__session__knowledge_search',
    ]);
    expect(rebuilt).toContain('CRAFT_PROMPT');
    expect(rebuilt).toContain('mcp__session__finance_market_data');
    expect(rebuilt).toContain('mcp__session__knowledge_search');
  });

  it('overwrites Craft prompt on re-application without losing the original runtime rebuild', () => {
    const session = makeFakeSession();

    applySystemPromptOverride(session as unknown as AgentSession, 'FIRST');
    applySystemPromptOverride(session as unknown as AgentSession, 'SECOND');
    const rebuilt = session._rebuildSystemPrompt!(['mcp__session__spawn_session']);

    expect(session.agent.state.systemPrompt).toContain('SECOND');
    expect(session.agent.state.systemPrompt).not.toContain('FIRST');
    expect(rebuilt).toContain('SECOND');
    expect(rebuilt).toContain('mcp__session__spawn_session');
    expect(rebuilt.match(/## Pi Runtime Tool Registry/g)?.length).toBe(1);
  });

  it('can stamp an exact prompt for ephemeral no-tool completions', () => {
    const session = makeFakeSession();

    applySystemPromptOverride(session as unknown as AgentSession, 'ONLY_TEXT', {
      preserveRuntimeToolPrompt: false,
    });

    expect(session.agent.state.systemPrompt).toBe('ONLY_TEXT');
    expect(session._baseSystemPrompt).toBe('ONLY_TEXT');
    expect(session._rebuildSystemPrompt!(['mcp__session__call_llm'])).toBe('ONLY_TEXT');
  });
});
