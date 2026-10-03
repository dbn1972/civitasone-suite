"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { browserFetch } from "@/lib/api/browserClient";
import { KIND_LABEL_KEY, missingForAreas, parseAssetSettings, type GlArea, type HeadKind } from "./settings/settingsModel";

/**
 * "Accounting not set up": shown on the screens whose postings need GL accounts the tenant has not configured. The
 * records are still saved (their journals are deferred until the accounts are set), so this banner says exactly that and
 * links to Asset settings. Loading shows nothing; a failed check is its own small note, never silence-as-success.
 */
export function AccountingBanner({ areas }: { areas: readonly GlArea[] }) {
  const t = useTranslations("assetsGl");
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "ok"; missing: HeadKind[] }>({ kind: "loading" });
  const key = areas.join(",");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await browserFetch("v1/asset/settings", { signal: controller.signal });
        const parsed = res.ok ? parseAssetSettings(await res.json().catch(() => null)) : null;
        if (!parsed) { setState({ kind: "error" }); return; }
        setState({ kind: "ok", missing: missingForAreas(parsed.accounting, key.split(",") as GlArea[]) });
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setState({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, [key]);

  if (state.kind === "loading") return null;
  if (state.kind === "error") return <p style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 12px" }}>{t("accountingCheckFailed")}</p>;
  if (state.missing.length === 0) return null;
  return (
    <div role="status" className="banner" style={{ background: "var(--panel)", border: "1px solid var(--warn)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>
      <strong>{t("accountingNotSetUp")}</strong>{" "}
      {t("accountingBannerBody", { heads: state.missing.map((k) => t(KIND_LABEL_KEY[k])).join(", ") })}{" "}
      <Link href="/assets/settings">{t("accountingBannerLink")}</Link>
    </div>
  );
}
