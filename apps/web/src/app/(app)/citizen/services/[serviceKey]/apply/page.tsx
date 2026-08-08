import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { parsePublishedService } from "../_data/runtimeApi";
import { ServiceRuntimeFlow } from "../_components/ServiceRuntimeFlow";

interface Props {
  params: { serviceKey: string };
  searchParams: { counter?: string };
}

async function loadService(serviceKey: string) {
  return fetchJson<unknown, ReturnType<typeof parsePublishedService>>(
    `/api/v1/citizen/catalogue/published/lookup?serviceKey=${encodeURIComponent(serviceKey)}`,
    null,
    {
      revalidateSeconds: 0,
      telemetryKey: "citizen.runtime.apply",
      mapResponse: (p) => parsePublishedService(p),
    },
  );
}

/** FN-13 — pack-driven apply flow (FormRenderer stepped → review → fee → submitted). */
export default async function ServiceApplyPage({ params, searchParams }: Props) {
  const { data: service, source } = await loadService(params.serviceKey);
  if (!service || source === "error") notFound();

  const counterMode = searchParams.counter === "1";

  return (
    <>
      <PageHeader
        title={`Apply — ${service.name}`}
        subtitle="Complete each section. Your progress is saved automatically."
        actions={
          <Link href={`/citizen/services/${params.serviceKey}`} className="btn ghost" style={{ minHeight: 44 }}>
            ← Service info
          </Link>
        }
      />
      <ServiceRuntimeFlow service={service} counterMode={counterMode} />
    </>
  );
}
