"use client";

/**
 * GeoCheckInCard — the missing UI path for the geo-attendance module's
 * employee self-service check-in/out.
 *
 * HIGH fix: a complete, dedicated geo-attendance backend already exists
 * (geo-attendance/routes.ts: POST .../attendance/geo-check-in,
 * .../geo-check-out, GET .../office-locations, .../attendance/geo-history)
 * but was referenced nowhere in apps/web -- the one visible "Configure
 * check-in" button (AttendanceTable.tsx) leads to /hr/attendance/config, a
 * static read-only reference page with no backend behind it at all (see
 * that page's own doc comment). This embeds real check-in/out directly on
 * /hr/attendance, the page every role already lands on for attendance.
 *
 * Self-only by construction, matching the backend's own IDOR fix
 * (resolveSelfEmployeeOrThrow in geo-attendance/routes.ts): employeeId
 * always comes from the server-resolved `employeeId` prop (attendance/
 * page.tsx's getMyProfile(), the same self-service resolution pattern
 * leave/apply and hr/wfh already use) -- this component never lets a caller
 * name a different employeeId, so it cannot be used to check in on anyone
 * else's behalf even if the prop were tampered with client-side.
 *
 * geo-history's `employeeId` query param is ALWAYS passed explicitly here
 * (never omitted): the route's own default when it's omitted is
 * `ctx.actorId`, which -- unlike this component's own self-resolved
 * `employeeId` (an hrms_employees.id) -- is the caller's raw auth-account
 * id. Every other self-service route in this codebase that needs "my own
 * employee id" resolves it via resolveEmployeeForActor specifically
 * because the two id spaces differ; geo-history's default does not do that
 * resolution, so relying on it would silently return zero rows for a real
 * employee. Flagged in this change's PR description as a backend
 * follow-up; worked around here by simply never relying on the default.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

type OfficeLocation = { id: string; name: string; address?: string | null; radiusMeters: number; isActive: boolean };
type HistoryRow = {
  id: string;
  date: string;
  checkType: string;
  withinGeofence: boolean;
  distanceMeters: number | null;
  markedAt: string;
};
type CheckResult = { status: string; message: string; distanceMeters: number | null; officeName?: string | null };

export function GeoCheckInCard({ employeeId, employeeStatus }: { employeeId: string | null; employeeStatus?: string }) {
  const t = useTranslations("geoCheckIn");
  const router = useRouter();

  const [offices, setOffices] = useState<OfficeLocation[]>([]);
  const [officeId, setOfficeId] = useState("");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [busy, setBusy] = useState<"in" | "out" | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!employeeId) return;
    const controller = new AbortController();
    fetch("/api/proxy/v1/hrms/office-locations", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((body: { data?: OfficeLocation[] }) => setOffices((body.data ?? []).filter((o) => o.isActive)))
      .catch(() => { /* office picker degrades to the server's own default-office fallback */ });
    fetch(`/api/proxy/v1/hrms/attendance/geo-history?employeeId=${encodeURIComponent(employeeId)}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((body: { data?: HistoryRow[] }) => setHistory((body.data ?? []).slice(0, 5)))
      .catch(() => { /* history is supplementary context, not load-bearing */ });
    return () => controller.abort();
  }, [employeeId]);

  function getPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error(t("errNoGeolocation")));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, (err) => reject(new Error(err.message || t("errLocationDenied"))), {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
    });
  }

  async function act(kind: "in" | "out") {
    if (!employeeId) return;
    setBusy(kind);
    setError("");
    setResult(null);
    try {
      const pos = await getPosition();
      const res = await fetch(`/api/proxy/v1/hrms/attendance/geo-check-${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employeeId,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy,
          officeLocationId: officeId || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<CheckResult> & { message?: string; code?: string };
      if (!res.ok) {
        throw new Error(body.message ?? t("errGeneric"));
      }
      setResult({
        status: body.status ?? (kind === "in" ? "checked_in" : "checked_out"),
        message: body.message ?? (kind === "in" ? t("successCheckIn") : t("successCheckOut")),
        distanceMeters: body.distanceMeters ?? null,
        officeName: body.officeName ?? null,
      });
      router.refresh();
      // Re-pull recent history so the new punch shows up without a full reload.
      fetch(`/api/proxy/v1/hrms/attendance/geo-history?employeeId=${encodeURIComponent(employeeId)}`)
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((b: { data?: HistoryRow[] }) => setHistory((b.data ?? []).slice(0, 5)))
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errGeneric"));
    } finally {
      setBusy(null);
    }
  }

  const alreadyExited = employeeStatus ? ["terminated", "separated", "retired", "no_show"].includes(employeeStatus.toLowerCase()) : false;

  if (!employeeId) {
    return (
      <div role="note" style={{ padding: "16px 20px", fontSize: 13, color: "var(--mut)" }}>
        {t("noLinkedProfileMessage")}
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px", display: "grid", gap: 14 }}>
      {alreadyExited ? (
        <p role="note" style={{ fontSize: 13, color: "var(--mut)" }}>{t("exitedMessage")}</p>
      ) : (
        <>
          {offices.length > 0 && (
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem", maxWidth: 360 }}>
              <span style={{ fontWeight: 600 }}>{t("fieldOfficeLocation")}</span>
              <select
                value={officeId}
                onChange={(e) => setOfficeId(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 44 }}
              >
                <option value="">{t("officeAutoDetect")}</option>
                {offices.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button style={{ minHeight: 44 }} disabled={busy !== null} loading={busy === "in"} onClick={() => void act("in")}>
              {busy === "in" ? t("checkingIn") : t("checkInButton")}
            </Button>
            <Button variant="ghost" style={{ minHeight: 44 }} disabled={busy !== null} loading={busy === "out"} onClick={() => void act("out")}>
              {busy === "out" ? t("checkingOut") : t("checkOutButton")}
            </Button>
          </div>

          {error && (
            <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--bad, #b91c1c)", margin: 0 }}>⚠ {error}</p>
          )}
          {result && (
            <p
              role="status"
              aria-live="polite"
              className={`pill ${result.status === "within_geofence" ? "good" : "bad"}`}
              style={{ margin: 0, width: "fit-content" }}
            >
              {result.message}
            </p>
          )}
        </>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--ink2)", marginBottom: 6 }}>{t("recentHistoryTitle")}</p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
            {history.map((h) => (
              <li key={h.id} style={{ fontSize: 12, color: "var(--mut)", display: "flex", gap: 8 }}>
                <span>{formatIndianDate(h.date)}</span>
                <span>{h.checkType === "in" ? t("historyIn") : t("historyOut")}</span>
                <span>{h.withinGeofence ? t("historyWithinGeofence") : t("historyOutsideGeofence", { distance: h.distanceMeters ?? 0 })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
