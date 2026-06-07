import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'

let currentWorkspaceRoot = ''
let currentResearchRoot = ''
let currentKnowledgeBaseEnabled = true

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (workspaceId: string) => {
    if (workspaceId !== 'ws-1' || !currentWorkspaceRoot) return null
    return { id: 'ws-1', name: 'Test Workspace', rootPath: currentWorkspaceRoot }
  },
}))

mock.module('@craft-agent/shared/workspaces', () => ({
  FINANCE_RESEARCH_DIRS: ['companies', 'industries', 'reports', 'knowledge', 'templates'],
  loadWorkspaceConfig: () => ({
    finance: {
      enabled: true,
      researchDirectory: currentResearchRoot,
      marketScope: 'cn-hk',
      dataProvider: 'ifind',
      knowledgeBaseEnabled: currentKnowledgeBaseEnabled,
    },
  }),
}))

const { registerFilesHandlers } = await import('./files')

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {
      return undefined
    },
  }

  const deps: HandlerDeps = {
    sessionManager: {} as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      imageProcessor: {
        getMetadata: async () => null,
        process: async () => Buffer.from(''),
      },
    },
  }

  registerFilesHandlers(server, deps)

  const list = handlers.get(RPC_CHANNELS.file.LIST_WORKSPACE_RESEARCH_FILES)
  const searchKnowledge = handlers.get(RPC_CHANNELS.file.SEARCH_WORKSPACE_KNOWLEDGE)
  const writeMarkdown = handlers.get(RPC_CHANNELS.file.WRITE_WORKSPACE_MARKDOWN)
  const createItem = handlers.get(RPC_CHANNELS.file.CREATE_WORKSPACE_RESEARCH_ITEM)
  const deleteItem = handlers.get(RPC_CHANNELS.file.DELETE_WORKSPACE_RESEARCH_ITEM)
  if (!list || !searchKnowledge || !writeMarkdown || !createItem || !deleteItem) throw new Error('research workspace handlers not registered')

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId: 'ws-1',
    webContentsId: 101,
  }

  return { list, searchKnowledge, writeMarkdown, createItem, deleteItem, ctx }
}

async function createWorkspace() {
  currentWorkspaceRoot = await mkdtemp(join(tmpdir(), 'craft-agent-research-rpc-'))
  currentResearchRoot = currentWorkspaceRoot
  for (const dir of ['companies', 'industries', 'reports', 'knowledge', 'templates']) {
    await mkdir(join(currentResearchRoot, dir), { recursive: true })
  }
}

beforeEach(async () => {
  await createWorkspace()
})

afterEach(async () => {
  if (currentWorkspaceRoot) {
    await rm(currentWorkspaceRoot, { recursive: true, force: true })
  }
  currentWorkspaceRoot = ''
  currentResearchRoot = ''
  currentKnowledgeBaseEnabled = true
})

