import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Next.js only reads .env files from apps/web/, but the whole monorepo is
// configured from the root .env (the same file the scripts load via dotenv).
// Load it here so server code (readDashboardEnv) sees the real config.
const rootEnv = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the workspace TS packages (they ship raw .ts via the "main" field).
  transpilePackages: ["@wardenclaw/core", "@wardenclaw/bitget-adapter", "@wardenclaw/bsc-adapter"],
  experimental: {
    // The dashboard reads audit/backtest files from the monorepo data/ dir.
    outputFileTracingRoot: undefined,
  },
  webpack: (config) => {
    // The workspace TS packages import siblings with a ".js" specifier (ESM
    // style over .ts sources). Tell webpack to resolve ".js" → ".ts"/".tsx".
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
