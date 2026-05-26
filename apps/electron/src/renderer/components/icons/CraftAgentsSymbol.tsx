import analystLogo from "@/assets/analyst_agent_logo.png"

interface CraftAgentsSymbolProps {
  className?: string
}

/**
 * Analyst Agent symbol.
 */
export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return (
    <img
      src={analystLogo}
      alt="Analyst Agent"
      className={className}
    />
  )
}
