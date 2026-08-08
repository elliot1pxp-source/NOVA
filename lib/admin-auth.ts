/**
 * Server-only admin authentication.
 *
 * The admin key is read exclusively from the `ADMIN_KEY` environment variable.
 * It is never hardcoded, so it does not ship to the client bundle.
 * When the env var is unset, authorization fails closed.
 */

export function getAdminKey(): string {
  return process.env.ADMIN_KEY?.trim() ?? "";
}

/**
 * Returns true when the request carries a valid `Authorization: Bearer <key>`
 * header matching the configured `ADMIN_KEY`. Fails closed when the env var
 * is not set.
 */
export function isAdminAuthorized(req: Request): boolean {
  const adminKey = getAdminKey();
  if (!adminKey) return false;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${adminKey}`;
}
