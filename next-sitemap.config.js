// Signed-in pages (kept in sync with DASHBOARD_ROUTES in src/lib/routes.ts)
// redirect crawlers to sign-in, so they stay out of the sitemap and robots.txt.
const SIGNED_IN = [
  "/hours",
  "/jobs",
  "/notifications",
  "/schedule",
  "/time-off",
  "/settings",
];

/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: "https://clockout.patmac.ca",
  generateRobotsTxt: true,
  sitemapSize: 7000,
  changefreq: "monthly",
  exclude: [
    // `/welcome` is what `/` serves signed-out visitors; `/` is canonical.
    "/welcome",
    ...SIGNED_IN.flatMap((path) => [path, `${path}/*`]),
    "/api/*",
    "/.well-known/*",
    "/manifest.webmanifest",
    "/icon.svg",
    "/favicon.ico",
    "/opengraph-image*",
  ],
  transform: (config, path) => ({
    loc: path,
    changefreq:
      path === "/" || path === "/plans" ? "weekly" : config.changefreq,
    priority: path === "/" ? 1.0 : path === "/plans" ? 0.8 : 0.3,
    lastmod: config.autoLastmod ? new Date().toISOString() : undefined,
  }),
  robotsTxtOptions: {
    policies: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/welcome", ...SIGNED_IN],
      },
    ],
  },
};
