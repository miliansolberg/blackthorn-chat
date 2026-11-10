import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Ship the Blackthorn client (fetched at build time) with the server routes.
  outputFileTracingIncludes: {
    "/api/chat": ["./bin/blackthorn"],
    "/api/session": ["./bin/blackthorn"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
