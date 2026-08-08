"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusTimeline } from "@/app/_components/ds/designer/StatusTimeline";
import { ErrorState } from "@/app/_components/ds";
import { trackApplication, type TrackingAck } from "../_data/runtimeApi";

interface Props {
  serviceKey: string;
  trackingNo: string;
}

export function TrackClient({ serviceKey, trackingNo }: Props) {
  const [ack, setAck] = useState<TrackingAck | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void trackApplication(trackingNo)
      .then(setAck)
      .catch((e) => setError(e instanceof Error ? e.message : "Not found"));
  }, [trackingNo]);

  if (error) {
    return <ErrorState title="Tracking unavailable" message={error} />;
  }

  if (!ack) {
    return <p style={{ color: "var(--mut)" }}>Loading status…</p>;
  }

  const steps = [
    { id: "submitted", label: "Submitted", state: "done" as const, date: ack.acknowledgedAt ?? undefined },
    { id: "review", label: "Under review", state: ack.status === "submitted" ? ("current" as const) : ("done" as const), slaDaysRemaining: 12 },
    { id: "fee", label: "Fee & payment", state: "upcoming" as const },
    { id: "issued", label: "Certificate issued", state: "upcoming" as const },
  ];

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 640, margin: "0 auto" }}>
      <div className="card pad">
        <p style={{ margin: "0 0 4px", fontSize: 13, color: "var(--mut)" }}>Tracking number</p>
        <p style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{ack.trackingNo}</p>
        <p style={{ margin: "8px 0 0", fontSize: 14 }}>Status: <strong>{ack.status}</strong></p>
      </div>

      <div className="card pad">
        <h3 style={{ marginTop: 0 }}>Progress</h3>
        <StatusTimeline steps={steps} />
        <p style={{ margin: "16px 0 0", fontSize: 12, color: "var(--mut)" }}>
          Notification history and certificate download are stubbed in this pilot.
        </p>
      </div>

      <Link href={`/citizen/services/${serviceKey}`} className="btn ghost" style={{ minHeight: 44 }}>
        ← Back to service
      </Link>
    </div>
  );
}
