/**
 * GET /.well-known/security.txt — RFC 9116 machine-readable disclosure policy
 * (GAP-CONTACT-HOME-03).
 *
 * Returns text/plain with at least Contact and Expires. Expires is computed one year
 * ahead at request time so the file never serves a stale/expired date (RFC 9116 §2.5.5
 * requires a future Expires). Optional fields (Policy, Encryption, Preferred-Languages,
 * Canonical) are included when configured for the deployment.
 */
import { NextResponse } from "next/server";

const SECURITY_EMAIL = (process.env.NEXT_PUBLIC_SECURITY_CONTACT_EMAIL ?? "security@civitasone.app").trim();

function abs(path: string): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (!base) return null;
  return `${base}${path}`;
}

export function GET(): NextResponse {
  const expires = new Date();
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);

  const lines: string[] = [
    `Contact: mailto:${SECURITY_EMAIL}`,
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: en, hi",
  ];

  const policy = abs("/contact");
  if (policy) lines.push(`Policy: ${policy}`);
  const canonical = abs("/.well-known/security.txt");
  if (canonical) lines.push(`Canonical: ${canonical}`);
  const pgp = process.env.NEXT_PUBLIC_SECURITY_PGP_URL?.trim();
  if (pgp) lines.push(`Encryption: ${pgp}`);

  const body = `${lines.join("\n")}\n`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
