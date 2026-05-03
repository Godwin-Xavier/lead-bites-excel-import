/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow larger CSV uploads (Lead Bites monthly files are ~1.2 MB; bump to 8 MB for headroom)
  api: {
    bodyParser: {
      sizeLimit: '8mb',
    },
  },
};

module.exports = nextConfig;
