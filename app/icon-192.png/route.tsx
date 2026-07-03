import { ImageResponse } from "next/og";
import { BrandIcon } from "@/lib/pwa/brand-icon";

// Fixed-path 192px PNG for the manifests' icons arrays (the folder is literally
// named "icon-192.png" so the route serves a stable /icon-192.png URL).
export function GET() {
  return new ImageResponse(<BrandIcon size={192} />, { width: 192, height: 192 });
}
