import Link from "next/link";
import { PageHeader } from "@/app/_components/ds";
import { TrackClient } from "../../_components/TrackClient";

interface Props {
  params: { serviceKey: string; trackingNo: string };
}

/** FN-13 — application tracking with StatusTimeline. */
export default function ServiceTrackPage({ params }: Props) {
  return (
    <>
      <PageHeader
        title="Track application"
        subtitle="Follow your application progress"
        actions={
          <Link href={`/citizen/services/${params.serviceKey}`} className="btn ghost" style={{ minHeight: 44 }}>
            ← Service
          </Link>
        }
      />
      <TrackClient serviceKey={params.serviceKey} trackingNo={params.trackingNo} />
    </>
  );
}
