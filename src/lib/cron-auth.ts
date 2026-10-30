import { createHash, timingSafeEqual } from "node:crypto";

/** SHA-256 digest, so comparisons always run over two equal-length buffers. */
const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Checks a cron request's `Authorization` header against `CRON_SECRET` in
 * constant time.
 *
 * Fails closed: without a configured secret every request is rejected, so a
 * missing env var cannot turn `Bearer undefined` into a valid credential.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;

  return timingSafeEqual(digest(authHeader), digest(`Bearer ${cronSecret}`));
}
