import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, PageHeader } from "@/app/_components/ds";
import { RefreshErrorState } from "@/app/_components/ds/RefreshErrorState";
import { toHumanError } from "@/lib/messages";
import { classifyServiceLoad, loadService } from "../_data/loadService";
import { ServicePageClient } from "../_components/ServicePageClient";

interface Props {
  params: { serviceKey: string };
  searchParams: { counter?: string };
}

/** FN-13 — published service landing page (mobile-first). */
export default async function ServicePage({ params, searchParams }: Props) {
  const t = await getTranslations("citizenServices");
  const outcome = classifyServiceLoad(
    await loadService(params.serviceKey, { revalidateSeconds: 30, telemetryKey: "citizen.runtime.service" }),
  );
  if (outcome.kind === "not_found") notFound();
  if (outcome.kind === "unauthorized") redirect(`/login?next=/citizen/services/${params.serviceKey}`);
  if (outcome.kind === "unavailable") {
    return (
      <>
        <PageHeader
          title={t("backToCatalogue")}
          actions={
            <Link href="/citizen/catalogue" className="btn ghost" style={{ minHeight: 44 }}>
              {t("backToCatalogue")}
            </Link>
          }
        />
        <div style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}>
          <RefreshErrorState
            error={toHumanError("load", { area: "service details" })}
            backHref="/citizen/catalogue"
            source={{ status: outcome.status, area: "service details" }}
          />
        </div>
      </>
    );
  }
  const service = outcome.service;

  const counterMode = searchParams.counter === "1";

  return (
    <>
      <PageHeader
        title={service.name}
        subtitle={service.description}
        actions={
          <Link href="/citizen/catalogue" className="btn ghost" style={{ minHeight: 44 }}>
            {t("backToCatalogue")}
          </Link>
        }
      />

      <div style={{ display: "grid", gap: 16, maxWidth: 640, margin: "0 auto", width: "100%" }}>
        {counterMode ? (
          <div
            className="pad"
            role="status"
            style={{
              background: "var(--info-bg)",
              border: "1px solid var(--info-border)",
              borderRadius: "var(--r-sm)",
              fontSize: 13,
            }}
          >
            {t("counterModeNotice")}
          </div>
        ) : null}

        <Card padding>
          <ServicePageClient service={service} counterMode={counterMode} />
        </Card>
      </div>
    </>
  );
}
