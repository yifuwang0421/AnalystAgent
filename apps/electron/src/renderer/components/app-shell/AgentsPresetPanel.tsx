import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { PanelHeader } from './PanelHeader'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  BUILTIN_ANALYST_AGENT_PRESETS,
  getPresetIcon,
  type AgentPreset,
} from '@/lib/agent-presets'

export type { AgentPreset }
export { BUILTIN_ANALYST_AGENT_PRESETS as ANALYST_AGENT_PRESETS }

interface AgentsPresetPanelProps {
  selectedAgentId?: string | null
  onUseAgent: (preset: AgentPreset) => void
}

export function AgentsPresetPanel({ selectedAgentId, onUseAgent }: AgentsPresetPanelProps) {
  const { t } = useTranslation()
  const presets = BUILTIN_ANALYST_AGENT_PRESETS

  return (
    <div className="h-full flex flex-col bg-background">
      <PanelHeader
        title={t('sidebar.subagents')}
        badge={<span className="text-[10px] px-1.5 py-0.5 rounded-[4px] bg-primary/10 text-primary">{t('agentsPanel.builtinCount')}</span>}
      />
      <div className="flex-1 min-h-0 overflow-auto border-t border-border/50">
        <div className="px-5 py-5 max-w-4xl mx-auto">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">{t('agentsPanel.selectSubagent')}</div>
              <div className="text-xs text-muted-foreground mt-1">{t('agentsPanel.description')}</div>
            </div>
            <div className="h-8 shrink-0 inline-flex items-center gap-1.5 rounded-[6px] border border-border/60 px-2 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              {t('sidebar.subagents')}
            </div>
          </div>

          <div className="grid gap-2">
            {presets.map((preset) => {
              const selected = preset.id === selectedAgentId
              return (
                <div
                  key={preset.id}
                  className={cn(
                    'rounded-[8px] border px-3 py-3 flex items-start gap-3 transition-colors',
                    selected ? 'border-primary/40 bg-primary/[0.04]' : 'border-border/60 bg-background hover:bg-foreground/[0.025]'
                  )}
                >
                  <div className={cn(
                    'mt-0.5 h-8 w-8 rounded-[6px] flex items-center justify-center shrink-0',
                    selected ? 'bg-primary/10 text-primary' : 'bg-foreground/[0.04] text-muted-foreground'
                  )}>
                    {getPresetIcon(preset)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-semibold truncate">{preset.title}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{preset.titleZh}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{preset.description}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 shrink-0"
                    variant={selected ? 'default' : 'outline'}
                    onClick={() => onUseAgent(preset)}
                  >
                    {selected ? t('agentsPanel.selected') : t('agentsPanel.select')}
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
