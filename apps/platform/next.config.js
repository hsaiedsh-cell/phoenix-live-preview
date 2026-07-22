/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@phoenix/core',
    '@phoenix/ui',
    '@phoenix/pbrs',
    '@phoenix/design-system',
    '@phoenix/config',
  ],
};

module.exports = nextConfig;
