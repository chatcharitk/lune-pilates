import { ImageResponse } from "next/og";
import { BrandIcon } from "@/lib/pwa/brand-icon";

// Favicon / generic link icon (auto-linked by Next as <link rel="icon">).
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<BrandIcon size={size.width} />, size);
}
