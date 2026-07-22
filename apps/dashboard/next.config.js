/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@phoenix/design-system',
    '@phoenix/ui',
    '@phoenix/config',
  ],
};

module.exports = nextConfig;
