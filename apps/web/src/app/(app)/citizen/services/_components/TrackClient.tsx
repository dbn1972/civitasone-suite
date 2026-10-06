"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { StatusTimeline } from "@/app/_components/ds/designer/StatusTimeline";
import { EmptyState, ErrorState, StatusPill } from "@/app/_components/ds";
import {
  buildTrackingTimeline,
  fetchPublishedByKey,
  TrackingError,
  trackApplication,
  type PublishedServiceRuntime,
  type TrackingAck,
} from "../_data/runtimeApi";

interface Props {
  serviceKey: string;
  trackingNo: string;
}

type TrackError = { kind: "not_found" | "unavailable" };

export function TrackClient({ serviceKey, trackingNo }: Props) {
  const t = useTranslations("citizenServices");
  const [ack, setAck] = useState(null as TrackingAck | null);
  const [service, setService] = useState(null as PublishedServiceRuntime | null);
  const [error, setError] = useState(null as TrackError | null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setAck(null);
    setAttempt((n) => n + 1);
  }, []);

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
        if (cancelled) return;
        // GAP-...-TRACK-01: classify; never surface the backend's raw text.
        const kind = e instanceof TrackingError ? e.kind : "unavailable";
        setError({ kind });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trackingNo, serviceKey, attempt]);

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
    const serviceHref = `/citizen/services/${serviceKey}`;
    if (error.kind === "not_found") {
      return (
        <ErrorState
          error={{
            what: t("trackErrNotFoundTitle"),
            next: t("trackErrNotFoundNext"),
            actions: ["back"],
          }}
          backHref={serviceHref}
        />
      );
    }
    return (
      <ErrorState
        error={{
          what: t("trackErrUnavailableTitle"),
          next: t("trackErrUnavailableNext"),
          actions: ["retry", "back"],
        }}
        onRetry={retry}
        backHref={serviceHref}
      />
    );
  }

  if (!ack) {
    return (
      <div
        className="card pad"
        aria-busy="true"
        aria-label={t("loadingStatus")}
        style={{ maxWidth: 640, margin: "0 auto", display: "grid", gap: 12 }}
      >
        <div className="skeleton" style={{ height: 18, width: "40%", borderRadius: 6 }} />
        <div className="skeleton" style={{ height: 28, width: "70%", borderRadius: 6 }} />
        <div className="skeleton" style={{ height: 120, borderRadius: 8 }} />
      </div>
    );
  }

  // GAP-...-TRACK-04: certificate/closure card uses the same terminal-status
  // source of truth as the timeline's last lane, so a resolved/closed case no
  // longer shows "Not issued yet" while the timeline is fully done.
  const normalized = ack.status.trim().toLowerCase().replace(/[\s_]+/g, "-");
  const isCertificate = ["issued", "approved", "completed", "confirmed"].includes(normalized);
  const isClosure = ["closed", "resolved"].includes(normalized);

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 640, margin: "0 auto", width: "100%" }}>
      <div className="card pad" style={{ display: "grid", gap: 8 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{t("trackingNumberLabel")}</p>
        <p style={{ margin: 0, fontSize: 22, fontWeight: 700, wordBreak: "break-all" }}>{ack.trackingNo}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <StatusPill status={ack.status} />
          {service?.name ? <span style={{ fontSize: 13, color: "var(--ink2)" }}>{service.name}</span> : null}
        </div>
      </div>

      <div className="card pad">
        <h3 style={{ marginTop: 0 }}>{t("progressTitle")}</h3>
        <StatusTimeline steps={steps} />
      </div>

      {/* GAP-...-TRACK-03: there is no per-application notification feed on this
          screen, so the old permanent EmptyState promised updates that can never
          arrive here. Replaced with an honest static line pointing to alerts. */}
      <div className="card pad">
        <h3 style={{ marginTop: 0 }}>{t("notificationsTitle")}</h3>
        <p style={{ margin: 0, fontSize: 14, color: "var(--ink2)" }}>
          {t("trackNotificationsStatic")}{" "}
          <Link href="/citizen/alerts" style={{ fontWeight: 600 }}>
            {t("notificationsTitle")}
          </Link>
        </p>
      </div>

      <div className="card pad">
        <h3 style={{ marginTop: 0 }}>{t("certificateTitle")}</h3>
        {isCertificate ? (
          <EmptyState
            title={t("certificateIssuedTitle")}
            message={t("certificateIssuedMessage")}
            action={
              <Link href="/citizen/certificates" className="btn ghost" style={{ minHeight: 44 }}>
                {t("openCertificateVerify")}
              </Link>
            }
          />
        ) : isClosure ? (
          <EmptyState title={t("closureNoteTitle")} message={t("closureNoteMessage")} />
        ) : (
          <EmptyState title={t("notIssuedTitle")} message={t("notIssuedMessage")} />
        )}
      </div>

      <Link href={`/citizen/services/${serviceKey}`} className="btn ghost" style={{ minHeight: 44 }}>
        {t("backToService2")}
      </Link>
    </div>
  );
}
