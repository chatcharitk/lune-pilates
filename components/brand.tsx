"use client";

// The LUNE brand lockup, shared by both surfaces. Renders the designer's real
// logo asset (public/brand/logo-full.png — auto-cropped, transparent background)
// at `imgHeight`, and falls back to the styled text wordmark when the asset is
// absent or fails to load — the app never shows a broken image, and before the
// asset exists every site looks exactly as it did.
//
// `onDark` re-inks the transparent logo to near-cream via a CSS filter so the
// same single asset works on the admin dark sidebar.

import { useEffect, useRef, useState } from "react";

const LOGO_SRC = {
  full: "/brand/logo-full.png", // wide "LUNE PILATES STUDIO" lockup — admin
  mark: "/brand/logo-mark.png", // tall "E"-with-sparkle mark — customer app
} as const;

export function BrandLogo({
  imgHeight,
  variant = "full",
  onDark = false,
  className,
  fallback,
}: {
  /** Rendered logo height in px (width scales with the asset's aspect ratio). */
  imgHeight: number;
  /** Which asset: the wide lockup ("full") or the compact mark ("mark"). */
  variant?: "full" | "mark";
  /** Render in cream for dark backgrounds (admin sidebar). */
  onDark?: boolean;
  className?: string;
  /** The styled text wordmark shown when the asset is missing/unloadable. */
  fallback: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // The <img> is server-rendered, so a 404 can fire BEFORE hydration attaches
  // onError — re-check the load state on mount, or the broken-image icon sticks.
  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset in /public
    <img
      ref={ref}
      src={LOGO_SRC[variant]}
      alt="LUNE Pilates Studio"
      style={{
        height: imgHeight,
        width: "auto",
        filter: onDark ? "brightness(0) invert(0.94)" : undefined,
      }}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
