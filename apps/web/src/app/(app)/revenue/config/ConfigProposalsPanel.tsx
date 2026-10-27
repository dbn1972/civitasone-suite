"use client";

import { useState } from "react";
import { Button, Card, StatusPill } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { DecideActions } from "../_components/DecideActions";

export type ConfigProposal = {
  id: string;
  kind: "rate_head" | "rate_slab" | "penalty_rule" | "rebate_rule";
  action: "create" | "revise" | "end_date";
  status: string;
  makerUserId: string | null;
  effectiveFrom: string;
  targetId: string | null;
  rateHeadId: string | null;
  payload: Record<string, unknown>;
  decisionReason: string | null;
};

const KIND_LABEL: Record<ConfigProposal["kind"], string> = {
  rate_head: "rate head",
  rate_slab: "rate slab",
  penalty_rule: "penalty rule",
  rebate_rule: "rebate rule",
};

/** "New version of a rate slab", "Deactivation (end-date) of a penalty rule", "New rebate rule". */
export function describeProposal(p: Pick<ConfigProposal, "kind" | "action">): string {
  const k = KIND_LABEL[p.kind];
  if (p.action === "revise") return `New version of a ${k}`;
  if (p.action === "end_date") return `Deactivation (end-date) of a ${k}`;
  return `New ${k}`;
}

type SampleResult = { principal: string; rebate: string; penalty: string; interest: string; net: string; error?: string };
type Preview = {
  blocked: string | null;
  changes: Array<{ op: "insert" | "update"; table: string; id?: string; values: Record<string, unknown> }>;
  sample: { asOfDate: string; dueDate: string; baseValue: string; before: SampleResult; after: SampleResult } | null;
};

function changeLine(c: Preview["changes"][number]): string {
  if (c.op === "update") {
    const end = c.values.effectiveTo;
    return typeof end === "string" ? `The existing row ends on ${formatIndianDate(end)} (it is not edited).` : "The existing row is updated.";
  }
  const from = c.values.effectiveFrom;
  return `A new row is added${typeof from === "string" ? `, effective from ${formatIndianDate(from)}` : ""}.`;
}

function PreviewBox({ proposalId }: { proposalId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [preview, setPreview] = useState<Preview | null>(null);

  async function load() {
    setState("loading");
    try {
      const res = await browserJson<{ data?: Preview }>(`v1/revenue/rate-config/proposals/${proposalId}/preview`, { method: "GET" });
      setPreview(res.data ?? null);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div>
        <Button type="button" variant="secondary" style={{ minHeight: 40 }} aria-label="Preview proposal" onClick={() => void load()} disabled={state === "loading"}>
          {state === "loading" ? "Loading preview…" : "Preview the effect"}
        </Button>
      </div>
      {state === "error" && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--bad)" }}>
          We couldn&apos;t load the preview. Try again in a moment.
        </p>
      )}
      {state === "ready" && preview && (
        <div style={{ display: "grid", gap: 8, fontSize: 13.5 }}>
          {preview.blocked ? (
            <p role="alert" style={{ margin: 0, color: "var(--bad)" }}>
              This proposal cannot be applied as it stands: {preview.blocked}
            </p>
          ) : (
            <>
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {preview.changes.map((c, i) => (
                  <li key={i}>{changeLine(c)}</li>
                ))}
              </ul>
              {preview.sample ? (
                <table aria-label="Before and after on a sample demand" style={{ borderCollapse: "collapse", maxWidth: 520 }}>
                  <caption style={{ textAlign: "start", fontSize: 12.5, color: "var(--ink2)", paddingBottom: 4 }}>
                    Sample: base value {formatMoney(preview.sample.baseValue)}, 90 days overdue, as of {formatIndianDate(preview.sample.asOfDate)}
                  </caption>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "start" }} />
                      <th style={{ textAlign: "end" }}>Before</th>
                      <th style={{ textAlign: "end" }}>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["principal", "rebate", "penalty", "net"] as const).map((k) => (
                      <tr key={k}>
                        <td style={{ textTransform: "capitalize", paddingInlineEnd: 12 }}>{k}</td>
                        <td style={{ textAlign: "end" }}>{formatMoney(preview.sample!.before[k])}</td>
                        <td style={{ textAlign: "end", fontWeight: 600 }}>{formatMoney(preview.sample!.after[k])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ margin: 0, color: "var(--ink2)" }}>No rate is changing, so there is no computed sample for this proposal.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Owner decision #2 (2026-10-26): rate configuration is maker-checker. This
 * panel is the checker's queue — proposals awaiting a DIFFERENT officer's
 * decision, each with a preview of its effect — plus the recent decisions.
 */
export function ConfigProposalsPanel({
  proposals,
  currentUserId,
}: {
  proposals: ConfigProposal[];
  currentUserId?: string | null;
}) {
  const pending = proposals.filter((p) => p.status === "pending");
  const decided = proposals.filter((p) => p.status !== "pending").slice(0, 10);
  if (pending.length === 0 && decided.length === 0) return null;

  return (
    <div style={{ display: "grid", gap: 16, marginBottom: 16 }}>
      {pending.length > 0 && (
        <Card title="Awaiting approval" padding>
          <p style={{ margin: "0 0 12px", fontSize: 13.5, color: "var(--ink2)" }}>
            Rate configuration drives every demand, penalty and rebate, so each change needs a second officer. The
            officer who proposed a change cannot approve it. Nothing below is live until it is approved.
          </p>
          <div style={{ display: "grid", gap: 16 }}>
            {pending.map((p) => (
              <div key={p.id} style={{ display: "grid", gap: 10, paddingBottom: 14, borderBottom: "1px solid var(--line)" }}>
                <div style={{ fontSize: 14 }}>
                  <strong>{describeProposal(p)}</strong> — effective from {formatIndianDate(p.effectiveFrom)}
                </div>
                <PreviewBox proposalId={p.id} />
                <DecideActions
                  decideUrl={`v1/revenue/rate-config/proposals/${p.id}/decide`}
                  noun="rate-config proposal"
                  status={p.status}
                  makerUserId={p.makerUserId}
                  currentUserId={currentUserId}
                  summary={<>{describeProposal(p).toLowerCase()} effective {formatIndianDate(p.effectiveFrom)}</>}
                />
              </div>
            ))}
          </div>
        </Card>
      )}
      {decided.length > 0 && (
        <Card title="Recent decisions" padding>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8, fontSize: 13.5 }}>
            {decided.map((p) => (
              <li key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <StatusPill status={p.status} label={p.status} />
                <span>
                  {describeProposal(p)} — effective {formatIndianDate(p.effectiveFrom)}
                </span>
                {p.decisionReason && <span style={{ color: "var(--ink2)" }}>({p.decisionReason})</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
