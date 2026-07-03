import type { MetadataRoute } from "next";

// Customer-surface web-app manifest, served at /manifest.webmanifest.
//
// Deliberately a route handler rather than the app/manifest.ts file convention:
// the file convention auto-injects its <link rel="manifest"> into EVERY page and
// overrides `metadata.manifest`, which would stop the admin layout from pointing
// its pages at /admin.webmanifest. With a plain route + `metadata.manifest` in
// the root layout, the admin layout's metadata cleanly overrides the link, so
// installing from an /admin page yields the admin app.
const manifest: MetadataRoute.Manifest = {
  id: "lune-customer",
  name: "LUNE Pilates",
  short_name: "LUNE",
  start_url: "/home",
  scope: "/",
  display: "standalone",
  background_color: "#F1E9E0",
  theme_color: "#F1E9E0",
  lang: "th",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

export function GET() {
  return Response.json(manifest, {
    headers: { "content-type": "application/manifest+json" },
  });
}
