import { ImageResponse } from "next/og";
import { BrandIcon } from "@/lib/pwa/brand-icon";

// iOS home-screen icon (auto-linked by Next as <link rel="apple-touch-icon">).
// iOS applies its own rounded-corner mask, so the artwork is full-bleed cream.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<BrandIcon size={size.width} />, size);
}
