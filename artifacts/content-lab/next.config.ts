import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/db"],
  serverExternalPackages: ["pg"],
  // `@workspace/db` is resolved to repo root; ensure single copy.
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
