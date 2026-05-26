import analystLogo from "@/assets/analyst_agent_logo.png"

interface CraftAgentsLogoProps {
  className?: string
}

/**
 * Analyst Agent wordmark.
 */
export function CraftAgentsLogo({ className }: CraftAgentsLogoProps) {
  return (
    <img
      src={analystLogo}
      alt="Analyst Agent"
      className={className}
    />
  )
}
