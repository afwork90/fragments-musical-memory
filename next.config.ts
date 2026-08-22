import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.PAGES_BUILD === "1" ? { output: "export" as const } : {}),
};

export default nextConfig;
