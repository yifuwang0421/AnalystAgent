type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type RendererLogger = Record<LogLevel, (...args: unknown[]) => void>

function normalizeForConsole(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }
  return value
}

export function createRendererLogScope(scope: string): RendererLogger {
  const write = (level: LogLevel, args: unknown[]) => {
    const prefix = `[${scope}]`
    const normalized = args.map(normalizeForConsole)
    console[level](prefix, ...normalized)

    try {
      void window.electronAPI?.debugLog?.(prefix, ...normalized)
    } catch {
      // Logging must never affect renderer startup.
    }
  }

  return {
    debug: (...args) => write('debug', args),
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
  }
}

export const rendererLog = createRendererLogScope('renderer')
export const searchLog = createRendererLogScope('search')

export default rendererLog
