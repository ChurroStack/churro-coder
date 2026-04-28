import { useId } from "react"

interface FolderIconProps {
  className?: string
}

/**
 * macOS Finder-style blue folder. Two-tone gradient with a back tab and front
 * face, mirroring the look of folders in Finder list view.
 */
export function MacOsFolderIcon({ className }: FolderIconProps) {
  const id = useId()
  const backGradient = `${id}-back`
  const frontGradient = `${id}-front`
  return (
    <svg
      viewBox="0 0 16 14"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={backGradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5AA9F0" />
          <stop offset="1" stopColor="#2F7DD1" />
        </linearGradient>
        <linearGradient id={frontGradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7CC0FB" />
          <stop offset="1" stopColor="#3D8FE7" />
        </linearGradient>
      </defs>
      {/* Back panel (the tab + back wall) */}
      <path
        d="M1.5 3.5 Q1.5 2.25 2.75 2.25 H6 L7.5 3.75 H13.25 Q14.5 3.75 14.5 5 V11.5 Q14.5 12.5 13.5 12.5 H2.5 Q1.5 12.5 1.5 11.5 Z"
        fill={`url(#${backGradient})`}
      />
      {/* Front face — slightly inset, lighter shade */}
      <path
        d="M1.5 6.25 Q1.5 5.25 2.5 5.25 H13.5 Q14.5 5.25 14.5 6.25 V11.5 Q14.5 12.5 13.5 12.5 H2.5 Q1.5 12.5 1.5 11.5 Z"
        fill={`url(#${frontGradient})`}
      />
      {/* Subtle highlight at the top of the front face */}
      <path
        d="M2.5 5.25 H13.5 Q14.5 5.25 14.5 6.25 V6.5 H1.5 V6.25 Q1.5 5.25 2.5 5.25 Z"
        fill="#FFFFFF"
        fillOpacity="0.18"
      />
    </svg>
  )
}

/**
 * Open variant — same silhouette with a slightly tilted front face for
 * expanded folders. Visually similar; the chevron is the primary cue.
 */
export function MacOsFolderOpenIcon({ className }: FolderIconProps) {
  const id = useId()
  const backGradient = `${id}-back`
  const frontGradient = `${id}-front`
  return (
    <svg
      viewBox="0 0 16 14"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={backGradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5AA9F0" />
          <stop offset="1" stopColor="#2F7DD1" />
        </linearGradient>
        <linearGradient id={frontGradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8FCBFC" />
          <stop offset="1" stopColor="#4F9DEE" />
        </linearGradient>
      </defs>
      <path
        d="M1.5 3.5 Q1.5 2.25 2.75 2.25 H6 L7.5 3.75 H13.25 Q14.5 3.75 14.5 5 V11.5 Q14.5 12.5 13.5 12.5 H2.5 Q1.5 12.5 1.5 11.5 Z"
        fill={`url(#${backGradient})`}
      />
      {/* Tilted front face — slightly trapezoidal to suggest open */}
      <path
        d="M0.75 6.5 Q1 5.5 2 5.5 H13.75 Q14.85 5.5 14.6 6.5 L13.5 11.75 Q13.3 12.5 12.4 12.5 H2.5 Q1.5 12.5 1.5 11.5 Z"
        fill={`url(#${frontGradient})`}
      />
      <path
        d="M2 5.5 H13.75 Q14.85 5.5 14.6 6.5 L14.55 6.7 H1 L1.05 6.5 Q1.25 5.5 2 5.5 Z"
        fill="#FFFFFF"
        fillOpacity="0.2"
      />
    </svg>
  )
}
