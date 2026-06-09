import type { AgentSession } from '@mariozechner/pi-coding-agent';

const RUNTIME_TOOLS_SECTION_MARKER = '## Pi Runtime Tool Registry';

type MutablePromptSession = {
  agent: { state: { systemPrompt?: string } };
  _baseSystemPrompt?: string;
  _rebuildSystemPrompt?: (toolNames: string[]) => string;
  __craftOriginalBaseSystemPrompt?: string;
  __craftOriginalRebuildSystemPrompt?: (toolNames: string[]) => string;
};

export type SystemPromptOverrideOptions = {
  preserveRuntimeToolPrompt?: boolean;
};

function stripRuntimeToolAppendix(prompt: string): string {
  const markerIndex = prompt.indexOf(`\n\n${RUNTIME_TOOLS_SECTION_MARKER}`);
  if (markerIndex >= 0) {
    return prompt.slice(0, markerIndex).trimEnd();
  }
  if (prompt.startsWith(RUNTIME_TOOLS_SECTION_MARKER)) {
    return '';
  }
  return prompt.trimEnd();
}

function extractRuntimeToolPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return '';

  const availableMatch = prompt.match(/(^|\n)Available tools:/i);
  if (!availableMatch || availableMatch.index === undefined) {
    return trimmed;
  }

  const sectionStart = availableMatch.index + (availableMatch[0].startsWith('\n') ? 1 : 0);
  const section = prompt.slice(sectionStart);
  const sectionEnd = section.search(
    /\n\n(?:Pi documentation|# Project Context|Current date:|Current working directory:)/i,
  );
  return (sectionEnd >= 0 ? section.slice(0, sectionEnd) : section).trim();
}

export function mergePromptWithRuntimeTools(craftPrompt: string, runtimePrompt: string): string {
  const basePrompt = stripRuntimeToolAppendix(craftPrompt);
  const runtimeToolPrompt = extractRuntimeToolPrompt(runtimePrompt);
  if (!runtimeToolPrompt) return basePrompt;

  return `${basePrompt}\n\n${RUNTIME_TOOLS_SECTION_MARKER}\n\nThe Pi runtime generated the callable tool registry below. Use the exact tool names shown here, including prefixes such as \`mcp__session__\` when present.\n\n${runtimeToolPrompt}`;
}

/**
 * Force a system prompt onto a Pi AgentSession.
 *
 * Pi SDK 0.72+ has no public per-turn system-prompt API. Setting
 * `state.systemPrompt` directly is wiped on every `session.prompt()` call,
 * and `_baseSystemPrompt` itself can be regenerated from the SDK's resource
 * loader when tools change or extensions reload.
 *
 * This stamps all three internals - `state.systemPrompt`, `_baseSystemPrompt`,
 * and `_rebuildSystemPrompt` - so our prompt survives every reset path.
 *
 * The SDK also uses `_rebuildSystemPrompt()` to inject its active tool list into
 * the default prompt. Replacing that function with a constant hides registered
 * tools from the LLM, even though they remain executable. Preserve the original
 * rebuild function and merge its runtime tool section back into the Craft prompt.
 *
 * Remove once the SDK exposes a public per-turn system-prompt API.
 */
export function applySystemPromptOverride(
  session: AgentSession,
  prompt: string,
  options: SystemPromptOverrideOptions = {},
): void {
  const preserveRuntimeToolPrompt = options.preserveRuntimeToolPrompt ?? true;
  const mutable = session as unknown as MutablePromptSession;

  if (!mutable.__craftOriginalRebuildSystemPrompt && mutable._rebuildSystemPrompt) {
    mutable.__craftOriginalRebuildSystemPrompt = mutable._rebuildSystemPrompt.bind(session);
  }
  if (mutable.__craftOriginalBaseSystemPrompt === undefined) {
    mutable.__craftOriginalBaseSystemPrompt =
      mutable._baseSystemPrompt ?? session.agent.state.systemPrompt ?? '';
  }

  const buildRuntimePrompt = (toolNames?: string[]): string => {
    if (!toolNames) {
      return mutable.__craftOriginalBaseSystemPrompt ?? '';
    }
    if (mutable.__craftOriginalRebuildSystemPrompt) {
      return mutable.__craftOriginalRebuildSystemPrompt(toolNames);
    }
    return mutable.__craftOriginalBaseSystemPrompt ?? '';
  };

  const buildPrompt = (toolNames?: string[]): string => {
    if (!preserveRuntimeToolPrompt) {
      return stripRuntimeToolAppendix(prompt);
    }
    const runtimePrompt = buildRuntimePrompt(toolNames) || mutable.__craftOriginalBaseSystemPrompt || '';
    return mergePromptWithRuntimeTools(prompt, runtimePrompt);
  };

  const initialPrompt = buildPrompt();
  session.agent.state.systemPrompt = initialPrompt;
  mutable._baseSystemPrompt = initialPrompt;
  mutable._rebuildSystemPrompt = (toolNames: string[]) => buildPrompt(toolNames);
}
