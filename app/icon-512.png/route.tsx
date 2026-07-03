import { ImageResponse } from "next/og";
import { BrandIcon } from "@/lib/pwa/brand-icon";

// Fixed-path 512px PNG for the manifests' icons arrays (purpose "any").
export function GET() {
  return new ImageResponse(<BrandIcon size={512} />, { width: 512, height: 512 });
}
