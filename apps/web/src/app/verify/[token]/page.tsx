import { humanizeStatus } from "@/lib/formatters";

/**
 * GAP-CITIZEN-CERTIFICATES-01: a public, UNAUTHENTICATED certificate-verify
 * page. The backend verify endpoint is already public
 * (GET /v1/citizen/certificates/verify/:token, config.public), returning only
 * attestation fields (no citizen PII). But the only UI that called it lived
 * inside the authenticated (app) shell — so a third party scanning a QR could
 * not use it. This page sits OUTSIDE (app) (no ModuleGate, no session), fetches
 * the gateway's public endpoint directly (the /api/proxy route requires a
 * session cookie, so it cannot be used here), and shows the minimal verdict.
 */
export const dynamic = "force-dynamic";

const GATEWAY = (process.env.CIVITASONE_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");

interface VerifyResult {
  found: boolean;
  validity?: "valid" | "expired" | "invalid";
  certNo?: string | null;
  certType?: string;
  status?: string;
  validTo?: string | null;
}

async function verify(token: string): Promise<VerifyResult | null> {
  try {
    const res = await fetch(`${GATEWAY}/api/v1/citizen/certificates/verify/${encodeURIComponent(token)}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 404) return { found: false, validity: "invalid" };
    if (!res.ok) return null;
    return (await res.json()) as VerifyResult;
  } catch {
    return null;
  }
}

export default async function PublicVerifyPage({ params }: { params: { token: string } }) {
  const result = await verify(params.token);

  const bg = result?.validity === "valid" ? "#ecfdf3" : result?.validity === "expired" ? "#fffaeb" : "#fef3f2";

  return (
    <main style={{ maxWidth: 560, margin: "48px auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22 }}>Certificate verification</h1>
      {result === null ? (
        <p role="alert">We couldn&apos;t verify this certificate right now. Please try again later.</p>
      ) : (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "inline-block", padding: "6px 14px", borderRadius: 999, background: bg, fontWeight: 600 }}>
            {result.found ? `Certificate is ${result.validity}` : "Certificate not found"}
          </div>
          {result.found ? (
            <dl style={{ fontSize: 14, marginTop: 16 }}>
              <div><strong>Number:</strong> {result.certNo ?? "—"}</div>
              <div><strong>Type:</strong> {result.certType ? humanizeStatus(result.certType) : "—"}</div>
              <div><strong>Status:</strong> {result.status ? humanizeStatus(result.status) : "—"}</div>
              <div><strong>Valid to:</strong> {result.validTo ?? "—"}</div>
            </dl>
          ) : null}
        </div>
      )}
    </main>
  );
}
