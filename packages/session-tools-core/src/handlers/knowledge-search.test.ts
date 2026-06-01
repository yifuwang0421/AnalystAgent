import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SessionToolContext } from '../context.ts';
import { handleKnowledgeSearch } from './knowledge-search.ts';

function ctx(workspacePath: string): SessionToolContext {
  return {
    sessionId: 'test-session',
    workspacePath,
    sourcesPath: join(workspacePath, 'sources'),
    skillsPath: join(workspacePath, 'skills'),
    plansFolderPath: join(workspacePath, 'plans'),
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: {
      exists: () => false,
      readFile: () => '',
      readFileBuffer: () => Buffer.from(''),
      writeFile: () => {},
      isDirectory: () => false,
      readdir: () => [],
      stat: () => ({ size: 0, isDirectory: () => false }),
    },
    loadSourceConfig: () => null,
  };
}

describe('knowledge_search', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'knowledge-search-'));
    mkdirSync(join(tempDir, 'knowledge'), { recursive: true });
    writeFileSync(join(tempDir, 'knowledge', 'maotai.md'), '# Maotai\n\nKweichow Moutai margin and channel notes.');
    writeFileSync(join(tempDir, 'config.json'), JSON.stringify({
      finance: {
        enabled: true,
        researchDirectory: tempDir,
        knowledgeBaseEnabled: true,
      },
    }));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns content hits with file paths for evidence ledger citations', async () => {
    const result = await handleKnowledgeSearch(ctx(tempDir), {
      query: 'Moutai margin',
      maxResults: 5,
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      resultCount: number;
      results: Array<{ path: string; sourceType: string; snippet: string }>;
    };

    expect(parsed.resultCount).toBe(1);
    expect(parsed.results[0]?.path).toContain('maotai.md');
    expect(parsed.results[0]?.sourceType).toBe('content');
    expect(parsed.results[0]?.snippet).toContain('margin');
  });

  it('respects disabled knowledge base config', async () => {
    writeFileSync(join(tempDir, 'config.json'), JSON.stringify({
      finance: {
        enabled: true,
        researchDirectory: tempDir,
        knowledgeBaseEnabled: false,
      },
    }));

    const result = await handleKnowledgeSearch(ctx(tempDir), {
      query: 'Moutai',
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      resultCount: number;
      note: string;
    };

    expect(parsed.resultCount).toBe(0);
    expect(parsed.note).toContain('disabled');
  });
});
