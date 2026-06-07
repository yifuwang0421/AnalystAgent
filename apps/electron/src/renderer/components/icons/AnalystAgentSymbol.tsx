import analystLogo from "@/assets/analyst_agent_logo.png"

interface AnalystAgentSymbolProps {
  className?: string
}

export function AnalystAgentSymbol({ className }: AnalystAgentSymbolProps) {
  return (
    <img
      src={analystLogo}
      alt="Analyst Agent"
      className={className}
      draggable={false}
    />
  )
}
