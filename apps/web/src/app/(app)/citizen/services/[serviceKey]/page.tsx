import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { parsePublishedService, formatFee } from "./_data/runtimeApi";
import { ServicePageClient } from "./_components/ServicePageClient";

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
            ← Catalogue
          </Link>
        }
      />

      <div style={{ display: "grid", gap: 16, maxWidth: 640, margin: "0 auto" }}>
        <div className="card pad" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 14 }}>
            <span><strong>Fee:</strong> {formatFee(service.feeFromMinor, service.feeCurrency)}</span>
            {service.slaDays ? <span><strong>SLA:</strong> {service.slaDays} working days</span> : null}
          </div>

          {service.requiredDocuments.length > 0 ? (
            <div>
              <strong style={{ fontSize: 14 }}>Documents needed</strong>
              <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                {service.requiredDocuments.map((d) => (
                  <li key={d.docType}>{d.label}{d.mandatory ? " (required)" : ""}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <ServicePageClient service={service} counterMode={counterMode} />
        </div>
      </div>
    </>
  );
}
