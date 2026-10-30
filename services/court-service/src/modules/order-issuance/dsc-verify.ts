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
 *   • verify the signer chains to a trusted CCA/CA root when a trust store is
 *     configured. Whether that chain trust is REQUIRED to issue is decided by
 *     `resolveDscChainTrustPolicy` (dsc-provider.ts): always in production
 *     (fail closed), only with a configured trust store in development/test
 *     (fail open with a WARN — UAT F65).
 *
 * The actual CMS crypto lives in `@civitasone/render`'s `verifyDetachedPkcs7`
 * (which owns node-forge and the sibling PDF-signature verifier), so we don't
 * add a second PKI implementation. This module is the court-specific glue: it
 * decides WHAT bytes an order's signature must cover (`canonicalOrderContent`)
 * and maps the generic verification result to a court domain decision.
 */

import { verifyDetachedPkcs7, type DetachedDscVerifyResult } from "@civitasone/render";
import type { DscPolicyLogger, DscTrustStoreProvider } from "./dsc-provider.js";
import { defaultDscTrustStoreProvider, dscPolicyLog, resolveDscChainTrustPolicy } from "./dsc-provider.js";

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
 * Chain trust policy (see `resolveDscChainTrustPolicy`):
 *   • production (NODE_ENV not an explicit "development"/"test"): chain trust
 *     is ALWAYS required. With no `COURT_DSC_TRUST_STORE_PEM` every DSC —
 *     including a self-signed one — is refused (`trust_store_not_configured`).
 *   • development/test with a trust store: a signer that does not chain to it
 *     (e.g. a self-signed DSC) is refused.
 *   • development/test WITHOUT a trust store: chain trust is NOT enforced — the
 *     signature and certificate are still verified cryptographically, chain
 *     trust is reported as untrusted (`trustStoreConfigured: false`), and a
 *     WARN is logged on every such verification.
 * `requireChainTrust: true` (or `COURT_DSC_REQUIRE_CHAIN_TRUST=true`) forces it
 * on; neither can switch it off where the policy requires it.
 */
export function verifyOrderDsc(
  order: SignableOrder,
  dscSignature: string,
  opts: {
    provider?: DscTrustStoreProvider;
    requireChainTrust?: boolean;
    now?: Date;
    logger?: DscPolicyLogger;
  } = {},
): OrderDscVerification {
  const provider = opts.provider ?? defaultDscTrustStoreProvider;
  const trustStorePem = provider.getTrustStorePem() ?? undefined;

  const policy = resolveDscChainTrustPolicy(provider);
  const trustStoreConfigured = policy.trustStoreConfigured;
  // A caller may only STRENGTHEN the policy, never weaken it.
  const requireChainTrust = policy.required || opts.requireChainTrust === true;

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

  if (!requireChainTrust) {
    (opts.logger ?? dscPolicyLog).warn(
      {
        orderId: order.id,
        signerCN: base.signerCN ?? null,
        chainTrusted: base.chainTrusted,
        trustStoreConfigured,
        acceptedForIssue,
      },
      "DSC chain-of-trust NOT enforced for this verification (COURT_DSC_TRUST_STORE_PEM unset, " +
        "non-production); an untrusted/self-signed signer is accepted",
    );
  }

  return { ...base, acceptedForIssue, trustStoreConfigured };
}
