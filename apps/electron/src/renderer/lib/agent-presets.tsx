import * as React from 'react'
import {
  BarChart3,
  Bot,
  Building2,
  Calculator,
  FileText,
  LineChart,
  PlusCircle,
  ShieldAlert,
} from 'lucide-react'
import {
  ANALYST_RESEARCH_GUARDRAILS,
  ANALYST_SUBAGENT_ROLES,
  buildAnalystRolePrompt,
  type AnalystSubAgentId,
} from '@craft-agent/shared/agent/analyst-roles'
import type { ContentBadge } from '../../shared/types'
import * as storage from '@/lib/local-storage'

export interface AgentPreset {
  id: string
  title: string
  titleZh: string
  description: string
  prompt: string
  icon?: React.ReactNode
  custom?: boolean
  traits?: string
}

interface StoredAgentPreset extends Omit<AgentPreset, 'icon'> {
  custom: true
}

const AGENT_SELECTION_UPDATED_EVENT = 'craft:agent-selection-updated'

const BUILTIN_ROLE_ICONS: Record<AnalystSubAgentId, React.ReactNode> = {
  'industry-analyst': <BarChart3 className="h-4 w-4" />,
  'fundamental-analyst': <Building2 className="h-4 w-4" />,
  'forecast-valuation-analyst': <Calculator className="h-4 w-4" />,
  'report-writer': <FileText className="h-4 w-4" />,
  'technical-analyst': <LineChart className="h-4 w-4" />,
  'risk-control-analyst': <ShieldAlert className="h-4 w-4" />,
}

function customRolePrompt(title: string, traits: string): string {
  return [
    `你是 Analyst Agent 中的「${title}」自定义投研子 agent。`,
    '',
    '用户给出的角色特征：',
    traits || '未指定特征。',
    '',
    '工作要求：',
    '把用户特征转化为明确的研究视角、证据偏好和输出风格。遇到模糊边界时先说明假设；如果关键信息缺失，则提出必要澄清或把缺口写入 warnings。',
    '',
    '输出要求：',
    '保留 facts、calculations、assumptions、inferences、evidenceLedger、warnings、finalView 和 handoffToMainAgent。不要把自定义角色扩展为交易执行建议。',
    '',
    '通用约束：',
    ANALYST_RESEARCH_GUARDRAILS,
  ].join('\n')
}

export const BUILTIN_ANALYST_AGENT_PRESETS: AgentPreset[] = ANALYST_SUBAGENT_ROLES.map(role => ({
  id: role.id,
  title: role.title,
  titleZh: role.titleZh,
  description: role.description,
  prompt: buildAnalystRolePrompt(role),
  icon: BUILTIN_ROLE_ICONS[role.id],
}))

function safeStorageGet<T>(key: storage.StorageKey, fallback: T, suffix?: string): T {
  if (typeof localStorage === 'undefined') return fallback
  return storage.get(key, fallback, suffix)
}

function safeStorageSet<T>(key: storage.StorageKey, value: T, suffix?: string): void {
  if (typeof localStorage === 'undefined') return
  storage.set(key, value, suffix)
}

function toStoredPreset(preset: AgentPreset): StoredAgentPreset {
  const { icon: _icon, ...stored } = preset
  return { ...stored, custom: true }
}

export function getCustomAgentPresets(): AgentPreset[] {
  const stored = safeStorageGet<StoredAgentPreset[]>(storage.KEYS.customAgentPresets, [])
  return stored.map((preset) => ({
    ...preset,
    icon: <Bot className="h-4 w-4" />,
    custom: true,
  }))
}

export function saveCustomAgentPresets(presets: AgentPreset[]): void {
  safeStorageSet(storage.KEYS.customAgentPresets, presets.filter(p => p.custom).map(toStoredPreset))
}

export function deleteCustomAgentPreset(agentId: string): void {
  saveCustomAgentPresets(getCustomAgentPresets().filter(preset => preset.id !== agentId))
}

export function getAllAgentPresets(): AgentPreset[] {
  return [...BUILTIN_ANALYST_AGENT_PRESETS, ...getCustomAgentPresets()]
}

export function getAgentPresetById(agentId?: string | null): AgentPreset | null {
  if (!agentId) return null
  return getAllAgentPresets().find(preset => preset.id === agentId) ?? null
}

export function createCustomAgentPreset(input: { name?: string; traits: string }): AgentPreset {
  const traits = input.traits.replace(/\s+/g, ' ').trim()
  const fallbackName = traits.length > 18 ? `${traits.slice(0, 18)}...` : traits
  const titleZh = (input.name || fallbackName || '自定义投研角色').trim()
  const idSuffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return {
    id: `custom-${idSuffix}`,
    title: 'Custom Research Agent',
    titleZh,
    description: traits || '用户自定义投研角色。',
    traits,
    custom: true,
    icon: <Bot className="h-4 w-4" />,
    prompt: customRolePrompt(titleZh, traits),
  }
}

export function addCustomAgentPreset(input: { name?: string; traits: string }): AgentPreset {
  const preset = createCustomAgentPreset(input)
  saveCustomAgentPresets([...getCustomAgentPresets(), preset])
  return preset
}

function getSelectedAgentMap(): Record<string, string> {
  return safeStorageGet<Record<string, string>>(storage.KEYS.selectedAgentBySession, {})
}

function emitSelectionUpdated(sessionId: string, agentId: string | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(AGENT_SELECTION_UPDATED_EVENT, {
    detail: { sessionId, agentId },
  }))
}

export function addAgentSelectionListener(
  listener: (detail: { sessionId: string; agentId: string | null }) => void
): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ sessionId: string; agentId: string | null }>).detail
    if (detail?.sessionId) listener(detail)
  }
  window.addEventListener(AGENT_SELECTION_UPDATED_EVENT, handler)
  return () => window.removeEventListener(AGENT_SELECTION_UPDATED_EVENT, handler)
}

export function saveSelectedAgentForSession(sessionId: string, agentId: string): void {
  const next = { ...getSelectedAgentMap(), [sessionId]: agentId }
  safeStorageSet(storage.KEYS.selectedAgentBySession, next)
  emitSelectionUpdated(sessionId, agentId)
}

export function clearSelectedAgentForSession(sessionId: string): void {
  const next = { ...getSelectedAgentMap() }
  delete next[sessionId]
  safeStorageSet(storage.KEYS.selectedAgentBySession, next)
  emitSelectionUpdated(sessionId, null)
}

export function getSelectedAgentForSession(sessionId?: string | null): AgentPreset | null {
  if (!sessionId) return null
  return getAgentPresetById(getSelectedAgentMap()[sessionId])
}

export function buildAgentContext(preset: AgentPreset): { prefix: string; badge: ContentBadge } {
  const prefix = `<investment_research_agent_role>
<id>${preset.id}</id>
<name>${preset.titleZh || preset.title}</name>
<role_prompt>
${preset.prompt}
</role_prompt>
</investment_research_agent_role>

`

  return {
    prefix,
    badge: {
      type: 'context',
      label: `Agent: ${preset.titleZh || preset.title}`,
      rawText: prefix,
      start: 0,
      end: prefix.length,
      collapsedLabel: `Agent: ${preset.titleZh || preset.title}`,
    },
  }
}

export function getPresetIcon(preset: AgentPreset): React.ReactNode {
  return preset.icon ?? (preset.custom ? <Bot className="h-4 w-4" /> : <PlusCircle className="h-4 w-4" />)
}
