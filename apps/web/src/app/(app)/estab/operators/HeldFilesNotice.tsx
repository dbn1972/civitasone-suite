"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

type State = { kind: "loading" } | { kind: "ok"; count: number } | { kind: "error" };

/**
 * GAP-ESTAB-OPERATORS-03: shown inside the Deactivate confirmation. Asks the
 * service how many live files the officer holds (GET /v1/estab/files/held-count,
 * the same count Handover uses) and warns, with a link to Handover, so a desk is
 * not deactivated blind. Warn-only: the service stays the authority and the
 * deactivation itself is not blocked here (block vs warn is the owner's policy call).
 */
export function HeldFilesNotice({ employeeId }: { employeeId: string }) {
  const t = useTranslations("estabP2");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    void (async () => {
      try {
        const res = await fetch(`/api/proxy/v1/estab/files/held-count?officerId=${encodeURIComponent(employeeId)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return setState({ kind: "error" });
        const body = (await res.json()) as { count?: number };
        setState(typeof body.count === "number" ? { kind: "ok", count: body.count } : { kind: "error" });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setState({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, [employeeId]);

  return (
    <div>
      <p style={{ margin: 0 }}>{t("heldIntro")}</p>
      <p role="status" style={{ margin: "8px 0 0", fontWeight: 600 }} data-testid="held-files-notice">
        {state.kind === "loading" ? t("heldLoading") : null}
        {state.kind === "error" ? t("heldError") : null}
        {state.kind === "ok" && state.count === 0 ? t("heldNone") : null}
        {state.kind === "ok" && state.count > 0 ? t("heldSome", { count: state.count }) : null}
      </p>
      {state.kind === "ok" && state.count > 0 ? (
        <p style={{ margin: "6px 0 0" }}>
          <Link href="/estab/handover">{t("heldOpenHandover")}</Link>
        </p>
      ) : null}
    </div>
  );
}
