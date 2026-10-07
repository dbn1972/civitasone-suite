/**
 * order-issuance DSC verification (§23 + §35.5 "AI never auto-issues";
 * GAP-COURT-ORDERS-02).
 *
 * The judicial issuance act hinges on a Digital Signature Certificate. The web
 * side only ever did structural (base64/PEM) validation of the pasted blob —
 * no cryptographic verification. This module does the REAL, local verification
 * on the server:
 *   • parse the detached PKCS#7/CMS SignedData,
 *   • extract the signer certificate (CN, serial, validity window),
 *   • verify the certificate is currently valid and asserts a signing key
 *     usage,
 *   • verify the RSA signature cryptographically over the ORDER's canonical
 *     signed content, and
 *   • (when a trust store is configured) verify the signer chains to a trusted
 *     CCA/CA root — fail-closed when it is not configured.
 *
 * The actual CMS crypto lives in `@civitasone/render`'s `verifyDetachedPkcs7`
 * (which owns node-forge and the sibling PDF-signature verifier), so we don't
 * add a second PKI implementation. This module is the court-specific glue: it
 * decides WHAT bytes an order's signature must cover (`canonicalOrderContent`)
 * and maps the generic verification result to a court domain decision.
 */

import { verifyDetachedPkcs7, type DetachedDscVerifyResult } from "@civitasone/render";
import type { DscTrustStoreProvider } from "./dsc-provider.js";
import { defaultDscTrustStoreProvider } from "./dsc-provider.js";

/** The minimal order shape whose content a DSC must sign. */
export interface SignableOrder {
  id: string;
  caseId: string;
  orderType: string | null;
  orderText: string | null;
  orderDate: string | null;
}

/**
 * The canonical bytes a DSC signature must cover for an order. Deterministic
 * and stable so the SAME order always hashes to the SAME content: a signer
 * token signs exactly this string. Changing an order's text after signing
 * invalidates the signature (digest_mismatch).
 */
export function canonicalOrderContent(order: SignableOrder): string {
  return [
    `court-order:${order.id}`,
    `case:${order.caseId}`,
    `type:${order.orderType ?? ""}`,
    `date:${order.orderDate ?? ""}`,
    `text:${order.orderText ?? ""}`,
  ].join("\n");
}

export interface OrderDscVerification extends DetachedDscVerifyResult {
  /** Whether the court will accept this signature to issue the order. */
  acceptedForIssue: boolean;
  /** True when a trust store is configured (chain trust was actually checked). */
  trustStoreConfigured: boolean;
}

/**
 * Verify a pasted/uploaded detached DSC signature against an order.
 *
 * `acceptedForIssue` is the gate the issuance command uses: the structure must
 * parse, the certificate must be currently valid and a signing cert, and the
 * cryptographic signature over the canonical order content must verify.
 *
 * Chain trust policy (fail-closed when configured): `requireChainTrust`
 * defaults to `provider.isConfigured()`. When `COURT_DSC_TRUST_STORE_PEM` is
 * configured, a signer that does not chain to the trust store (e.g. a
 * self-signed DSC) is REJECTED. When no trust store is configured the
 * deployment has opted out of chain checking: the signature and certificate
 * are still verified cryptographically, chain trust is reported as untrusted
 * (`trustStoreConfigured: false`) but is not required. Callers may force it
 * with `requireChainTrust: true`.
 */
export function verifyOrderDsc(
  order: SignableOrder,
  dscSignature: string,
  opts: { provider?: DscTrustStoreProvider; requireChainTrust?: boolean; now?: Date } = {},
): OrderDscVerification {
  const provider = opts.provider ?? defaultDscTrustStoreProvider;
  const trustStorePem = provider.getTrustStorePem() ?? undefined;

  const trustStoreConfigured = provider.isConfigured();
  const requireChainTrust = opts.requireChainTrust ?? trustStoreConfigured;

  const base = verifyDetachedPkcs7({
    signature: dscSignature,
    content: canonicalOrderContent(order),
    trustStorePem,
    now: opts.now,
  });

  const acceptedForIssue =
    base.ok &&
    base.signatureChecked &&
    base.signatureValid &&
    (!requireChainTrust || base.chainTrusted);

  return { ...base, acceptedForIssue, trustStoreConfigured };
}
