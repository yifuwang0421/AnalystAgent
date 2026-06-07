import { readFile, writeFile, unlink, mkdir, readdir, stat, rm } from 'fs/promises'
import { isAbsolute, join, resolve, dirname, relative, sep, parse as parsePath } from 'path'
import { homedir } from 'os'
import { validatePathFormat } from '../../utils/path-validation'
import { randomUUID } from 'crypto'
import {
  RPC_CHANNELS,
  type DirectoryListingResult,
  type FileAttachment,
  type WorkspaceKnowledgeSearchResult,
  type WorkspaceResearchFileEntry,
  type WorkspaceResearchFilesResult,
  type CreateWorkspaceResearchItemResult,
  type DeleteWorkspaceResearchItemResult,
  type WriteWorkspaceMarkdownResult,
  type WorkspaceResearchItemType,
} from '@craft-agent/shared/protocol'
import type { StoredAttachment } from '@craft-agent/core/types'
import { readFileAttachment, validateImageForClaudeAPI, IMAGE_LIMITS } from '@craft-agent/shared/utils'
import { getSessionAttachmentsPath, validateSessionId } from '@craft-agent/shared/sessions'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { FINANCE_RESEARCH_DIRS, loadWorkspaceConfig } from '@craft-agent/shared/workspaces'
import { resizeImageForAPI, inspectImageBuffer } from '@craft-agent/server-core/services'
import { sanitizeFilename, validateFilePath, getWorkspaceAllowedDirs } from '@craft-agent/server-core/handlers'
import { MarkItDown } from 'markitdown-js'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { requestClientOpenFileDialog } from '@craft-agent/server-core/transport'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.file.READ,
  RPC_CHANNELS.file.READ_DATA_URL,
  RPC_CHANNELS.file.READ_PREVIEW_DATA_URL,
  RPC_CHANNELS.file.READ_BINARY,
  RPC_CHANNELS.file.OPEN_DIALOG,
  RPC_CHANNELS.file.READ_ATTACHMENT,
  RPC_CHANNELS.file.READ_USER_ATTACHMENT,
  RPC_CHANNELS.file.STORE_ATTACHMENT,
  RPC_CHANNELS.file.GENERATE_THUMBNAIL,
  RPC_CHANNELS.file.LIST_WORKSPACE_RESEARCH_FILES,
  RPC_CHANNELS.file.SEARCH_WORKSPACE_KNOWLEDGE,
  RPC_CHANNELS.file.WRITE_WORKSPACE_MARKDOWN,
  RPC_CHANNELS.file.CREATE_WORKSPACE_RESEARCH_ITEM,
  RPC_CHANNELS.file.DELETE_WORKSPACE_RESEARCH_ITEM,
  RPC_CHANNELS.fs.SEARCH,
  RPC_CHANNELS.fs.LIST_DIRECTORY,
] as const

const MARKDOWN_FILE_EXTENSIONS = new Set(['.md', '.markdown'])
const KNOWLEDGE_TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.csv'])
const KNOWLEDGE_MAX_TEXT_BYTES = 512 * 1024

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

function toPosixRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

function assertWorkspaceResearchRoot(workspaceId: string): { rootPath: string; researchRoot: string; knowledgeBaseEnabled: boolean } {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

  const rootPath = resolve(workspace.rootPath)
  const config = loadWorkspaceConfig(rootPath)
  const financeConfig = config?.finance
  const researchRoot = resolve(financeConfig?.researchDirectory || rootPath)
  if (!isPathInside(rootPath, researchRoot)) {
    throw new Error('Configured finance research root is outside the workspace')
  }

  return {
    rootPath,
    researchRoot,
    knowledgeBaseEnabled: financeConfig?.knowledgeBaseEnabled !== false,
  }
}

async function listResearchEntry(rootPath: string, path: string): Promise<WorkspaceResearchFileEntry | null> {
  const info = await stat(path).catch(() => null)
  if (!info) return null

  const name = parsePath(path).base
  const relativePath = toPosixRelativePath(rootPath, path)
  if (info.isDirectory()) {
    const children = await readdir(path, { withFileTypes: true }).catch(() => [])
    const childEntries = await Promise.all(
      children
        .filter(entry => !entry.name.startsWith('.'))
        .map(entry => listResearchEntry(rootPath, join(path, entry.name)))
    )

    return {
      name,
      path,
      relativePath,
      type: 'directory',
      mtimeMs: info.mtimeMs,
      children: childEntries
        .filter((entry): entry is WorkspaceResearchFileEntry => entry !== null)
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
          return a.name.localeCompare(b.name)
        }),
    }
  }

  if (!info.isFile() || !MARKDOWN_FILE_EXTENSIONS.has(parsePath(path).ext.toLowerCase())) return null

  return {
    name,
    path,
    relativePath,
    type: 'file',
    mtimeMs: info.mtimeMs,
    size: info.size,
  }
}

