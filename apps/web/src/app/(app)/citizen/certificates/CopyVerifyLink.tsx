"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/ds";

/**
 * GAP-CITIZEN-CERTIFICATES-02: the verify token is a bearer credential for the
 * public verify endpoint. The register used to print the first 12 characters in
 * monospace — a secret-hygiene smell AND useless (not a working token). This
 * copies the full verify URL to the clipboard WITHOUT ever rendering the token
 * in the DOM, with an aria-live confirmation.
 */
export function CopyVerifyLink({ token }: { token: string }) {
  const t = useTranslations("citizenCertificates");
  const [copied, setCopied] = useState(false);

  async function copy() {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/verify/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Button type="button" variant="ghost" style={{ minHeight: 36 }} onClick={copy}>
        {t("copyVerifyLink")}
      </Button>
      <span role="status" aria-live="polite" style={{ fontSize: 12, color: "var(--muted)" }}>
        {copied ? t("copied") : ""}
      </span>
    </span>
  );
}
