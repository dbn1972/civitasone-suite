"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { StatusTimeline } from "@/app/_components/ds/designer/StatusTimeline";
import { EmptyState, ErrorState, StatusPill } from "@/app/_components/ds";
import {
  buildTrackingTimeline,
  fetchPublishedByKey,
  trackApplication,
  type PublishedServiceRuntime,
  type TrackingAck,
} from "../_data/runtimeApi";

interface Props {
  serviceKey: string;
  trackingNo: string;
}

export function TrackClient({ serviceKey, trackingNo }: Props) {
  const [ack, setAck] = useState<TrackingAck | null>(null);
  const [service, setService] = useState<PublishedServiceRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tracking, svc] = await Promise.all([
          trackApplication(trackingNo),
          fetchPublishedByKey(serviceKey).catch(() => null),
        ]);
        if (cancelled) return;
        setAck(tracking);
        setService(svc);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Not found");
      }
    })();
    return () => { cancelled = true; };
  }, [trackingNo, serviceKey]);

  const steps = useMemo(() => {
    if (!ack) return [];
    return buildTrackingTimeline({
      status: ack.status,
      servicePattern: service?.servicePattern,
      acknowledgedAt: ack.acknowledgedAt,
      slaDays: service?.slaDays ?? null,
      hasFee: service ? service.feeFromMinor != null : true,
    });
  }, [ack, service]);

  if (error) {
    return (
      <ErrorState
        error={{
          what: "Tracking unavailable",
          next: `${error} Check the tracking number and try again, or ask at the counter with your receipt.`,
          actions: ["back"],
        }}
        backHref="/citizen/catalogue"
      />
    );
  }

  if (!ack) {
    return (
      <div
        className="card pad"
        aria-busy="true"
        aria-label="Loading status"
        style={{ maxWidth: 640, margin: "0 auto", display: "grid", gap: 12 }}
      >
        <div className="skeleton" style={{ height: 18, width: "40%", borderRadius: 6 }} />
        <div className="skeleton" style={{ height: 28, width: "70%", borderRadius: 6 }} />
        <div className="skeleton" style={{ height: 120, borderRadius: 8 }} />
      </div>
    );
  }

  const certificateReady = ["issued", "approved", "completed", "confirmed"].includes(
    ack.status.trim().toLowerCase(),
  );

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 640, margin: "0 auto", width: "100%" }}>
      <div className="card pad" style={{ display: "grid", gap: 8 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>Tracking number</p>
        <p style={{ margin: 0, fontSize: 22, fontWeight: 700, wordBreak: "break-all" }}>{ack.trackingNo}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <StatusPill status={ack.status} />
          {service?.name ? (
            <span style={{ fontSize: 13, color: "var(--ink2)" }}>{service.name}</span>
          ) : null}
        </div>
      </div>

      <div className="card pad">
        <h3 style={{ marginTop: 0 }}>Progress</h3>
        <StatusTimeline steps={steps} />
      </div>

      <div className="card pad">
        <h3 style={{ marginTop: 0 }}>Notifications</h3>
        <EmptyState
          title="No messages yet"
          message="SMS, email, and WhatsApp updates for this application will appear here when the office sends them."
        />
      </div>

      <div className="card pad">
        <h3 style={{ marginTop: 0 }}>Certificate</h3>
        {certificateReady ? (
          <EmptyState
            title="Certificate issued"
            message="Download will appear here when the issuance file is ready. You can also verify with the QR on the printed copy."
            action={
              <Link href="/citizen/certificates" className="btn ghost" style={{ minHeight: 44 }}>
                Open certificate verify
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="Not issued yet"
            message="When the office issues your certificate or closure note, download and QR verify links will show here."
          />
        )}
      </div>

      <Link href={`/citizen/services/${serviceKey}`} className="btn ghost" style={{ minHeight: 44 }}>
        ← Back to service
      </Link>
    </div>
  );
}