async function walkFiles(rootPath: string): Promise<string[]> {
  const results: string[] = []
  const queue = [rootPath]
  while (queue.length > 0) {
    const current = queue.shift()!
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const nextPath = join(current, entry.name)
      if (entry.isDirectory()) queue.push(nextPath)
      else if (entry.isFile()) results.push(nextPath)
    }
  }
  return results
}

function titleFromMarkdown(content: string, fallback: string): string {
  const heading = content.split(/\r?\n/).find(line => line.trim().startsWith('# '))
  return heading?.replace(/^#\s+/, '').trim() || fallback
}

function snippetForMatch(content: string, query: string): string {
  const lowerContent = content.toLowerCase()
  const index = lowerContent.indexOf(query.toLowerCase())
  if (index === -1) return content.trim().slice(0, 180)
  const start = Math.max(0, index - 70)
  const end = Math.min(content.length, index + query.length + 90)
  return content.slice(start, end).replace(/\s+/g, ' ').trim()
}

function assertMarkdownWriteTarget(researchRoot: string, path: string): void {
  const ext = parsePath(path).ext.toLowerCase()
  if (!MARKDOWN_FILE_EXTENSIONS.has(ext)) {
    throw new Error('Only .md and .markdown files can be written from the research workspace')
  }

  const allowed = FINANCE_RESEARCH_DIRS.some(dir => isPathInside(resolve(researchRoot, dir), path))
  if (!allowed) {
    throw new Error('Markdown writes are limited to finance research folders')
  }
}

function assertResearchItemTarget(researchRoot: string, path: string): void {
  const allowed = FINANCE_RESEARCH_DIRS.some(dir => isPathInside(resolve(researchRoot, dir), path))
  if (!allowed) {
    throw new Error('Research workspace file operations are limited to finance research folders')
  }
}

function assertNotTopLevelResearchDir(researchRoot: string, path: string): void {
  const isTopLevelDir = FINANCE_RESEARCH_DIRS.some(dir => resolve(researchRoot, dir) === path)
  if (isTopLevelDir) {
    throw new Error('Top-level finance research folders cannot be deleted')
  }
}

function normalizeResearchItemName(rawName: string): string {
  const name = typeof rawName === 'string' ? rawName.trim() : ''
  if (!name) throw new Error('Name is required')
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error('Name cannot contain path separators')
  }
  if (name.startsWith('.')) {
    throw new Error('Hidden files and folders are not supported in the research workspace')
  }
  return name
}

