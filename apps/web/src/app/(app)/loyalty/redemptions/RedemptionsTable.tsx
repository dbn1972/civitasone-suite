"use client";

import { useRouter } from "next/navigation";
import { DataTable, EmptyState, StatusPill, ActionButton } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatIndianDate, formatPoints, humanizeStatus } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import type { LoyaltyRedemptionRow } from "../_data";

/**
 * GAP-LOYALTY-REDEMPTIONS-02: a dedicated redemptions table with Reward,
 * Points, Status, Requested and Voided columns — replacing the generic
 * ID/Name/Detail/Status/Meta table that had no reward or points column.
 * GAP-LOYALTY-REDEMPTIONS-03: the reward label is the humanised reward type
 * ("Points redeem" not "POINTS_REDEEM"); a row with no reward type shows "—",
 * never a raw id. GAP-LOYALTY-REDEMPTIONS-01 is handled in the shared
 * ModuleListTable, but this dedicated table applies the same error-vs-empty
 * distinction directly.
 *
 * GAP-LOYALTY-REDEMPTIONS-02 (UAT B4): a pending redemption can now be
 * FULFILLED (POST .../fulfil) or REJECTED with a reason (POST .../reject,
 * which restores the held points), alongside the existing Void. All three are
 * admin-only buttons; the server remains the authority (including the
 * segregation-of-duties rule that the officer who raised a redemption cannot
 * fulfil it) and its refusal is surfaced as a plain-language message.
 */

type RedemptionTableRow = {
  id: string;
  reward: string;
  points: string;
  status: string;
  requested: string;
  fulfilled: string;
  voided: string;
  version: number | undefined;
  canVoid: boolean;
  canDecide: boolean;
};

function voidActionError(status?: number): string {
  const kind = status === 403 ? "forbidden" : status === 409 || status === 422 ? "conflict" : "save";
  const human = toHumanError(kind, { area: "redemption" });
  return `${human.what} ${human.next}`;
}

async function postDecision(
  id: string,
  action: "fulfil" | "reject",
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`/api/proxy/v1/loyalty/redemptions/${id}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function RedemptionsTable({
  rows,
  source,
  canManage = false,
}: {
  rows: LoyaltyRedemptionRow[];
  source: "api" | "error";
  canManage?: boolean;
}) {
  const router = useRouter();
  const { data, provenance, offline, cachedAt } = useSeededResource<LoyaltyRedemptionRow[]>(
    "loyalty.redemptions",
    rows,
    source,
    (d) => d.length === 0,
  );

  if ((provenance ?? "live") === "error-no-data") {
    return (
      <div className="card">
        <RefreshErrorState
          error={{
            what: "We couldn't load redemptions.",
            next: "Check your connection and try again.",
            actions: ["retry", "help"],
          }}
          backHref="/loyalty"
        />
      </div>
    );
  }

  async function voidRedemption(id: string, versionRaw: number | undefined, reason?: string) {
    const res = await fetch(`/api/proxy/v1/loyalty/redemptions/${id}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason ?? "", version: versionRaw ?? 1 }),
    });
    if (!res.ok) {
      if (res.status === 409 || res.status === 422) router.refresh();
      throw new Error(voidActionError(res.status));
    }
    router.refresh();
  }

  async function decide(id: string, action: "fulfil" | "reject", versionRaw: number | undefined, reason?: string) {
    const res = await postDecision(
      id,
      action,
      action === "reject" ? { reason: reason ?? "", version: versionRaw ?? 1 } : { version: versionRaw ?? 1 },
    );
    if (!res.ok) {
      if (res.status === 409 || res.status === 422) router.refresh();
      throw new Error(voidActionError(res.status));
    }
    router.refresh();
  }

  const tableRows: RedemptionTableRow[] = data.map((r) => ({
    id: r.id,
    reward: r.rewardType ? humanizeStatus(r.rewardType) : "—",
    points: formatPoints(r.points),
    status: r.status,
    requested: r.redeemedAt ? formatIndianDate(r.redeemedAt) : "—",
    fulfilled: r.fulfilledAt ? formatIndianDate(r.fulfilledAt) : "—",
    voided: r.voidedAt ? formatIndianDate(r.voidedAt) : "—",
    version: r.version ?? undefined,
    canVoid: canManage && (r.status === "pending" || r.status === "confirmed"),
    canDecide: canManage && r.status === "pending",
  }));

  return (
    <div className="card">
      <div className="card-h">
        <h3>Redemptions</h3>
      </div>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {tableRows.length === 0 ? (
        <EmptyState icon="🎁" title="No redemptions" message="No redemption history to show yet." />
      ) : (
        <DataTable<RedemptionTableRow>
          columns={[
            { key: "reward", label: "Reward" },
            { key: "points", label: "Points", align: "right" },
            { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
            { key: "requested", label: "Requested" },
            { key: "fulfilled", label: "Fulfilled" },
            { key: "voided", label: "Voided" },
            ...(canManage
              ? [
                  {
                    key: "id" as const,
                    label: "Actions",
                    sortable: false,
                    csvExclude: true,
                    render: (r: RedemptionTableRow) =>
                      r.canVoid || r.canDecide ? (
                        <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                          {r.canDecide && (
                            <ActionButton
                              label="Fulfil"
                              className="btn"
                              confirmTitle="Fulfil this redemption?"
                              confirmDescription="Confirms the reward has been handed over. The points stay deducted."
                              onConfirm={() => decide(r.id, "fulfil", r.version)}
                            />
                          )}
                          {r.canDecide && (
                            <ActionButton
                              label="Reject"
                              danger
                              className="btn danger"
                              confirmTitle="Reject this redemption?"
                              confirmDescription="Rejecting restores the member's points and cannot be undone."
                              requireReason
                              reasonLabel="Reason for rejecting"
                              onConfirm={(reason) => decide(r.id, "reject", r.version, reason)}
                            />
                          )}
                          {r.canVoid && (
                            <ActionButton
                              label="Void"
                              danger
                              className="btn danger"
                              confirmTitle="Void this redemption?"
                              confirmDescription="Voiding restores the member's points and cannot be undone."
                              requireReason
                              reasonLabel="Reason for voiding"
                              onConfirm={(reason) => voidRedemption(r.id, r.version, reason)}
                            />
                          )}
                        </span>
                      ) : (
                        <span style={{ fontSize: 13, color: "var(--ink2)" }}>—</span>
                      ),
                  },
                ]
              : []),
          ]}
          rows={tableRows}
          sortable
          filterable
          filterPlaceholder="Filter redemptions…"
          pageSize={25}
        />
      )}
    </div>
  );
}
