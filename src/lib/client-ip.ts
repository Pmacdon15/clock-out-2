/**
 * The caller's IP for rate limiting: the first `X-Forwarded-For` hop (set by
 * Vercel's edge), then `X-Real-IP`, else "unknown" so callers without either
 * share one bucket rather than going unmetered.
 */
export function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || req.headers.get("x-real-ip")?.trim();
  return ip ? ip.slice(0, 64) : "unknown";
}
