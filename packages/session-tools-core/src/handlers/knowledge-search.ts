import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { successResponse, errorResponse } from '../response.ts';
import type { ToolResult } from '../types.ts';

export interface KnowledgeSearchArgs {
  query: string;
  maxResults?: number;
  includeDirectories?: string[];
}

const DEFAULT_DIRS = ['knowledge', 'companies', 'industries', 'reports'];
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.csv', '.json', '.html', '.htm']);
const INDEXABLE_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.csv',
  '.json',
  '.html',
  '.htm',
  '.pdf',
  '.docx',
  '.xlsx',
  '.xls',
  '.pptx',
]);
const MAX_FILES = 300;
const MAX_TEXT_FILE_BYTES = 1_000_000;

interface SearchHit {
  path: string;
  title: string;
  snippet: string;
  updatedAt: string;
  score: number;
  sourceType: 'content' | 'filename';
}

function getResearchRoot(workspacePath: string): string {
  const configPath = join(workspacePath, 'config.json');
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      finance?: { researchDirectory?: string; knowledgeBaseEnabled?: boolean };
    };
    if (config.finance?.knowledgeBaseEnabled === false) {
      return '';
    }
    return config.finance?.researchDirectory || workspacePath;
  } catch {
    return workspacePath;
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function collectFiles(root: string, dirs: string[]): string[] {
  const files: string[] = [];

  const visit = (dir: string) => {
    if (files.length >= MAX_FILES || !existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= MAX_FILES) break;
      if (entry.name.startsWith('.')) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (INDEXABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  };

  for (const dir of dirs) {
    const fullDir = normalize(join(root, dir));
    if (isInside(root, fullDir)) {
      visit(fullDir);
    }
  }

  return files;
}

function tokenize(query: string): string[] {
  return Array.from(new Set(
    query
      .toLowerCase()
      .split(/[\s,，。；;:：、|()[\]{}"'`]+/)
      .map(part => part.trim())
      .filter(Boolean)
  ));
}

function extractTitle(filePath: string, content?: string): string {
  if (content) {
    const heading = content.split(/\r?\n/).find(line => /^#{1,3}\s+\S/.test(line));
    if (heading) return heading.replace(/^#{1,3}\s+/, '').trim();
  }
  return basename(filePath);
}

function makeSnippet(content: string, terms: string[]): string {
  const lower = content.toLowerCase();
  const firstMatch = terms
    .map(term => lower.indexOf(term))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstMatch - 160);
  const end = Math.min(content.length, firstMatch + 360);
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
}

function scoreText(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((score, term) => {
    const matches = lower.split(term).length - 1;
    return score + matches;
  }, 0);
}

export async function handleKnowledgeSearch(
  ctx: SessionToolContext,
  args: KnowledgeSearchArgs
): Promise<ToolResult> {
  const query = args.query?.trim();
  if (!query) {
    return errorResponse('query is required.');
  }

  const researchRoot = getResearchRoot(ctx.workspacePath);
  if (!researchRoot) {
    return successResponse(JSON.stringify({
      query,
      resultCount: 0,
      results: [],
      note: 'Knowledge base is disabled for this workspace.',
    }, null, 2));
  }

  const root = resolve(researchRoot);
  const requestedDirs = args.includeDirectories?.length ? args.includeDirectories : DEFAULT_DIRS;
  const dirs = requestedDirs.map(dir => dir.replace(/\\/g, '/').replace(/^\/+/, ''));
  const terms = tokenize(query);
  const maxResults = Math.max(1, Math.min(args.maxResults ?? 8, 20));
  const hits: SearchHit[] = [];

  for (const filePath of collectFiles(root, dirs)) {
    const stat = statSync(filePath);
    const ext = extname(filePath).toLowerCase();
    const relPath = relative(root, filePath).replace(/\\/g, '/');
    const filenameScore = scoreText(relPath, terms);

    if (TEXT_EXTENSIONS.has(ext) && stat.size <= MAX_TEXT_FILE_BYTES) {
      const content = readFileSync(filePath, 'utf-8');
      const contentScore = scoreText(content, terms);
      const score = contentScore * 3 + filenameScore;
      if (score > 0) {
        hits.push({
          path: filePath,
          title: extractTitle(filePath, content),
          snippet: makeSnippet(content, terms),
          updatedAt: stat.mtime.toISOString(),
          score,
          sourceType: 'content',
        });
      }
    } else if (filenameScore > 0) {
      hits.push({
        path: filePath,
        title: basename(filePath),
        snippet: `Binary or large file matched by filename. Use document tools to inspect it if needed. Relative path: ${relPath}`,
        updatedAt: stat.mtime.toISOString(),
        score: filenameScore,
        sourceType: 'filename',
      });
    }
  }

  hits.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));

  return successResponse(JSON.stringify({
    query,
    searchedDirectories: dirs,
    resultCount: Math.min(hits.length, maxResults),
    results: hits.slice(0, maxResults).map(({ score: _score, ...hit }) => hit),
  }, null, 2));
}
