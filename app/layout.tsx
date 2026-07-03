import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LUNE Pilates",
  description: "Boutique reformer Pilates — book, share household credits, and flow.",
  // iOS "Add to Home Screen": run standalone (no Safari chrome). The admin
  // layout overrides the title (and manifest) for its own install identity.
  // The customer manifest is a route handler (see app/manifest.webmanifest/)
  // linked here via metadata so the admin override actually takes effect.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "LUNE" },
  // Next emits the modern `mobile-web-app-capable` for appleWebApp.capable;
  // add the legacy Apple-prefixed tag for older iOS Safari.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Extend under the notch/home-indicator so env(safe-area-inset-*) is non-zero
  // on iOS — the fixed bottom nav + checkout bars pad against it.
  viewportFit: "cover",
  themeColor: "#f1e9e0",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Schibsted+Grotesk:wght@400;500;600;700&family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600&family=Trirong:ital,wght@0,500;1,500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
