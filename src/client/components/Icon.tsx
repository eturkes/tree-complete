import type { SVGProps } from 'react'

export type IconName =
  | 'activity'
  | 'arrow'
  | 'branch'
  | 'check'
  | 'chevron'
  | 'close'
  | 'code'
  | 'expand'
  | 'refresh'
  | 'spark'
  | 'tree'
  | 'warning'

export interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

const paths: Record<IconName, React.ReactNode> = {
  activity: <path d="M3 12h3l2.2-6 4.1 12 2.2-6H21" />,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  branch: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M8 5h3a4 4 0 0 1 4 4v5a4 4 0 0 0 1 2.7M8 5v9a4 4 0 0 0 4 4h4" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  code: <path d="m8 9-3 3 3 3m8-6 3 3-3 3m-3-9-2 12" />,
  expand: <path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.9-3M4 4v5h5m-5 4a8 8 0 0 0 14.9 3M20 20v-5h-5" />,
  spark: <path d="m12 2 1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2Zm6 13 .7 2.3L21 18l-2.3.7L18 21l-.7-2.3L15 18l2.3-.7L18 15Z" />,
  tree: <path d="M12 3v18M12 7 7 11m5 1 5-4M12 16l-4-3m4 5 4-3M7 21h10" />,
  warning: <path d="M12 3 2.8 20h18.4L12 3Zm0 6v5m0 3h.01" />,
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
