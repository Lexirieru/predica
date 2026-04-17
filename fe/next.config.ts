import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Turbopack 16 mis-resolves lightweight-charts' conditional `exports` field
  // (development/production/default keys), throwing
  //   "Cannot read properties of undefined (reading 'some')"
  // at the import line during module evaluation. Forcing it through Next's
  // transpile pipeline routes resolution via the standard ESM loader, which
  // handles the conditional exports correctly.
  transpilePackages: ["lightweight-charts"],
};

export default nextConfig;
