import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
