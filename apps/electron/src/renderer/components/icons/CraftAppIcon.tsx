import analystLogo from "@/assets/analyst_agent_logo.png"

interface CraftAppIconProps {
  className?: string
  size?: number
}

/**
 * CraftAppIcon - Displays the Analyst Agent logo.
 */
export function CraftAppIcon({ className, size = 64 }: CraftAppIconProps) {
  return (
    <img
      src={analystLogo}
      alt="Analyst Agent"
      width={size}
      height={size}
      className={className}
    />
  )
}
