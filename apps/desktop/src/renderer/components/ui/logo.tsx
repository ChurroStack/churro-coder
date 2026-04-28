import { useTheme } from "next-themes"
import { cn } from "../../lib/utils"
import logoLight from "../../../../build/logo-mono.png"
import logoDark from "../../../../build/logo-mono-dark.png"

interface LogoProps {
  className?: string
  fill?: string
}

export function Logo({ fill, className }: LogoProps) {
  const { resolvedTheme } = useTheme()

  if (fill) {
    return (
      <span
        role="img"
        aria-label="ChurroStack logo"
        className={cn("inline-block w-full h-full", className)}
        style={{
          backgroundColor: fill,
          WebkitMaskImage: `url(${logoLight})`,
          maskImage: `url(${logoLight})`,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
          WebkitMaskSize: "contain",
          maskSize: "contain",
        }}
      />
    )
  }

  return (
    <img
      src={resolvedTheme === "dark" ? logoDark : logoLight}
      alt="ChurroStack logo"
      className={cn("w-full h-full object-contain", className)}
    />
  )
}
