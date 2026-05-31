import analystLogo from "@/assets/analyst_agent_logo.svg"

interface AnalystAppIconProps {
  className?: string
  size?: number
}

export function AnalystAppIcon({ className, size = 64 }: AnalystAppIconProps) {
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
