import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, PageHeader } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { parsePublishedService } from "../_data/runtimeApi";
import { ServicePageClient } from "../_components/ServicePageClient";

interface Props {
  params: { serviceKey: string };
  searchParams: { counter?: string };
}

async function loadService(serviceKey: string) {
  const result = await fetchJson<unknown, ReturnType<typeof parsePublishedService>>(
    `/api/v1/citizen/catalogue/published/lookup?serviceKey=${encodeURIComponent(serviceKey)}`,
    null,
    {
      revalidateSeconds: 30,
      telemetryKey: "citizen.runtime.service",
      mapResponse: (p) => parsePublishedService(p),
    },
  );
  return result;
}

/** FN-13 — published service landing page (mobile-first). */
export default async function ServicePage({ params, searchParams }: Props) {
  const t = await getTranslations("citizenServices");
  const { data: service, source } = await loadService(params.serviceKey);
  if (!service || source === "error") notFound();

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
