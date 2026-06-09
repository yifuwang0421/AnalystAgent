/**
 * Pi Session Tool Proxy Definitions
 *
 * Thin wrapper around the canonical tool definitions in @craft-agent/session-tools-core.
 * Adds the `mcp__session__` prefix that the Pi SDK expects.
 */

import {
  getToolDefsAsJsonSchema,
  SESSION_TOOL_NAMES,
  type JsonSchemaToolDef,
} from '@craft-agent/session-tools-core';
import { FEATURE_FLAGS } from '../../../feature-flags.ts';

export type SessionToolProxyDef = JsonSchemaToolDef;

export { SESSION_TOOL_NAMES };

export const PI_SESSION_TOOL_ALIAS_NAMES = new Set([
  'analyst_orchestrate',
  'research_workflow',
  'knowledge_search',
  'finance_market_data',
  'spawn_session',
  'call_llm',
]);

export function getSessionToolProxyDefs(): SessionToolProxyDef[] {
  const prefixedDefs = getToolDefsAsJsonSchema({
    prefix: 'mcp__session__',
    includeDeveloperFeedback: FEATURE_FLAGS.developerFeedback,
  });
  const aliasDefs = getToolDefsAsJsonSchema({
    includeDeveloperFeedback: FEATURE_FLAGS.developerFeedback,
  }).filter(def => PI_SESSION_TOOL_ALIAS_NAMES.has(def.name));

  return [...prefixedDefs, ...aliasDefs];
}
