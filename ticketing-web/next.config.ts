import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

/** Where the NestJS API runs. The browser never calls it directly: `/api/v1/*` is proxied (see rewrites). */
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';
/** Socket.IO connects straight to the API (rewrites cannot proxy WebSockets). */
const socketOrigin = process.env.NEXT_PUBLIC_SOCKET_URL ?? apiOrigin;
/** Poster/banner hosts allowed through next/image. Posters on other hosts render as a placeholder. */
const imageHosts = (process.env.NEXT_PUBLIC_IMAGE_HOSTS ?? 'images.unsplash.com')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

const razorpay = 'https://checkout.razorpay.com https://api.razorpay.com';
const socketWs = socketOrigin.replace(/^http/, 'ws');

// Documented exception to the security standard: Next.js injects inline bootstrap scripts, so script-src
// needs 'unsafe-inline' unless every page is rendered per request with a nonce — which would defeat the
// prerendered catalog shell. Mitigation: no HTML sinks (no dangerouslySetInnerHTML/innerHTML/eval) in src/.
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' ${isDev ? "'unsafe-eval'" : ''} https://checkout.razorpay.com`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: ${imageHosts.map((host) => `https://${host}`).join(' ')}`,
  `font-src 'self'`,
  `connect-src 'self' ${socketOrigin} ${socketWs} ${razorpay}`,
  `frame-src https://api.razorpay.com https://checkout.razorpay.com`,
  `frame-ancestors 'none'`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
]
  .join('; ')
  .replace(/\s+/g, ' ');

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    remotePatterns: imageHosts.map((hostname) => ({ protocol: 'https', hostname })),
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  // Same-origin API: the refresh cookie (path /api/v1/auth/<portal>) is first-party and no CORS is needed.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(self "https://api.razorpay.com")' },
        ],
      },
    ];
  },
};

export default nextConfig;
