/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't bundle the Neon driver or its `ws` dependency into the server build —
  // bundling breaks ws's native bufferutil ("bufferUtil.mask is not a function")
  // and the interactive-transaction WebSocket Pool the credit ledger needs.
  serverExternalPackages: ["@neondatabase/serverless", "ws"],
};

export default nextConfig;
