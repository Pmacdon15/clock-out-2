import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  typedRoutes: true,
  cacheComponents: true,
  headers() {
    return Promise.resolve([
      { source: "/:path*", headers: [...securityHeaders] },
    ]);
  },
};

export default nextConfig;
