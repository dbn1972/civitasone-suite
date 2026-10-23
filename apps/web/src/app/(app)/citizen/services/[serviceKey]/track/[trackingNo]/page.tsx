import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/app/_components/ds";
import { TrackClient } from "../../../_components/TrackClient";

interface Props {
  params: Promise<{ serviceKey: string; trackingNo: string }>;
}

/** FN-13 — application tracking with StatusTimeline. */
export default async function ServiceTrackPage(props: Props) {
  const params = await props.params;
  const t = await getTranslations("citizenServices");
  return (
    <>
      <PageHeader
        title={t("trackPageTitle")}
        subtitle={t("trackPageSubtitle")}
        actions={
          <Link href={`/citizen/services/${params.serviceKey}`} className="btn ghost" style={{ minHeight: 44 }}>
            {t("backToService")}
          </Link>
        }
      />
      <TrackClient serviceKey={params.serviceKey} trackingNo={params.trackingNo} />
    </>
  );
}
