/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: 'standalone',
  experimental: {
    // 推广长图服务端渲染（原生 .node，不打包）
    serverComponentsExternalPackages: ['@napi-rs/canvas'],
    outputFileTracingExcludes: {
      '**/*': ['./.data/**/*'],
    },
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: '/api/legacy/:path*',
        destination: `${process.env.LEGACY_API_URL || 'http://34.226.216.105:8080'}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
