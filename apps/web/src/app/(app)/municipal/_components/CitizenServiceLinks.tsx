import Link from "next/link";
import { citizenApplyHref, citizenServiceHref, type MunicipalServiceConfig } from "../_data/services";

type Props = {
  config: MunicipalServiceConfig;
  counterMode?: boolean;
};

/** Citizen portal entry points — apply + service landing (track via service page). */
export function CitizenServiceLinks({ config, counterMode = false }: Props) {
  // GAP-MUNICIPAL-SERVICEKEY-04: no citizen-service manifest wired up yet for
  // this service. Rather than silently rendering nothing (which left officers
  // with no explanation of how citizens apply), show a muted note that intake
  // is counter-only for now. Decision: counter-only intake is the SAFE,
  // honest default to surface; product should confirm the exact process.
  if (!config.citizenServiceKey) {
    return (
      <div
        className="pad"
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          background: "var(--surface-2, var(--bg))",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-sm)",
        }}
      >
        <span style={{ fontSize: 13, color: "var(--ink2)" }}>
          Applications for this service are recorded by officers at the counter; no online citizen
          form is published yet.
        </span>
      </div>
    );
  }

  const applyHref = citizenApplyHref(config.citizenServiceKey);
  const serviceHref = citizenServiceHref(config.citizenServiceKey);
  const applyQs = counterMode ? "?counter=1" : "";

  return (
    <div
      className="pad"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "center",
        background: "var(--surface-2, var(--bg))",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-sm)",
      }}
    >
      <span style={{ fontSize: 13, color: "var(--ink2)", flex: "1 1 200px" }}>
        Citizen self-service — apply online or open the published service page to track status.
      </span>
      <Link href={`${applyHref}${applyQs}`} className="btn primary" style={{ minHeight: 40 }}>
        Apply online
      </Link>
      <Link href={serviceHref} className="btn ghost" style={{ minHeight: 40 }}>
        Service page &amp; track
      </Link>
    </div>
  );
}
