"use client";

import { UserFacingError } from "@/lib/userFacingError";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { humanizeStatus } from "@/lib/formatters";
import { Button, PageHeader } from "@/app/_components/ds";

/**
 * GAP-CITIZEN-DOCUMENTS-02 — DigiLocker OAuth callback.
 *
 * The provider redirects the citizen's browser back here with `code` + `state`
 * on the query string. We POST both to
 * POST /v1/citizen/documents/digilocker/callback, which re-binds the exchange
 * to the original server-held state, exchanges the code (with the server-held
 * PKCE verifier), verifies the issued-document artefact locally and ONLY THEN
 * records a source-verified submission.
 *
 * The response envelope is the standard 202 accepted shape with the result in
 * `data`: { id, verified, providerStatus }. We NEVER claim "verified" unless the
 * API returns `verified: true` (source_verified) — an exchange that merely
 * succeeds but fails local artefact verification is shown as "received, not yet
 * source-verified". A missing code/state, or any error, shows an honest failure.
 */

type CallbackResult = {
  id?: string;
  status?: string;
  correlationId?: string;
  data?: { id?: string; verified?: boolean; providerStatus?: string };
};

type Phase =
  | { kind: "pending" }
  | { kind: "verified"; providerStatus: string }
  | { kind: "unverified"; providerStatus: string }
  | { kind: "error"; message: string };

export default function DigiLockerCallbackPage() {
  const t = useTranslations("citizenDocuments");
  const searchParams = useSearchParams();
  const formError = useFormError("document");
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const [phase, setPhase] = useState<Phase>({ kind: "pending" });
  // Guard against the OAuth code being POSTed twice (it is single-use).
  const exchangedRef = useRef(false);

  useEffect(() => {
    if (exchangedRef.current) return;
    exchangedRef.current = true;
    if (!code || !state) {
      setPhase({ kind: "error", message: t("callbackMissingParams") });
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/citizen/documents/digilocker/callback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, state }),
        });
        if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
        const body = (await res.json()) as CallbackResult;
        if (!active) return;
        const providerStatus = body.data?.providerStatus ?? "";
        // Honesty gate: trust ONLY the API's source_verified flag.
        if (body.data?.verified === true) {
          setPhase({ kind: "verified", providerStatus });
        } else {
          setPhase({ kind: "unverified", providerStatus });
        }
      } catch (caught) {
        if (!active) return;
        setPhase({ kind: "error", message: formError.fromException("save", caught).message });
      }
    })();
    return () => { active = false; };
  }, [code, state, t, formError]);

  const backLink = (
    <Link href="/citizen/documents" style={{ display: "inline-block", marginTop: 16 }}>
      <Button type="button" variant="secondary" style={{ minHeight: 44 }}>{t("callbackBackToDocuments")}</Button>
    </Link>
  );

  return (
    <>
      <PageHeader title={t("callbackTitle")} subtitle={t("callbackSubtitle")} />
      <div className="card">
        <div className="pad" style={{ maxWidth: 640 }}>
          <div role="status" aria-live="polite">
            {phase.kind === "pending" ? <p>{t("callbackPending")}</p> : null}

            {phase.kind === "verified" ? (
              <div>
                <p style={{ color: "var(--good, #067647)", fontWeight: 600 }}>{t("callbackVerified")}</p>
                {phase.providerStatus ? (
                  <p style={{ fontSize: 13, color: "var(--muted)" }}>
                    {t("resultDigilocker", { status: humanizeStatus(phase.providerStatus) })}
                  </p>
                ) : null}
              </div>
            ) : null}

            {phase.kind === "unverified" ? (
              <div>
                <p style={{ color: "var(--warn, #b54708)", fontWeight: 600 }}>{t("callbackUnverified")}</p>
                {phase.providerStatus ? (
                  <p style={{ fontSize: 13, color: "var(--muted)" }}>
                    {t("resultDigilocker", { status: humanizeStatus(phase.providerStatus) })}
                  </p>
                ) : null}
              </div>
            ) : null}

            {phase.kind === "error" ? (
              <p role="alert" style={{ color: "var(--bad, #b42318)" }}>{phase.message}</p>
            ) : null}
          </div>
          {backLink}
        </div>
      </div>
    </>
  );
}
