/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the workspace TS packages (they ship raw .ts via the "main" field).
  transpilePackages: ["@runeclaw/core", "@runeclaw/bitget-adapter"],
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
