interface AnalystAgentSymbolProps {
  className?: string
}

export function AnalystAgentSymbol({ className }: AnalystAgentSymbolProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M12 52L28.4 12h7.2L52 52h-9.2l-3.2-8.4H24.1L20.9 52H12ZM27.1 35.8h9.8L32 22.7l-4.9 13.1Z"
        fill="currentColor"
      />
      <path
        d="M16 46.5h9.2l8-8 5.3 5.2L51 31.2"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
