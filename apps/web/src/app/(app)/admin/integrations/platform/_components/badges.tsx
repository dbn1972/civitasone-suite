"use client";

import { useTranslations, useLocale } from "next-intl";
import { StatusPill } from "@/app/_components/ds";
import {
  envTone,
  healthTone,
  providerStatusTone,
  type Health,
  type IntegrationEnv,
  type ProviderStatus,
} from "@/lib/admin/platformIntegrations";

export function ProviderStatusPill({ status }: { status: ProviderStatus }) {
  const t = useTranslations("platformIntegrations");
  return <StatusPill status={status} label={t(`status.${status}`)} variant={providerStatusTone(status)} />;
}

/** The environment is always shown as text, never by colour alone. */
export function EnvBadge({ env }: { env: IntegrationEnv }) {
  const t = useTranslations("platformIntegrations");
  return <StatusPill status={env} label={t(`env.${env}`)} variant={envTone(env)} />;
}

export function formatWhen(iso: string | null, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/** Last test result + time. A sandbox result is labelled as a mock so it is never mistaken for a live handshake. */
export function HealthCard({ health }: { health: Health }) {
  const t = useTranslations("platformIntegrations");
  const locale = useLocale();
  const tested = health.testedAt ? formatWhen(health.testedAt, locale) : "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }} aria-live="polite">
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <StatusPill status={health.status} label={t(`health.${health.status}`)} variant={healthTone(health.status)} />
        <span className="muted" style={{ fontSize: 12 }}>
          {tested ? t("health.testedAt", { when: tested }) : t("health.never")}
        </span>
      </div>
      {health.message && (
        <div style={{ fontSize: 12 }}>
          {health.message}
          {health.environment === "sandbox" && <span className="muted"> · {t("health.mock")}</span>}
        </div>
      )}
    </div>
  );
}