export function registerFilesHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.file.LIST_WORKSPACE_RESEARCH_FILES, async (ctx, workspaceId?: string): Promise<WorkspaceResearchFilesResult> => {
    const targetWorkspaceId = workspaceId ?? ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
    if (!targetWorkspaceId) throw new Error('Workspace id is required')

    const { researchRoot } = assertWorkspaceResearchRoot(targetWorkspaceId)
    const entries = await Promise.all(
      FINANCE_RESEARCH_DIRS.map(dir => listResearchEntry(researchRoot, join(researchRoot, dir)))
    )

    return {
      rootPath: researchRoot,
      entries: entries.filter((entry): entry is WorkspaceResearchFileEntry => entry !== null),
    }
  })

  server.handle(RPC_CHANNELS.file.SEARCH_WORKSPACE_KNOWLEDGE, async (
    ctx,
    workspaceId?: string,
    rawQuery?: string,
    rawMaxResults?: number
  ) => {
    const targetWorkspaceId = workspaceId ?? ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
    if (!targetWorkspaceId) throw new Error('Workspace id is required')

    const query = typeof rawQuery === 'string' ? rawQuery.trim() : ''
    const maxResults = Number.isFinite(rawMaxResults) ? Math.max(1, Math.min(50, Math.floor(rawMaxResults!))) : 12
    if (!query) {
      return { results: [], resultCount: 0, note: 'Enter a search query to find reusable knowledge materials.' }
    }

    const { researchRoot, knowledgeBaseEnabled } = assertWorkspaceResearchRoot(targetWorkspaceId)
    if (!knowledgeBaseEnabled) {
      return { results: [], resultCount: 0, note: 'Knowledge base search is disabled for this workspace.' }
    }

    const knowledgeRoot = resolve(researchRoot, 'knowledge')
    if (!isPathInside(researchRoot, knowledgeRoot)) {
      throw new Error('Knowledge directory is outside the workspace')
    }

    const lowerQuery = query.toLowerCase()
    const files = await walkFiles(knowledgeRoot)
    const results: WorkspaceKnowledgeSearchResult[] = []

    for (const file of files) {
      if (results.length >= maxResults) break
      if (!isPathInside(knowledgeRoot, file)) continue

      const info = await stat(file).catch(() => null)
      if (!info || !info.isFile()) continue

      const relativePath = toPosixRelativePath(researchRoot, file)
      const name = parsePath(file).base
      const ext = parsePath(file).ext.toLowerCase()
      const filenameMatches = name.toLowerCase().includes(lowerQuery) || relativePath.toLowerCase().includes(lowerQuery)

      if (KNOWLEDGE_TEXT_EXTENSIONS.has(ext) && info.size <= KNOWLEDGE_MAX_TEXT_BYTES) {
        const content = await readFile(file, 'utf-8').catch(() => '')
        if (content.toLowerCase().includes(lowerQuery)) {
          results.push({
            title: titleFromMarkdown(content, name),
            path: file,
            relativePath,
            snippet: snippetForMatch(content, query),
            sourceType: 'content',
            mtimeMs: info.mtimeMs,
            size: info.size,
          })
          continue
        }
      }

      if (filenameMatches) {
        results.push({
          title: name,
          path: file,
          relativePath,
          snippet: 'Binary or large file matched by filename. Open it with the system app to inspect the material.',
          sourceType: 'filename',
          mtimeMs: info.mtimeMs,
          size: info.size,
        })
      }
    }

    return {
      results,
      resultCount: results.length,
      note: results.length === 0 ? 'No matching knowledge materials found.' : undefined,
    }
  })

  server.handle(RPC_CHANNELS.file.WRITE_WORKSPACE_MARKDOWN, async (
    ctx,
    path: string,
    content: string,
    expectedMtimeMs?: number
  ): Promise<WriteWorkspaceMarkdownResult> => {
    const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
    if (!workspaceId) throw new Error('Workspace id is required')

    const { researchRoot } = assertWorkspaceResearchRoot(workspaceId)
    const targetPath = resolve(path)
    if (!isPathInside(researchRoot, targetPath)) {
      throw new Error('Markdown writes are limited to finance research folders')
    }
    assertMarkdownWriteTarget(researchRoot, targetPath)

    const current = await stat(targetPath).catch(() => null)
    if (typeof expectedMtimeMs === 'number' && current && Math.abs(current.mtimeMs - expectedMtimeMs) > 1) {
      throw new Error('Stale write rejected because the file changed on disk')
    }

    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, content, 'utf-8')
    const next = await stat(targetPath)
    return { ok: true, mtimeMs: next.mtimeMs }
  })

  server.handle(RPC_CHANNELS.file.CREATE_WORKSPACE_RESEARCH_ITEM, async (
    ctx,
    workspaceId: string | undefined,
    parentPath: string,
    rawName: string,
    type: WorkspaceResearchItemType,
    content?: string
  ): Promise<CreateWorkspaceResearchItemResult> => {
    const targetWorkspaceId = workspaceId ?? ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
    if (!targetWorkspaceId) throw new Error('Workspace id is required')
    if (type !== 'file' && type !== 'directory') throw new Error('Unsupported research item type')

    const { researchRoot } = assertWorkspaceResearchRoot(targetWorkspaceId)
    const safeParent = resolve(parentPath)
    if (!isPathInside(researchRoot, safeParent)) {
      throw new Error('Research workspace file operations are limited to finance research folders')
    }
    assertResearchItemTarget(researchRoot, safeParent)

    const name = normalizeResearchItemName(rawName)
    const targetPath = resolve(safeParent, name)
    if (!isPathInside(safeParent, targetPath)) {
      throw new Error('Research item path must stay inside the selected folder')
    }
    assertResearchItemTarget(researchRoot, targetPath)

    const existing = await stat(targetPath).catch(() => null)
    if (existing) throw new Error('A file or folder already exists at this path')

    if (type === 'directory') {
      await mkdir(targetPath, { recursive: false })
    } else {
      assertMarkdownWriteTarget(researchRoot, targetPath)
      await writeFile(targetPath, content ?? '', 'utf-8')
    }

    const entry = await listResearchEntry(researchRoot, targetPath)
    if (!entry) throw new Error('Created item is not visible in the research workspace')
    return { ok: true, entry }
  })

  server.handle(RPC_CHANNELS.file.DELETE_WORKSPACE_RESEARCH_ITEM, async (
    ctx,
    workspaceId: string | undefined,
    path: string
  ): Promise<DeleteWorkspaceResearchItemResult> => {
    const targetWorkspaceId = workspaceId ?? ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
    if (!targetWorkspaceId) throw new Error('Workspace id is required')

    const { researchRoot } = assertWorkspaceResearchRoot(targetWorkspaceId)
    const targetPath = resolve(path)
    if (!isPathInside(researchRoot, targetPath)) {
      throw new Error('Research workspace file operations are limited to finance research folders')
    }
    assertResearchItemTarget(researchRoot, targetPath)
    assertNotTopLevelResearchDir(researchRoot, targetPath)

    const info = await stat(targetPath).catch(() => null)
    if (!info) throw new Error('File or folder does not exist')
    if (info.isDirectory()) {
      await rm(targetPath, { recursive: true, force: false })
    } else if (info.isFile()) {
      await unlink(targetPath)
    } else {
      throw new Error('Only files and folders can be deleted from the research workspace')
    }

    return { ok: true }
  })

  // Read a file (with path validation to prevent traversal attacks)
  server.handle(RPC_CHANNELS.file.READ, async (ctx, path: string) => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getWorkspaceAllowedDirs(workspaceId))
      const content = await readFile(safePath, 'utf-8')
      return content
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      // ENOENT is expected for optional config files (e.g. automations.json)
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        deps.platform.logger.debug('readFile: file not found:', path)
      } else {
        deps.platform.logger.error('readFile error:', path, message)
      }
      throw new Error(`Failed to read file: ${message}`)
    }
  })

  // Read an image file as a data URL for in-app image preview overlays.
  // Returns data:{mime};base64,{content} — used by ImagePreviewOverlay and markdown image blocks.
  server.handle(RPC_CHANNELS.file.READ_DATA_URL, async (ctx, path: string) => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getWorkspaceAllowedDirs(workspaceId))
      const buffer = await readFile(safePath)
      const ext = safePath.split('.').pop()?.toLowerCase() ?? ''

      // Map previewable image extensions to MIME types.
      // HEIC/HEIF/TIFF are intentionally excluded — no Chromium codec, opened externally instead.
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        bmp: 'image/bmp',
        ico: 'image/x-icon',
        avif: 'image/avif',
      }
      const mime = mimeMap[ext] || 'application/octet-stream'
      const base64 = buffer.toString('base64')
      return `data:${mime};base64,${base64}`
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('readFileDataUrl error:', message)
      throw new Error(`Failed to read file as data URL: ${message}`)
    }
  })

  // Read an image file as a small preview data URL for lightweight thumbnail rendering.
  // Returns a PNG data URL resized to fit within maxSize×maxSize.
  server.handle(RPC_CHANNELS.file.READ_PREVIEW_DATA_URL, async (ctx, path: string, maxSize = 64) => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getWorkspaceAllowedDirs(workspaceId))
      const size = Number.isFinite(maxSize) ? Math.max(16, Math.min(256, Math.floor(maxSize))) : 64
      const preview = await deps.platform.imageProcessor.process(safePath, {
        resize: { width: size, height: size },
        fit: 'inside',
        format: 'png',
      })
      return `data:image/png;base64,${preview.toString('base64')}`
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('readFilePreviewDataUrl error:', message)
      throw new Error(`Failed to read file preview: ${message}`)
    }
  })

  // Read a file as raw binary (Uint8Array) for react-pdf.
  // The WS transport codec preserves Uint8Array payloads over JSON envelopes.
  server.handle(RPC_CHANNELS.file.READ_BINARY, async (ctx, path: string) => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getWorkspaceAllowedDirs(workspaceId))
      const buffer = await readFile(safePath)
      // Return as Uint8Array (serializes to ArrayBuffer over IPC)
      return new Uint8Array(buffer)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('readFileBinary error:', message)
      throw new Error(`Failed to read file as binary: ${message}`)
    }
  })

  // Open native file dialog for selecting files to attach (routed to client)
  server.handle(RPC_CHANNELS.file.OPEN_DIALOG, async (ctx) => {
    const result = await requestClientOpenFileDialog(server, ctx.clientId, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        // Allow all files by default - the agent can figure out how to handle them
        { name: 'All Files', extensions: ['*'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'] },
        { name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'txt', 'md', 'rtf'] },
        { name: 'Code', extensions: ['js', 'ts', 'tsx', 'jsx', 'py', 'json', 'css', 'html', 'xml', 'yaml', 'yml', 'sh', 'sql', 'go', 'rs', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'swift', 'kt'] },
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  // Read file and return as FileAttachment with Quick Look thumbnail
  server.handle(RPC_CHANNELS.file.READ_ATTACHMENT, async (ctx, path: string) => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getWorkspaceAllowedDirs(workspaceId))
      // Use shared utility that handles file type detection, encoding, etc.
      const attachment = await readFileAttachment(safePath)
      if (!attachment) return null

      // Generate thumbnail for image preview
      // Only works for image formats the processor supports — PDFs/Office files get icon fallback
      try {
        const thumbBuffer = await deps.platform.imageProcessor.process(safePath, {
          resize: { width: 200, height: 200 },
          format: 'png',
        })
        ;(attachment as { thumbnailBase64?: string }).thumbnailBase64 = thumbBuffer.toString('base64')
      } catch (thumbError) {
        // Thumbnail generation failed (non-image file or corrupt) — icon fallback
        deps.platform.logger.info('Thumbnail generation failed (using fallback):', thumbError instanceof Error ? thumbError.message : thumbError)
      }

      return attachment
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('readFileAttachment error:', message)
      return null
    }
  })

  // Read a user-attached file (bypasses workspace-dir validation).
  // Used only by renderer draft hydration: the path was written to drafts.json by a
  // previous user-initiated OS-picker / Finder-drag attach, so the path implies consent.
  // NOT exposed to agent code — no equivalent MCP tool. Kept separate from readFileAttachment
  // on purpose to preserve the agent-facing read's narrow trust boundary.
  const USER_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024
  server.handle(RPC_CHANNELS.file.READ_USER_ATTACHMENT, async (_ctx, path: string) => {
    try {
      if (!path || typeof path !== 'string' || !isAbsolute(path)) return null
      const info = await stat(path).catch(() => null)
      if (!info || !info.isFile()) return null
      if (info.size > USER_ATTACHMENT_MAX_BYTES) {
        deps.platform.logger.warn(`[readUserAttachment] file exceeds ${USER_ATTACHMENT_MAX_BYTES} bytes, skipping: ${path}`)
        return null
      }
      const attachment = readFileAttachment(path)
      if (!attachment) return null
      try {
        const thumbBuffer = await deps.platform.imageProcessor.process(path, {
          resize: { width: 200, height: 200 },
          format: 'png',
        })
        ;(attachment as { thumbnailBase64?: string }).thumbnailBase64 = thumbBuffer.toString('base64')
      } catch {
        // Non-image or corrupt — icon fallback, same as readFileAttachment
      }
      return attachment
    } catch (error) {
      deps.platform.logger.error('readUserAttachment error:', error instanceof Error ? error.message : error)
      return null
    }
  })

  // Generate thumbnail from base64 data (for drag-drop files where we don't have a path)
  server.handle(RPC_CHANNELS.file.GENERATE_THUMBNAIL, async (_ctx, base64: string, _mimeType: string): Promise<string | null> => {
    try {
      const buffer = Buffer.from(base64, 'base64')
      const thumbBuffer = await deps.platform.imageProcessor.process(buffer, {
        resize: { width: 200, height: 200 },
        format: 'png',
      })
      return thumbBuffer.toString('base64')
    } catch (error) {
      deps.platform.logger.info('generateThumbnail failed:', error instanceof Error ? error.message : error)
      return null
    }
  })

  // Store an attachment to disk and generate thumbnail/markdown conversion
  // This is the core of the persistent file attachment system
  server.handle(RPC_CHANNELS.file.STORE_ATTACHMENT, async (ctx, sessionId: string, attachment: FileAttachment): Promise<StoredAttachment> => {
    // Track files we've written for cleanup on error
    const filesToCleanup: string[] = []

    try {
      // Reject empty files early
      if (attachment.size === 0) {
        throw new Error('Cannot attach empty file')
      }

      // Get workspace slug from the calling window
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      if (!workspaceId) {
        throw new Error('Cannot determine workspace for attachment storage')
      }
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) {
        throw new Error(`Workspace not found: ${workspaceId}`)
      }
      const workspaceRootPath = workspace.rootPath

      // SECURITY: Validate sessionId to prevent path traversal attacks
      // This must happen before using sessionId in any file path operations
      validateSessionId(sessionId)

      // Create attachments directory if it doesn't exist
      const attachmentsDir = getSessionAttachmentsPath(workspaceRootPath, sessionId)
      await mkdir(attachmentsDir, { recursive: true })

      // Generate unique ID for this attachment
      const id = randomUUID()
      const safeName = sanitizeFilename(attachment.name)
      const storedFileName = `${id}_${safeName}`
      const storedPath = join(attachmentsDir, storedFileName)

      // Track if image was resized (for return value)
      let wasResized = false
      let finalSize = attachment.size
      let resizedBase64: string | undefined

      // 1. Save the file (with image validation and resizing)
      if (attachment.base64) {
        // Images, PDFs, Office files - decode from base64
        let decoded: Buffer = Buffer.from(attachment.base64, 'base64')
        // Validate decoded size matches expected (allow small variance for encoding overhead)
        if (Math.abs(decoded.length - attachment.size) > 100) {
          throw new Error(`Attachment corrupted: size mismatch (expected ${attachment.size}, got ${decoded.length})`)
        }

        // For images: validate and resize if needed for Claude API compatibility
        if (attachment.type === 'image') {
          const imageInspection = await inspectImageBuffer(decoded, deps.platform.imageProcessor)
          const imageSize = imageInspection.status === 'ok'
            ? { width: imageInspection.width, height: imageInspection.height }
            : null

          // Determine if we should resize
          let shouldResize = false
          let targetSize: { width: number; height: number } | undefined

          if (imageInspection.status === 'processor_unavailable') {
            deps.platform.logger.warn('Image processing unavailable while validating attachment:', imageInspection.error?.message ?? 'unknown error')
            if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
              throw new Error('Image processing is unavailable, so oversized images cannot be validated or resized automatically. Please attach a smaller image.')
            }
          } else if (imageInspection.status === 'invalid_image') {
            throw new Error(imageInspection.error?.message || 'Invalid or unsupported image file')
          } else {
            // Validate image for Claude API
            const validation = validateImageForClaudeAPI(decoded.length, imageSize!.width, imageSize!.height)

            shouldResize = validation.needsResize ?? false
            targetSize = validation.suggestedSize

            if (!validation.valid && validation.errorCode === 'dimension_exceeded') {
              // Image exceeds 8000px limit - calculate resize to fit within limits
              const maxDim = IMAGE_LIMITS.MAX_DIMENSION
              const scale = Math.min(maxDim / imageSize!.width, maxDim / imageSize!.height)
              targetSize = {
                width: Math.floor(imageSize!.width * scale),
                height: Math.floor(imageSize!.height * scale),
              }
              shouldResize = true
              deps.platform.logger.info(`Image exceeds ${maxDim}px limit (${imageSize!.width}x${imageSize!.height}), will resize to ${targetSize.width}x${targetSize.height}`)
            } else if (!validation.valid && validation.errorCode === 'size_exceeded') {
              // File >5MB — try resize+compress instead of rejecting
              shouldResize = true
              deps.platform.logger.info(`Image exceeds 5MB (${(decoded.length / 1024 / 1024).toFixed(1)}MB), will attempt resize`)
            } else if (!validation.valid) {
              throw new Error(validation.error)
            }
          }

          // If resize is needed (either recommended or required), do it now
          if (shouldResize) {
            const isPhoto = attachment.mimeType === 'image/jpeg'

            if (targetSize) {
              // Dimension-exceeded: resize to specific target dimensions
              deps.platform.logger.info(`Resizing image from ${imageSize!.width}x${imageSize!.height} to ${targetSize.width}x${targetSize.height}`)
              try {
                decoded = await deps.platform.imageProcessor.process(decoded, {
                  resize: { width: targetSize.width, height: targetSize.height },
                  format: isPhoto ? 'jpeg' : 'png',
                  quality: isPhoto ? IMAGE_LIMITS.JPEG_QUALITY_HIGH : undefined,
                })
                wasResized = true
                finalSize = decoded.length

                // Re-validate final size after resize
                if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
                  decoded = await deps.platform.imageProcessor.process(decoded, { format: 'jpeg', quality: IMAGE_LIMITS.JPEG_QUALITY_FALLBACK })
                  finalSize = decoded.length
                  if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
                    throw new Error(`Image still too large after resize (${(decoded.length / 1024 / 1024).toFixed(1)}MB). Please use a smaller image.`)
                  }
                }
              } catch (resizeError) {
                deps.platform.logger.error('Image resize failed:', resizeError)
                const reason = resizeError instanceof Error ? resizeError.message : String(resizeError)
                throw new Error(`Image too large (${imageSize!.width}x${imageSize!.height}) and automatic resize failed: ${reason}. Please manually resize it before attaching.`)
              }
            } else {
              // Size-exceeded or optimal resize — use shared utility for full pipeline
              const result = await resizeImageForAPI(decoded, { isPhoto })
              if (!result) {
                throw new Error(`Image too large (${(decoded.length / 1024 / 1024).toFixed(1)}MB) and could not be compressed enough. Please use a smaller image.`)
              }
              decoded = result.buffer
              wasResized = true
              finalSize = decoded.length
            }

            deps.platform.logger.info(`Image resized: ${attachment.size} -> ${finalSize} bytes (${Math.round((1 - finalSize / attachment.size) * 100)}% reduction)`)

            // Store resized base64 to return to renderer
            // This is used when sending to Claude API instead of original large base64
            resizedBase64 = decoded.toString('base64')
          }
        }

        await writeFile(storedPath, decoded)
        filesToCleanup.push(storedPath)
      } else if (attachment.text) {
        // Text files - save as UTF-8
        await writeFile(storedPath, attachment.text, 'utf-8')
        filesToCleanup.push(storedPath)
      } else {
        throw new Error('Attachment has no content (neither base64 nor text)')
      }

      // 2. Generate thumbnail (images only — PDFs/Office get icon fallback)
      let thumbnailPath: string | undefined
      let thumbnailBase64: string | undefined
      const thumbFileName = `${id}_thumb.png`
      const thumbPath = join(attachmentsDir, thumbFileName)
      try {
        const pngBuffer = await deps.platform.imageProcessor.process(storedPath, {
          resize: { width: 200, height: 200 },
          format: 'png',
        })
        await writeFile(thumbPath, pngBuffer)
        thumbnailPath = thumbPath
        thumbnailBase64 = pngBuffer.toString('base64')
        filesToCleanup.push(thumbPath)
      } catch (thumbError) {
        // Thumbnail generation failed (non-image or corrupt) — icon fallback
        deps.platform.logger.info('Thumbnail generation failed (using fallback):', thumbError instanceof Error ? thumbError.message : thumbError)
      }

      // 3. Convert Office files to markdown (for sending to Claude)
      // This is required for Office files - Claude can't read raw Office binary
      let markdownPath: string | undefined
      if (attachment.type === 'office') {
        const mdFileName = `${id}_${safeName}.md`
        const mdPath = join(attachmentsDir, mdFileName)
        try {
          const markitdown = new MarkItDown()
          const result = await markitdown.convert(storedPath)
          if (!result || !result.textContent) {
            throw new Error('Conversion returned empty result')
          }
          await writeFile(mdPath, result.textContent, 'utf-8')
          markdownPath = mdPath
          filesToCleanup.push(mdPath)
          deps.platform.logger.info(`Converted Office file to markdown: ${mdPath}`)
        } catch (convertError) {
          // Conversion failed - throw so user knows the file can't be processed
          // Claude can't read raw Office binary, so a failed conversion = unusable file
          const errorMsg = convertError instanceof Error ? convertError.message : String(convertError)
          deps.platform.logger.error('Office to markdown conversion failed:', errorMsg)
          throw new Error(`Failed to convert "${attachment.name}" to readable format: ${errorMsg}`)
        }
      }

      // Return StoredAttachment metadata
      // Include wasResized flag so UI can show notification
      // Include resizedBase64 so renderer uses resized image for Claude API
      return {
        id,
        type: attachment.type,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: finalSize, // Use final size (may differ if resized)
        originalSize: wasResized ? attachment.size : undefined, // Track original if resized
        storedPath,
        thumbnailPath,
        thumbnailBase64,
        markdownPath,
        wasResized,
        resizedBase64, // Only set when wasResized=true, used for Claude API
      }
    } catch (error) {
      // Clean up any files we've written before the error
      if (filesToCleanup.length > 0) {
        deps.platform.logger.info(`Cleaning up ${filesToCleanup.length} orphaned file(s) after storage error`)
        await Promise.all(filesToCleanup.map(f => unlink(f).catch(() => {})))
      }

      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('storeAttachment error:', message)
      throw new Error(`Failed to store attachment: ${message}`)
    }
  })

  // Filesystem search for @ mention file selection.
  // Parallel BFS walk that skips ignored directories BEFORE entering them,
  // avoiding reading node_modules/etc. contents entirely. Uses withFileTypes
  // to get entry types without separate stat calls.
  server.handle(RPC_CHANNELS.fs.SEARCH, async (_ctx, basePath: string, query: string) => {
    deps.platform.logger.info('[FS_SEARCH] called:', basePath, query)
    const MAX_RESULTS = 50

    // Directories to never recurse into
    const SKIP_DIRS = new Set([
      'node_modules', '.git', '.svn', '.hg', 'dist', 'build',
      '.next', '.nuxt', '.cache', '__pycache__', 'vendor',
      '.idea', '.vscode', 'coverage', '.nyc_output', '.turbo', 'out',
    ])

    const lowerQuery = query.toLowerCase()
    const results: Array<{ name: string; path: string; type: 'file' | 'directory'; relativePath: string }> = []

    try {
      // BFS queue: each entry is a relative path prefix ('' for root)
      let queue = ['']

      while (queue.length > 0 && results.length < MAX_RESULTS) {
        // Process current level: read all directories in parallel
        const nextQueue: string[] = []

        const dirResults = await Promise.all(
          queue.map(async (relDir) => {
            const absDir = relDir ? join(basePath, relDir) : basePath
            try {
              return { relDir, entries: await readdir(absDir, { withFileTypes: true }) }
            } catch {
              // Skip dirs we can't read (permissions, broken symlinks, etc.)
              return { relDir, entries: [] as import('fs').Dirent[] }
            }
          })
        )

        for (const { relDir, entries } of dirResults) {
          if (results.length >= MAX_RESULTS) break

          for (const entry of entries) {
            if (results.length >= MAX_RESULTS) break

            const name = entry.name
            // Skip hidden files/dirs and ignored directories
            if (name.startsWith('.') || SKIP_DIRS.has(name)) continue

            const relativePath = relDir ? `${relDir}/${name}` : name
            const isDir = entry.isDirectory()

            // Queue subdirectories for next BFS level
            if (isDir) {
              nextQueue.push(relativePath)
            }

            // Check if name or path matches the query
            const lowerName = name.toLowerCase()
            const lowerRelative = relativePath.toLowerCase()
            if (lowerName.includes(lowerQuery) || lowerRelative.includes(lowerQuery)) {
              results.push({
                name,
                path: join(basePath, relativePath),
                type: isDir ? 'directory' : 'file',
                relativePath,
              })
            }
          }
        }

        queue = nextQueue
      }

      // Sort: directories first, then by name length (shorter = better match)
      results.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.length - b.name.length
      })

      deps.platform.logger.info('[FS_SEARCH] returning', results.length, 'results')
      return results
    } catch (err) {
      deps.platform.logger.error('[FS_SEARCH] error:', err)
      return []
    }
  })

  // List directories in a given path (for remote directory browsing).
  // Returns only directories (not files) — this is a folder picker.
  server.handle(RPC_CHANNELS.fs.LIST_DIRECTORY, async (_ctx, dirPath: string) => {
    // Resolve ~ to server's home directory (thin clients don't know the server's home)
    if (dirPath === '~' || dirPath.startsWith('~/')) {
      dirPath = dirPath === '~' ? homedir() : join(homedir(), dirPath.slice(2))
    }

    // Reject cross-platform and relative paths before resolve() can concatenate with cwd
    const pathCheck = validatePathFormat(dirPath)
    if (!pathCheck.valid) {
      throw new Error(pathCheck.reason!)
    }

    // Normalize (collapses .. segments, trailing slashes, etc.)
    const resolved = resolve(dirPath)

    // Read entries, filter to directories
    const raw = await readdir(resolved, { withFileTypes: true })

    const entries: Array<{ name: string; path: string; isSymlink: boolean }> = []
    for (const entry of raw) {
      const fullPath = join(resolved, entry.name)
      const isSymlink = entry.isSymbolicLink()

      if (entry.isDirectory()) {
        entries.push({ name: entry.name, path: fullPath, isSymlink: false })
      } else if (isSymlink) {
        // Follow symlink — check if target is a directory
        try {
          const target = await stat(fullPath)
          if (target.isDirectory()) {
            entries.push({ name: entry.name, path: fullPath, isSymlink: true })
          }
        } catch {
          // Broken symlink — skip silently
        }
      }
    }

    // Sort alphabetically (case-insensitive), cap at 500
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    const totalEntries = entries.length
    const truncated = totalEntries > 500
    if (truncated) entries.length = 500

    // Compute parent path
    const parentPath = resolved === parsePath(resolved).root ? null : dirname(resolved)

    // Compute breadcrumbs server-side
    const breadcrumbs: Array<{ name: string; path: string }> = []
    let current = resolved
    while (true) {
      const parsed = parsePath(current)
      const name = parsed.base || parsed.root
      breadcrumbs.unshift({ name, path: current })
      if (current === parsed.root) break
      current = dirname(current)
    }

    return {
      currentPath: resolved,
      parentPath,
      breadcrumbs,
      platform: process.platform as DirectoryListingResult['platform'],
      truncated,
      totalEntries,
      entries,
    } satisfies DirectoryListingResult
  })
}
