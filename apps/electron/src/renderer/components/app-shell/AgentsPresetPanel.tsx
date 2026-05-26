import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { PanelHeader } from './PanelHeader'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  addCustomAgentPreset,
  BUILTIN_ANALYST_AGENT_PRESETS,
  deleteCustomAgentPreset,
  getCustomAgentPresets,
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
  const [customPresets, setCustomPresets] = React.useState<AgentPreset[]>(() => getCustomAgentPresets())
  const [customName, setCustomName] = React.useState('')
  const [customTraits, setCustomTraits] = React.useState('')
  const [customDialogOpen, setCustomDialogOpen] = React.useState(false)

  const presets = React.useMemo(
    () => [...BUILTIN_ANALYST_AGENT_PRESETS, ...customPresets],
    [customPresets],
  )

  const handleAddCustomAgent = React.useCallback(() => {
    const traits = customTraits.trim()
    if (!traits) return
    const preset = addCustomAgentPreset({
      name: customName.trim() || undefined,
      traits,
    })
    setCustomPresets(getCustomAgentPresets())
    setCustomName('')
    setCustomTraits('')
    setCustomDialogOpen(false)
    onUseAgent(preset)
  }, [customName, customTraits, onUseAgent])

  const handleDeleteCustomAgent = React.useCallback((agentId: string) => {
    deleteCustomAgentPreset(agentId)
    setCustomPresets(getCustomAgentPresets())
  }, [])

  return (
    <div className="h-full flex flex-col bg-background">
      <PanelHeader
        title="Agents"
        badge={<span className="text-[10px] px-1.5 py-0.5 rounded-[4px] bg-primary/10 text-primary">投研角色预设</span>}
      />
      <div className="flex-1 min-h-0 overflow-auto border-t border-border/50">
        <div className="px-5 py-5 max-w-4xl mx-auto">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">选择投研角色</div>
              <div className="text-xs text-muted-foreground mt-1">角色会作为会话上下文生效，并显示在输入框下方。</div>
            </div>
            <Dialog open={customDialogOpen} onOpenChange={setCustomDialogOpen}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                onClick={() => setCustomDialogOpen(true)}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                自定义
              </Button>
              <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle>添加自定义投研 Agent</DialogTitle>
                  <DialogDescription>
                    输入角色特征后，会生成一个可复用的投研子 agent，并在本次新会话中启用。
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">名称</label>
                    <Input
                      value={customName}
                      onChange={(event) => setCustomName(event.target.value)}
                      placeholder="例如：半导体产业链研究员"
                      className="h-9"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Agent 特征</label>
                    <Textarea
                      value={customTraits}
                      onChange={(event) => setCustomTraits(event.target.value)}
                      placeholder="例如：专注半导体产业链，重视供需拐点和财务质量，输出先给证据后给判断"
                      className="min-h-32 resize-y"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCustomDialogOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    type="button"
                    disabled={!customTraits.trim()}
                    onClick={handleAddCustomAgent}
                  >
                    添加并启用
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
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
                      {preset.custom && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-[4px] bg-foreground/5 text-muted-foreground shrink-0">自定义</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{preset.description}</p>
                  </div>
                  {preset.custom && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 text-muted-foreground"
                      onClick={() => handleDeleteCustomAgent(preset.id)}
                      aria-label="删除自定义 agent"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 shrink-0"
                    variant={selected ? 'default' : 'outline'}
                    onClick={() => onUseAgent(preset)}
                  >
                    {selected ? '已选择' : '选择'}
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
