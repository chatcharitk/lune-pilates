import { ImageResponse } from "next/og";
import { BrandIcon } from "@/lib/pwa/brand-icon";

// Maskable 512px PNG (purpose "maskable"): artwork padded into the safe zone so
// circular/squircle launcher masks never clip the moon or sparkle.
export function GET() {
  return new ImageResponse(<BrandIcon size={512} safeZone />, {
    width: 512,
    height: 512,
  });
}
