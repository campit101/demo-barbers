import type { NextConfig } from "next";
import { assertTestStripeKey } from "./src/lib/guards";

// A live Stripe key must fail the build, not only the first request.
if (process.env.STRIPE_SECRET_KEY) assertTestStripeKey(process.env.STRIPE_SECRET_KEY);

const nextConfig: NextConfig = {
  // Separate build folders, so verify and browser tests never fight a dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // 85 for photos and 90 for the home page's main photo: the default 75 looked soft at full width.
  images: { formats: ["image/avif", "image/webp"], deviceSizes: [390, 640, 820, 1080, 1440], qualities: [75, 85, 90] },
  async headers() {
    // Everything from this site only. Inline scripts stay allowed because pages are pre-built (a per-request nonce would stop
    // caching) and Next and the theme script inline small scripts; nothing a visitor types is rendered as HTML.
    // form-action allows Stripe because a server action's redirect to Checkout follows on from the form post.
    const dev = process.env.NODE_ENV === "development";
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      `connect-src 'self'${dev ? " ws:" : ""}`,
      "frame-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self' https://checkout.stripe.com",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ");
    const security = [
      { key: "Content-Security-Policy", value: csp },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    const privatePages = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    return [
      { source: "/:path*", headers: security },
      { source: "/manage/:path*", headers: privatePages },
      { source: "/booking/:path*", headers: privatePages },
      { source: "/admin/:path*", headers: privatePages },
    ];
  },
};

export default nextConfig;
