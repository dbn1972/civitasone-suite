"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  EmptyState,
  StatCard,
  StatGrid,
  StatusPill,
} from "@/app/_components/ds";
import { fmtTime, hoursSince } from "../_data/format";
import type { PassVerifyResult, RosterEntry, VisitRequest, VisitorLocation } from "../_data/types";
import {
  fetchRoster,
  recordCheckIn,
  recordCheckOut,
  verifyPass,
} from "../_data/client";

type Props = {
  locations: VisitorLocation[];
  expectedToday: VisitRequest[];
  expectedTodaySource: "api" | "error";
};

const OVERSTAY_HOURS = 8;

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 8,
  border: "1px solid var(--line)",
  fontSize: 13.5,
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 4,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  color: "var(--ink2)",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};

export function GuardConsole({ locations, expectedToday, expectedTodaySource }: Props) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [gateId, setGateId] = useState("");

  // Verify panel
  const [qrToken, setQrToken] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<PassVerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [checkedInPass, setCheckedInPass] = useState<string | null>(null);
  const [verifiedToday, setVerifiedToday] = useState(0);

  // Roster
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterState, setRosterState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [busyPass, setBusyPass] = useState<string | null>(null);

  const loadRoster = useCallback(async () => {
    if (!locationId) {
      setRoster([]);
      setRosterState("idle");
      return;
    }
    setRosterState("loading");
    setRosterError(null);
    try {
      const rows = await fetchRoster(locationId);
      setRoster(rows.filter((r) => !r.evacuated));
      setRosterState("ok");
    } catch (err) {
      setRoster([]);
      setRosterState("error");
      setRosterError(err instanceof Error ? err.message : "Could not load the roster.");
    }
  }, [locationId]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const overstays = useMemo(
    () => roster.filter((r) => (hoursSince(r.checkInTime) ?? 0) >= OVERSTAY_HOURS).length,
    [roster],
  );

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setVerifyError(null);
    setVerifyResult(null);
    setCheckedInPass(null);
    if (!gateId.trim() || !qrToken.trim()) {
      setVerifyError("Enter both the gate ID and the scanned pass token.");
      return;
    }
    setVerifying(true);
    try {
      const result = await verifyPass({ gateId: gateId.trim(), qrToken: qrToken.trim() });
      setVerifyResult(result);
      if (result.valid) setVerifiedToday((n) => n + 1);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifying(false);
    }
  }

  async function onCheckIn() {
    if (!verifyResult?.valid || !verifyResult.passId) return;
    setBusyPass("checkin");
    setVerifyError(null);
    try {
      await recordCheckIn(verifyResult.passId, gateId.trim());
      setCheckedInPass(verifyResult.passId);
      await loadRoster();
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : "Check-in failed.");
    } finally {
      setBusyPass(null);
    }
  }

  async function onCheckOut(passId: string) {
    setBusyPass(passId);
    try {
      await recordCheckOut(passId, gateId.trim() || "");
      await loadRoster();
    } catch (err) {
      setRosterError(err instanceof Error ? err.message : "Check-out failed.");
    } finally {
      setBusyPass(null);
    }
  }

  return (
    <>
      {/* Gate context */}
      <Card padding>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          <div>
            <label htmlFor="guard-loc" style={labelStyle}>Location</label>
            {locations.length > 0 ? (
              <select
                id="guard-loc"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                style={fieldStyle}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            ) : (
              <input id="guard-loc" placeholder="Location UUID" value={locationId} onChange={(e) => setLocationId(e.target.value)} style={fieldStyle} />
            )}
          </div>
          <div>
            <label htmlFor="guard-gate" style={labelStyle}>Gate terminal ID</label>
            <input
              id="guard-gate"
              placeholder="Gate UUID for this terminal"
              value={gateId}
              onChange={(e) => setGateId(e.target.value)}
              style={{ ...fieldStyle, ...monoStyle }}
            />
          </div>
        </div>
      </Card>

      <StatGrid>
        <StatCard icon="📅" iconBg="#ecfeff" label="Expected Today" value={expectedToday.length.toLocaleString("en-IN")} />
        <StatCard icon="🟢" iconBg="#ecfdf5" label="Inside Now" value={rosterState === "ok" ? roster.length.toLocaleString("en-IN") : "—"} />
        <StatCard icon="⏰" iconBg="#fef2f2" label="Overstays" value={rosterState === "ok" ? overstays.toLocaleString("en-IN") : "—"} />
        <StatCard icon="✔️" iconBg="#eef2ff" label="Verified (session)" value={verifiedToday.toLocaleString("en-IN")} />
      </StatGrid>

      {/* Verify pass */}
      <Card title="Verify pass at gate" padding>
        <form onSubmit={onVerify} style={{ display: "grid", gap: 12 }}>
          <div>
            <label htmlFor="guard-qr" style={labelStyle}>Scanned pass token (QR)</label>
            <textarea
              id="guard-qr"
              value={qrToken}
              onChange={(e) => setQrToken(e.target.value)}
              placeholder="Paste or scan the pass QR token…"
              rows={2}
              style={{ ...fieldStyle, ...monoStyle }}
            />
          </div>
          <div>
            <button type="submit" className="btn primary" disabled={verifying}>
              {verifying ? "Verifying…" : "Verify pass"}
            </button>
          </div>
        </form>

        {verifyError && (
          <p role="alert" style={{ marginTop: 10, fontSize: 13, color: "#b91c1c" }}>⚠ {verifyError}</p>
        )}

        {verifyResult && (
          <div style={{ marginTop: 14, padding: 14, borderRadius: 10, border: "1px solid var(--line)", background: verifyResult.valid ? "var(--primary-soft)" : "#fef2f2" }}>
            {verifyResult.valid ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <StatusPill status="approved" label="Pass valid" />
                  {verifyResult.watchlistFlagged && <StatusPill status="pending" label="Watchlist — review" />}
                </div>
                <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 14px", fontSize: 13 }}>
                  <dt style={{ color: "var(--ink2)" }}>Pass</dt>
                  <dd style={monoStyle}>{verifyResult.passNumber ?? verifyResult.passId ?? "—"}</dd>
                  <dt style={{ color: "var(--ink2)" }}>Type</dt>
                  <dd>{verifyResult.passType ?? "—"}</dd>
                  <dt style={{ color: "var(--ink2)" }}>Valid until</dt>
                  <dd style={monoStyle}>{fmtTime(verifyResult.validUntil)}</dd>
                </dl>
                {checkedInPass === verifyResult.passId ? (
                  <p style={{ marginTop: 10, fontSize: 13, color: "var(--primary-d)", fontWeight: 600 }}>✓ Checked in.</p>
                ) : (
                  <button type="button" className="btn primary" style={{ marginTop: 12 }} disabled={busyPass === "checkin"} onClick={() => void onCheckIn()}>
                    {busyPass === "checkin" ? "Checking in…" : "Admit & check in"}
                  </button>
                )}
              </>
            ) : (
              <>
                <StatusPill status="rejected" label="Pass not valid" />
                <p style={{ marginTop: 8, fontSize: 13, color: "var(--ink2)" }}>
                  {verifyResult.message ?? "This pass cannot be admitted."}{verifyResult.code ? ` (${verifyResult.code})` : ""}
                </p>
              </>
            )}
          </div>
        )}
      </Card>

      {/* Expected today */}
      <Card title={`Expected today (${expectedToday.length})`} padding>
        {expectedTodaySource === "error" ? (
          <EmptyState icon="📅" title="Could not load expected visitors" message="Live data couldn't be reached. Try again shortly." />
        ) : expectedToday.length === 0 ? (
          <EmptyState icon="📅" title="No approved visitors expected today" message="Approved visit requests scheduled for today will appear here." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={labelStyle}>Visitor</th>
                  <th style={labelStyle}>Purpose</th>
                  <th style={labelStyle}>Category</th>
                  <th style={labelStyle}>Scheduled</th>
                  <th style={labelStyle}>Zone</th>
                </tr>
              </thead>
              <tbody>
                {expectedToday.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{v.visitorName}</div>
                      <div style={{ ...monoStyle, fontSize: 12, color: "var(--ink2)" }}>{v.visitorPhone}</div>
                    </td>
                    <td style={{ maxWidth: 260 }}>{v.purpose ?? "—"}</td>
                    <td><StatusPill status={v.visitorCategory === "vip" ? "pending" : "info"} label={v.visitorCategory} /></td>
                    <td style={monoStyle}>{fmtTime(v.scheduledAt)}</td>
                    <td>{v.permittedAreas.length > 0 ? <StatusPill status="pending" label="Restricted" /> : <span style={{ color: "var(--ink2)" }}>General</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Inside now */}
      <Card
        title={`Inside now (${rosterState === "ok" ? roster.length : "—"})`}
        link={<button type="button" className="btn ghost sm" onClick={() => void loadRoster()}>Refresh</button>}
        padding
      >
        {rosterState === "loading" && <p style={{ fontSize: 13, color: "var(--ink2)" }}>Loading roster…</p>}
        {rosterState === "error" && (
          <EmptyState
            icon="🔒"
            title="Live roster unavailable"
            message={rosterError ?? "The premises roster endpoint is restricted (emergency IP allowlist). Ask an administrator to authorise this console's network, then refresh."}
          />
        )}
        {rosterState === "ok" && roster.length === 0 && (
          <EmptyState icon="🟢" title="No one is currently inside" message="Visitors checked in at the gate will appear here until they check out." />
        )}
        {rosterState === "ok" && roster.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={labelStyle}>Visitor</th>
                  <th style={labelStyle}>Host</th>
                  <th style={labelStyle}>Checked in</th>
                  <th style={labelStyle}>Gate</th>
                  <th style={labelStyle}>Status</th>
                  <th style={labelStyle} />
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => {
                  const hrs = hoursSince(r.checkInTime) ?? 0;
                  const over = hrs >= OVERSTAY_HOURS;
                  return (
                    <tr key={r.passId}>
                      <td style={{ fontWeight: 600 }}>{r.visitorName}</td>
                      <td>{r.hostName || "—"}</td>
                      <td style={monoStyle}>{fmtTime(r.checkInTime)}</td>
                      <td>{r.lastKnownGate || "—"}</td>
                      <td>{over ? <StatusPill status="overdue" label={`Overstay · ${Math.floor(hrs)}h`} /> : <StatusPill status="active" label="On premises" />}</td>
                      <td style={{ textAlign: "right" }}>
                        <button type="button" className="btn ghost sm" disabled={busyPass === r.passId} onClick={() => void onCheckOut(r.passId)}>
                          {busyPass === r.passId ? "…" : "Check out"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