describe('research workspace file RPC handlers', () => {
  it('lists finance research folders and Markdown files only', async () => {
    const companyFile = join(currentResearchRoot, 'companies', 'maotai.md')
    await writeFile(companyFile, '# Maotai\n', 'utf-8')
    await writeFile(join(currentResearchRoot, 'companies', 'raw.pdf'), 'not markdown', 'utf-8')

    const { list, ctx } = createHarness()
    const result = await list(ctx, 'ws-1') as { rootPath: string; entries: Array<{ name: string; children?: Array<{ name: string }> }> }

    expect(result.rootPath).toBe(currentResearchRoot)
    expect(result.entries.map(entry => entry.name)).toEqual(['companies', 'industries', 'reports', 'knowledge', 'templates'])
    expect(result.entries[0].children?.map(entry => entry.name)).toEqual(['maotai.md'])
  })

  it('searches only the knowledge directory for content matches', async () => {
    await writeFile(join(currentResearchRoot, 'knowledge', 'policy.md'), '# Policy\nrenewable subsidy catalyst\n', 'utf-8')
    await writeFile(join(currentResearchRoot, 'companies', 'company.md'), '# Company\nrenewable subsidy catalyst\n', 'utf-8')

    const { searchKnowledge, ctx } = createHarness()
    const result = await searchKnowledge(ctx, 'ws-1', 'renewable subsidy', 10) as {
      resultCount: number
      results: Array<{ relativePath: string; title: string; sourceType: string }>
    }

    expect(result.resultCount).toBe(1)
    expect(result.results[0]).toMatchObject({
      relativePath: 'knowledge/policy.md',
      title: 'Policy',
      sourceType: 'content',
    })
  })

  it('returns filename matches for binary knowledge materials', async () => {
    await writeFile(join(currentResearchRoot, 'knowledge', 'battery-sector.pdf'), 'not a real pdf', 'utf-8')

    const { searchKnowledge, ctx } = createHarness()
    const result = await searchKnowledge(ctx, 'ws-1', 'battery', 10) as {
      resultCount: number
      results: Array<{ relativePath: string; sourceType: string; snippet: string }>
    }

    expect(result.resultCount).toBe(1)
    expect(result.results[0].relativePath).toBe('knowledge/battery-sector.pdf')
    expect(result.results[0].sourceType).toBe('filename')
    expect(result.results[0].snippet).toContain('Binary or large file')
  })

  it('returns an empty note for blank knowledge searches', async () => {
    const { searchKnowledge, ctx } = createHarness()
    const result = await searchKnowledge(ctx, 'ws-1', '   ', 10) as { resultCount: number; note?: string }

    expect(result.resultCount).toBe(0)
    expect(result.note).toContain('Enter a search query')
  })

  it('returns an empty note when the knowledge base is disabled', async () => {
    currentKnowledgeBaseEnabled = false
    await writeFile(join(currentResearchRoot, 'knowledge', 'policy.md'), '# Policy\nrenewable subsidy catalyst\n', 'utf-8')

    const { searchKnowledge, ctx } = createHarness()
    const result = await searchKnowledge(ctx, 'ws-1', 'renewable', 10) as { resultCount: number; note?: string }

    expect(result.resultCount).toBe(0)
    expect(result.note).toContain('disabled')
  })

  it('rejects knowledge search when the configured research root escapes the workspace', async () => {
    currentResearchRoot = resolve(currentWorkspaceRoot, '..', 'outside-research-root')

    const { searchKnowledge, ctx } = createHarness()
    await expect(searchKnowledge(ctx, 'ws-1', 'policy', 10)).rejects.toThrow('outside the workspace')
  })

  it('writes Markdown when mtime matches', async () => {
    const file = join(currentResearchRoot, 'reports', 'weekly.md')
    await writeFile(file, '# Old\n', 'utf-8')
    const before = await stat(file)

    const { writeMarkdown, ctx } = createHarness()
    const result = await writeMarkdown(ctx, file, '# New\n', before.mtimeMs) as { ok: boolean; mtimeMs: number }

    expect(result.ok).toBe(true)
    expect(result.mtimeMs).toBeGreaterThanOrEqual(before.mtimeMs)
  })

  it('rejects stale Markdown writes', async () => {
    const file = join(currentResearchRoot, 'reports', 'stale.md')
    await writeFile(file, '# Current\n', 'utf-8')
    const current = await stat(file)

    const { writeMarkdown, ctx } = createHarness()
    await expect(writeMarkdown(ctx, file, '# Old write\n', current.mtimeMs - 10_000)).rejects.toThrow('Stale write rejected')
  })

  it('rejects writes outside the research folders', async () => {
    const outside = resolve(currentWorkspaceRoot, 'notes.md')
    await writeFile(outside, '# Outside\n', 'utf-8')

    const { writeMarkdown, ctx } = createHarness()
    await expect(writeMarkdown(ctx, outside, '# Bad\n')).rejects.toThrow('limited to finance research folders')
  })

  it('rejects non-Markdown writes', async () => {
    const file = join(currentResearchRoot, 'reports', 'data.txt')
    await writeFile(file, 'data', 'utf-8')

    const { writeMarkdown, ctx } = createHarness()
    await expect(writeMarkdown(ctx, file, 'data')).rejects.toThrow('Only .md and .markdown files')
  })

  it('creates Markdown files in a research folder', async () => {
    const { createItem, ctx } = createHarness()
    const result = await createItem(ctx, 'ws-1', join(currentResearchRoot, 'reports'), 'generated.md', 'file', '# Generated\n') as {
      ok: boolean
      entry: { name: string; relativePath: string; type: string }
    }

    expect(result.ok).toBe(true)
    expect(result.entry).toMatchObject({
      name: 'generated.md',
      relativePath: 'reports/generated.md',
      type: 'file',
    })
    expect(await readFile(join(currentResearchRoot, 'reports', 'generated.md'), 'utf-8')).toBe('# Generated\n')
  })

  it('creates and deletes nested research folders', async () => {
    const { createItem, deleteItem, ctx } = createHarness()
    const created = await createItem(ctx, 'ws-1', join(currentResearchRoot, 'companies'), 'sector-notes', 'directory') as {
      entry: { path: string; relativePath: string; type: string }
    }

    expect(created.entry).toMatchObject({
      relativePath: 'companies/sector-notes',
      type: 'directory',
    })

    const deleted = await deleteItem(ctx, 'ws-1', created.entry.path) as { ok: boolean }
    expect(deleted.ok).toBe(true)
    await expect(stat(created.entry.path)).rejects.toThrow()
  })

  it('rejects non-Markdown research file creation', async () => {
    const { createItem, ctx } = createHarness()
    await expect(createItem(ctx, 'ws-1', join(currentResearchRoot, 'reports'), 'data.txt', 'file', 'data')).rejects.toThrow('Only .md and .markdown files')
  })

  it('rejects deleting top-level finance research folders', async () => {
    const { deleteItem, ctx } = createHarness()
    await expect(deleteItem(ctx, 'ws-1', join(currentResearchRoot, 'reports'))).rejects.toThrow('Top-level finance research folders')
  })
})
