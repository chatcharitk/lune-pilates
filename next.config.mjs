/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't bundle the Neon driver or its `ws` dependency into the server build —
  // bundling breaks ws's native bufferutil ("bufferUtil.mask is not a function")
  // and the interactive-transaction WebSocket Pool the credit ledger needs.
  serverExternalPackages: ["@neondatabase/serverless", "ws"],
  experimental: {
    serverActions: {
      // Payment-slip upload is a base64 data-URL in a server-action body: the
      // 5MB file contract × ~1.33 base64 overhead blows past Next's 1MB default,
      // which rejected real phone slips. 8mb covers the worst case with headroom.
      bodySizeLimit: "8mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Nothing embeds this app (the LIFF client opens it top-level), so
          // deny framing outright. Full CSP is intentionally out of scope.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
