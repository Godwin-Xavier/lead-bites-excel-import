/** @type {import('next').NextConfig} */
// Note: per-route `api.bodyParser.sizeLimit` lives in pages/api/upload.ts via `export const config`,
// not in next.config.js (Next 14 warning if placed here).
const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;
