import * as React from 'react'
import { AlertTriangle, ExternalLink, FileText, Folder, FolderOpen, RefreshCw, Save, Search, X } from 'lucide-react'
import { TiptapMarkdownEditor, Spinner, Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { PanelHeader } from './PanelHeader'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import type { WorkspaceKnowledgeSearchResult, WorkspaceResearchFileEntry, FilesScope } from '../../../shared/types'

interface ResearchFileWorkspaceProps {
  workspaceId: string | null
  scope?: FilesScope
}

type KnowledgePanelMode = 'search' | 'directory'

const KNOWLEDGE_PANEL_WIDTH_KEY = 'knowledge-panel-width'
const KNOWLEDGE_PANEL_DEFAULT_WIDTH = 320
const KNOWLEDGE_PANEL_MIN_WIDTH = 260
const KNOWLEDGE_PANEL_MAX_WIDTH = 460

function flattenMarkdownFiles(entries: WorkspaceResearchFileEntry[]): WorkspaceResearchFileEntry[] {
  const result: WorkspaceResearchFileEntry[] = []
  const visit = (entry: WorkspaceResearchFileEntry) => {
    if (entry.type === 'file') result.push(entry)
    entry.children?.forEach(visit)
  }
  entries.forEach(visit)
  return result
}

function displayPath(entry?: WorkspaceResearchFileEntry | null): string {
  if (!entry) return ''
  return entry.relativePath || entry.name
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

function entryMatchesScope(entry: WorkspaceResearchFileEntry, scope: FilesScope): boolean {
  if (scope === 'knowledge') return entry.relativePath === 'knowledge'
  return entry.relativePath !== 'knowledge'
}

function isMarkdownFilePath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

function resultToEntry(result: WorkspaceKnowledgeSearchResult): WorkspaceResearchFileEntry {
  return {
    name: basename(result.path),
    path: result.path,
    relativePath: result.relativePath,
    type: 'file',
  }
}

function clampPanelWidth(width: number): number {
  return Math.max(KNOWLEDGE_PANEL_MIN_WIDTH, Math.min(KNOWLEDGE_PANEL_MAX_WIDTH, width))
}

function FileTreeItem({
  entry,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  entry: WorkspaceResearchFileEntry
  selectedPath: string | null
  onSelect: (entry: WorkspaceResearchFileEntry) => void
  depth?: number
}) {
  const [open, setOpen] = React.useState(depth < 1)
  const isSelected = selectedPath === entry.path
  const isDirectory = entry.type === 'directory'
  const hasChildren = !!entry.children?.length

  if (isDirectory) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className={cn(
            'w-full h-8 px-2 flex items-center gap-2 rounded-[6px] text-xs text-left',
            'hover:bg-foreground/[0.04] transition-colors',
            'text-muted-foreground hover:text-foreground'
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {open ? <FolderOpen className="h-3.5 w-3.5 shrink-0" /> : <Folder className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate font-medium">{entry.name}</span>
        </button>
        {open && hasChildren && (
          <div>
            {entry.children!.map(child => (
              <FileTreeItem
                key={child.path}
                entry={child}
                selectedPath={selectedPath}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      className={cn(
        'w-full h-8 px-2 flex items-center gap-2 rounded-[6px] text-xs text-left transition-colors',
        isSelected
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]'
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{entry.name}</span>
    </button>
  )
}

export function ResearchFileWorkspace({ workspaceId, scope = 'research' }: ResearchFileWorkspaceProps) {
  const [rootPath, setRootPath] = React.useState('')
  const [entries, setEntries] = React.useState<WorkspaceResearchFileEntry[]>([])
  const [selectedEntry, setSelectedEntry] = React.useState<WorkspaceResearchFileEntry | null>(null)
  const [content, setContent] = React.useState('')
  const [savedContent, setSavedContent] = React.useState('')
  const [mtimeMs, setMtimeMs] = React.useState<number | undefined>()
  const [loadingTree, setLoadingTree] = React.useState(false)
  const [loadingFile, setLoadingFile] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [treeOpen, setTreeOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [searchResults, setSearchResults] = React.useState<WorkspaceKnowledgeSearchResult[]>([])
  const [searching, setSearching] = React.useState(false)
  const [searchNote, setSearchNote] = React.useState<string | null>(null)
  const [externalSelection, setExternalSelection] = React.useState<WorkspaceKnowledgeSearchResult | null>(null)
  const [knowledgePanelOpen, setKnowledgePanelOpen] = React.useState(false)
  const [knowledgePanelMode, setKnowledgePanelMode] = React.useState<KnowledgePanelMode>('search')
  const [knowledgePanelWidth, setKnowledgePanelWidth] = React.useState(() => {
    if (typeof localStorage === 'undefined') return KNOWLEDGE_PANEL_DEFAULT_WIDTH
    const stored = Number(localStorage.getItem(KNOWLEDGE_PANEL_WIDTH_KEY))
    return Number.isFinite(stored) ? clampPanelWidth(stored) : KNOWLEDGE_PANEL_DEFAULT_WIDTH
  })
  const knowledgePanelDragRef = React.useRef<{ startX: number; startWidth: number } | null>(null)

  const visibleEntries = React.useMemo(
    () => entries.filter(entry => entryMatchesScope(entry, scope)),
    [entries, scope]
  )
  const dirty = content !== savedContent
  const title = scope === 'knowledge' ? '知识库' : '研究工作区'
  const emptySelectionLabel = scope === 'knowledge' ? '选择知识材料' : '选择 Markdown 文件'
  const selectedPath = selectedEntry?.path ?? externalSelection?.path ?? null
  const selectedName = selectedEntry ? basename(selectedEntry.path) : externalSelection ? basename(externalSelection.path) : emptySelectionLabel
  const selectedDisplayPath = selectedEntry ? displayPath(selectedEntry) : externalSelection?.relativePath ?? ''
  const selectedExternalPath = selectedEntry?.path ?? externalSelection?.path

  React.useEffect(() => {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(KNOWLEDGE_PANEL_WIDTH_KEY, String(knowledgePanelWidth))
  }, [knowledgePanelWidth])

  const loadTree = React.useCallback(async () => {
    if (!workspaceId) return
    setLoadingTree(true)
    setError(null)
    try {
      const result = await window.electronAPI.listWorkspaceResearchFiles(workspaceId)
      setRootPath(result.rootPath)
      setEntries(result.entries)
      const scopedEntries = result.entries.filter(entry => entryMatchesScope(entry, scope))
      const firstFile = flattenMarkdownFiles(scopedEntries)[0] ?? null
      setSelectedEntry(prev => {
        if (prev && flattenMarkdownFiles(scopedEntries).some(file => file.path === prev.path)) return prev
        return firstFile
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingTree(false)
    }
  }, [workspaceId, scope])

  React.useEffect(() => {
    loadTree()
  }, [loadTree])

  React.useEffect(() => {
    setTreeOpen(false)
    setExternalSelection(null)
    setSearchQuery('')
    setSearchResults([])
    setSearchNote(null)
    setKnowledgePanelOpen(false)
    setKnowledgePanelMode('search')
  }, [scope, workspaceId])

  React.useEffect(() => {
    const loadFile = async () => {
      if (!selectedEntry || selectedEntry.type !== 'file') {
        setContent('')
        setSavedContent('')
        setMtimeMs(undefined)
        return
      }

      setLoadingFile(true)
      setError(null)
      setNotice(null)
      try {
        const nextContent = await window.electronAPI.readFile(selectedEntry.path)
        setContent(nextContent)
        setSavedContent(nextContent)
        setMtimeMs(selectedEntry.mtimeMs)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoadingFile(false)
      }
    }

    loadFile()
  }, [selectedEntry])

  const handleSelect = React.useCallback((entry: WorkspaceResearchFileEntry) => {
    if (dirty && !window.confirm('当前 Markdown 有未保存修改，切换文件会放弃这些修改。继续吗？')) return
    setExternalSelection(null)
    setSelectedEntry(entry)
    setTreeOpen(false)
    if (scope === 'knowledge') setKnowledgePanelOpen(false)
  }, [dirty, scope])

  const handleKnowledgeSearch = React.useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault()
    if (!workspaceId || scope !== 'knowledge') return
    const query = searchQuery.trim()
    setKnowledgePanelMode('search')
    setKnowledgePanelOpen(true)
    setSearching(true)
    setError(null)
    setSearchNote(null)
    try {
      const result = await window.electronAPI.searchWorkspaceKnowledge(workspaceId, query, 12)
      setSearchResults(result.results)
      setSearchNote(result.note ?? (query && result.results.length === 0 ? '没有找到匹配的知识材料' : null))
    } catch (err) {
      setSearchResults([])
      setSearchNote(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSearching(false)
    }
  }, [scope, searchQuery, workspaceId])

  const handleKnowledgeResultSelect = React.useCallback((result: WorkspaceKnowledgeSearchResult) => {
    if (dirty && !window.confirm('当前 Markdown 有未保存修改，切换材料会放弃这些修改。继续吗？')) return
    if (isMarkdownFilePath(result.path)) {
      setExternalSelection(null)
      setSelectedEntry(resultToEntry(result))
    } else {
      setSelectedEntry(null)
      setExternalSelection(result)
      setContent('')
      setSavedContent('')
      setMtimeMs(undefined)
    }
    setKnowledgePanelOpen(false)
  }, [dirty])

  const openKnowledgeDirectory = React.useCallback(() => {
    setKnowledgePanelMode('directory')
    setKnowledgePanelOpen(true)
  }, [])

  const beginKnowledgePanelResize = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    knowledgePanelDragRef.current = {
      startX: event.clientX,
      startWidth: knowledgePanelWidth,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [knowledgePanelWidth])

  React.useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const drag = knowledgePanelDragRef.current
      if (!drag) return
      setKnowledgePanelWidth(clampPanelWidth(drag.startWidth + event.clientX - drag.startX))
    }
    const onMouseUp = () => {
      knowledgePanelDragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const handleSave = React.useCallback(async () => {
    if (!selectedEntry || !dirty) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const result = await window.electronAPI.writeWorkspaceMarkdown(selectedEntry.path, content, mtimeMs)
      setMtimeMs(result.mtimeMs)
      setSavedContent(content)
      setSelectedEntry(prev => prev ? { ...prev, mtimeMs: result.mtimeMs } : prev)
      setNotice('已保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [content, dirty, mtimeMs, selectedEntry])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  if (!workspaceId) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title={title} />
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">未选择工作区</div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background relative">
      <PanelHeader
        title={title}
        badge={dirty ? <span className="text-[10px] px-1.5 py-0.5 rounded-[4px] bg-warning/10 text-warning">未保存</span> : undefined}
        leadingAction={scope === 'research' ? (
          <HeaderIconButton
            icon={<FolderOpen className="h-4 w-4" />}
            tooltip={treeOpen ? '隐藏目录' : '显示目录'}
            aria-label={treeOpen ? '隐藏目录' : '显示目录'}
            aria-expanded={treeOpen}
            className={treeOpen ? 'bg-foreground/[0.04] text-foreground' : undefined}
            onClick={() => setTreeOpen(open => !open)}
          />
        ) : undefined}
        actions={
          <div className="flex items-center gap-1">
            {scope === 'research' && (
              <HeaderIconButton
                icon={<FileText className="h-4 w-4" />}
                tooltip="打开知识库"
                onClick={() => navigate(routes.view.knowledge())}
              />
            )}
            <HeaderIconButton
              icon={<RefreshCw className={cn('h-4 w-4', loadingTree && 'animate-spin')} />}
              tooltip="刷新目录"
              onClick={loadTree}
            />
          </div>
        }
      />
      {scope === 'research' && treeOpen && (
        <div className="absolute left-3 top-[50px] bottom-3 z-dropdown w-[280px] max-w-[calc(100%-24px)] rounded-[8px] border border-border/70 bg-background/95 shadow-middle backdrop-blur-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-3 py-3 border-b border-border/40">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-foreground">finance research</p>
                <p className="mt-1 text-[10px] text-muted-foreground truncate">{rootPath || '加载中'}</p>
              </div>
              <HeaderIconButton
                icon={<X className="h-3.5 w-3.5" />}
                tooltip="隐藏目录"
                aria-label="隐藏目录"
                onClick={() => setTreeOpen(false)}
              />
            </div>
          </div>
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-2">
              {loadingTree && entries.length === 0 ? (
                <div className="h-24 flex items-center justify-center"><Spinner className="text-muted-foreground" /></div>
              ) : visibleEntries.length > 0 ? (
                visibleEntries.map(entry => (
                  <FileTreeItem
                    key={entry.path}
                    entry={entry}
                    selectedPath={selectedPath}
                    onSelect={handleSelect}
                  />
                ))
              ) : (
                <div className="px-2 py-8 text-xs text-muted-foreground text-center">暂无 Markdown 文件</div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {scope === 'knowledge' && (
        <div className="h-12 px-4 border-t border-border/50 flex items-center gap-2 bg-background">
          <form onSubmit={handleKnowledgeSearch} className="flex w-full max-w-[460px] items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索知识材料"
                className="h-8 w-full rounded-[6px] border border-border/70 bg-background pl-8 pr-2 text-xs outline-none focus:border-primary/50"
              />
            </div>
            <Button size="sm" className="h-8 px-2.5 gap-1.5" disabled={searching}>
              <Search className="h-3.5 w-3.5" />
              {searching ? '搜索中' : '搜索'}
            </Button>
          </form>
          <HeaderIconButton
            icon={<FolderOpen className="h-4 w-4" />}
            tooltip="知识目录"
            aria-label="知识目录"
            className={knowledgePanelOpen && knowledgePanelMode === 'directory' ? 'bg-foreground/[0.04] text-foreground' : undefined}
            onClick={openKnowledgeDirectory}
          />
        </div>
      )}

      {scope === 'knowledge' && knowledgePanelOpen && (
        <div
          className="absolute left-3 top-[104px] bottom-3 z-dropdown max-w-[calc(100%-24px)] rounded-[8px] border border-border/70 bg-background/95 shadow-middle backdrop-blur-sm flex flex-col min-h-0 overflow-hidden"
          style={{ width: knowledgePanelWidth }}
        >
          <div className="px-3 py-3 border-b border-border/40">
            <div className="flex items-center gap-2">
              <div className="flex h-8 rounded-[6px] border border-border/60 bg-muted/[0.18] p-0.5">
                <button
                  type="button"
                  onClick={() => setKnowledgePanelMode('search')}
                  className={cn(
                    'h-7 px-2.5 rounded-[5px] text-xs transition-colors',
                    knowledgePanelMode === 'search' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  搜索结果
                </button>
                <button
                  type="button"
                  onClick={() => setKnowledgePanelMode('directory')}
                  className={cn(
                    'h-7 px-2.5 rounded-[5px] text-xs transition-colors',
                    knowledgePanelMode === 'directory' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  知识目录
                </button>
              </div>
              <div className="min-w-0 flex-1" />
              <HeaderIconButton
                icon={<X className="h-3.5 w-3.5" />}
                tooltip="关闭"
                aria-label="关闭"
                onClick={() => setKnowledgePanelOpen(false)}
              />
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="p-3">
              {knowledgePanelMode === 'search' ? (
                <section>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-[11px] font-medium text-foreground">搜索结果</h3>
                    {searchResults.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">{searchResults.length}</span>
                    )}
                  </div>
                  {searching ? (
                    <div className="h-16 flex items-center justify-center"><Spinner className="text-muted-foreground" /></div>
                  ) : searchResults.length > 0 ? (
                    <div className="space-y-1.5">
                      {searchResults.map(result => (
                        <button
                          key={result.path}
                          type="button"
                          onClick={() => handleKnowledgeResultSelect(result)}
                          className={cn(
                            'w-full rounded-[6px] border px-2.5 py-2 text-left transition-colors',
                            selectedPath === result.path
                              ? 'border-primary/30 bg-primary/10'
                              : 'border-border/60 bg-background hover:bg-foreground/[0.04]'
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{result.title}</span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">{result.sourceType === 'content' ? '内容' : '文件名'}</span>
                          </div>
                          <p className="mt-1 max-h-8 overflow-hidden text-[11px] leading-4 text-muted-foreground">{result.snippet}</p>
                          <p className="mt-1 truncate text-[10px] text-muted-foreground">{result.relativePath}</p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[6px] border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
                      {searchNote || '输入关键词查找可复用材料'}
                    </div>
                  )}
                </section>
              ) : (
                <section>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-[11px] font-medium text-foreground">知识目录</h3>
                    <span className="text-[10px] text-muted-foreground">knowledge</span>
                  </div>
                  {loadingTree && entries.length === 0 ? (
                    <div className="h-16 flex items-center justify-center"><Spinner className="text-muted-foreground" /></div>
                  ) : visibleEntries.length > 0 ? (
                    <div>
                      {visibleEntries.map(entry => (
                        <FileTreeItem
                          key={entry.path}
                          entry={entry}
                          selectedPath={selectedPath}
                          onSelect={handleSelect}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[6px] border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
                      暂无知识材料，请将可复用资料放入 knowledge/
                    </div>
                  )}
                </section>
              )}
            </div>
          </ScrollArea>
          <div
            className="absolute inset-y-0 right-0 w-2 cursor-col-resize"
            role="separator"
            aria-label="调整知识库抽屉宽度"
            onMouseDown={beginKnowledgePanelResize}
          >
            <div className="mx-auto h-full w-px bg-border/70" />
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex border-t border-border/50">
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="h-12 px-4 border-b border-border/50 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{selectedName}</div>
              <div className="text-[11px] text-muted-foreground truncate">{selectedDisplayPath}</div>
            </div>
            {notice && <span className="text-[11px] text-success">{notice}</span>}
            {selectedExternalPath && (
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HeaderIconButton
                      icon={<FolderOpen className="h-4 w-4" />}
                      tooltip="在文件夹中显示"
                      onClick={() => window.electronAPI.showInFolder(selectedExternalPath)}
                    />
                  </TooltipTrigger>
                  <TooltipContent>在文件夹中显示</TooltipContent>
                </Tooltip>
                <HeaderIconButton
                  icon={<ExternalLink className="h-4 w-4" />}
                  tooltip="用系统应用打开"
                  onClick={() => window.electronAPI.openFile(selectedExternalPath)}
                />
                {selectedEntry && (
                  <Button
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={!dirty || saving || loadingFile}
                    onClick={handleSave}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {saving ? '保存中' : '保存'}
                  </Button>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="mx-4 mt-3 px-3 py-2 rounded-[6px] bg-destructive/10 text-destructive text-xs flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-auto">
            {loadingFile ? (
              <div className="h-full flex items-center justify-center"><Spinner className="text-muted-foreground" /></div>
            ) : selectedEntry ? (
              <TiptapMarkdownEditor
                key={selectedEntry.path}
                content={content}
                onUpdate={setContent}
                placeholder={scope === 'knowledge' ? '沉淀可复用事实、来源、上下文和待核验问题...' : '记录研究假设、证据链、估值判断和待验证问题...'}
                className="min-h-full px-6 py-5 prose-sm"
                editable
              />
            ) : externalSelection ? (
              <div className="h-full flex items-center justify-center px-6">
                <div className="w-full max-w-[520px] rounded-[8px] border border-border/70 bg-background p-5">
                  <div className="flex items-start gap-3">
                    <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-medium text-foreground">{externalSelection.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">此材料不是可内嵌编辑的 Markdown 文件，请用系统应用查看。</p>
                      <p className="mt-3 max-h-20 overflow-hidden text-xs leading-5 text-muted-foreground">{externalSelection.snippet}</p>
                      <p className="mt-3 truncate text-[11px] text-muted-foreground">{externalSelection.relativePath}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <Button size="sm" className="h-8 gap-1.5" onClick={() => window.electronAPI.openFile(externalSelection.path)}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      用系统应用打开
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => window.electronAPI.showInFolder(externalSelection.path)}>
                      <FolderOpen className="h-3.5 w-3.5" />
                      在文件夹中显示
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {scope === 'knowledge'
                  ? '搜索或从知识目录中选择材料'
                  : '从目录中选择公司研究、行业研究、报告或模板'}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
