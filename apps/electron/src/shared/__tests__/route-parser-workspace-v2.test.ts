import { describe, expect, it } from 'bun:test'
import { buildCompoundRoute, parseCompoundRoute, parseRouteToNavigationState } from '../route-parser'

describe('route-parser: workspace v2 routes', () => {
  it('parses research files route', () => {
    const result = parseCompoundRoute('files/research')
    expect(result).toEqual({
      navigator: 'files',
      filesScope: 'research',
      details: null,
    })
  })

  it('parses knowledge shortcut route', () => {
    const result = parseCompoundRoute('knowledge/file/knowledge%2FREADME.md')
    expect(result).toEqual({
      navigator: 'files',
      filesScope: 'knowledge',
      details: { type: 'file', id: 'knowledge/README.md' },
    })
  })

  it('roundtrips files route with encoded path', () => {
    const parsed = parseCompoundRoute('files/research/file/companies%2F600519.md')!
    expect(buildCompoundRoute(parsed)).toBe('files/research/file/companies%2F600519.md')
  })

  it('parses agents route and selected preset route', () => {
    expect(parseRouteToNavigationState('agents')).toEqual({
      navigator: 'agents',
      details: null,
    })
    expect(parseRouteToNavigationState('agents/agent/research-manager')).toEqual({
      navigator: 'agents',
      details: { type: 'agent', agentId: 'research-manager' },
    })
  })
})
