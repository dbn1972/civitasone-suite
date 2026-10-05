/**
 * Which presigned upload URLs the browser will PUT a file to. Outside development only https is accepted: a plain http URL would
 * send the document (and its signature) in clear text. The explicit allowlist for http is development/test builds and a loopback
 * host (localhost / 127.0.0.1 / ::1), which is where the local object-store stub lives.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isAllowedUploadUrl(raw: string, opts: { development?: boolean } = {}): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  if (u.protocol !== "http:") return false;
  const development = opts.development ?? (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test");
  return development || LOOPBACK_HOSTS.has(u.hostname.toLowerCase());
}
