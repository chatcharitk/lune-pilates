// Line icons used across the customer booking screens, drawn in the same
// stroke-based style as app/(customer)/home/page.tsx and the prototype's <Icon>.
// Each takes a size + standard SVG props; colour comes from `currentColor`.

import type { SVGProps } from "react";

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function Base({ size = 20, strokeWidth = 1.7, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ChevronLeft = (p: IconProps) => (
  <Base {...p}>
    <path d="M15 6l-6 6 6 6" />
  </Base>
);

export const ChevronRight = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 6l6 6-6 6" />
  </Base>
);

export const ArrowRight = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Base>
);

export const Clock = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Base>
);

export const CalendarIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M3 9h18M8 2v4M16 2v4" />
  </Base>
);

export const Users = (p: IconProps) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16 5.2a3.2 3.2 0 0 1 0 6M18 20a6 6 0 0 0-3-5.2" />
  </Base>
);

export const Pin = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.6" />
  </Base>
);

export const Info = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.5v.5" />
  </Base>
);

export const Check = (p: IconProps) => (
  <Base strokeWidth={2.4} {...p}>
    <path d="M5 12l4.5 4.5L19 7" />
  </Base>
);

export const Bell = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </Base>
);

export const Sparkle = (p: IconProps) => (
  <Base fill="currentColor" stroke="none" {...p}>
    <path d="M12 2c.6 4.4 1.6 5.4 6 6-4.4.6-5.4 1.6-6 6-.6-4.4-1.6-5.4-6-6 4.4-.6 5.4-1.6 6-6Z" />
  </Base>
);

export const Qr = (p: IconProps) => (
  <Base {...p}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <path d="M14 14h2v2M20 14v6M14 20h6M18 17v.01" />
  </Base>
);

export const Share = (p: IconProps) => (
  <Base {...p}>
    <circle cx="7" cy="12" r="2.5" />
    <circle cx="17" cy="6" r="2.5" />
    <circle cx="17" cy="18" r="2.5" />
    <path d="M9.2 10.8 14.8 7.2M9.2 13.2 14.8 16.8" />
  </Base>
);

export const Copy = (p: IconProps) => (
  <Base {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </Base>
);

/** Upload-to-cloud affordance for the slip dropzone (Feature 3). */
export const Upload = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
  </Base>
);

/** Framed-image glyph — marks an attached slip image. */
export const ImageIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m4 18 5-5 4 4 3-3 4 4" />
  </Base>
);
