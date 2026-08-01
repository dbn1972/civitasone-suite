"use client";

import { useState } from "react";
import { DataTable, Tabs, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import type { LoaderSource } from "@/app/_data/apiClient";
import { formatMoney, formatBps, formatIndianDate } from "@/lib/formatters";
import { RateHeadSelector } from "./RateHeadSelector";
import { CreateRateHeadForm } from "./CreateRateHeadForm";
import { CreateRateSlabForm } from "./CreateRateSlabForm";
import { CreatePenaltyRuleForm } from "./CreatePenaltyRuleForm";
import { CreateRebateRuleForm } from "./CreateRebateRuleForm";
import type { RateHeadRow, RateSlabRow, PenaltyRuleRow, RebateRuleRow } from "./types";

const TABS = ["Rate Heads", "Rate Slabs", "Penalty Rules", "Rebate Rules"] as const;
type Tab = (typeof TABS)[number];

interface RateConfigConsoleProps {
  rateHeads: RateHeadRow[];
  rateHeadsSource: LoaderSource;
  selectedRateHeadId: string | null;
  slabs: RateSlabRow[];
  slabsSource: LoaderSource;
  penaltyRules: PenaltyRuleRow[];
  penaltyRulesSource: LoaderSource;
  rebateRules: RebateRuleRow[];
  rebateRulesSource: LoaderSource;
}

type WithStatus<T> = T & { statusLabel: string } & Record<string, unknown>;

function withStatus<T extends { isActive: boolean }>(rows: T[]): WithStatus<T>[] {
  return rows.map((r) => ({ ...r, statusLabel: r.isActive ? "active" : "inactive" }));
}

export function RateConfigConsole({
  rateHeads,
  rateHeadsSource,
  selectedRateHeadId,
  slabs,
  slabsSource,
  penaltyRules,
  penaltyRulesSource,
  rebateRules,
  rebateRulesSource,
}: RateConfigConsoleProps) {
  const [active, setActive] = useState<Tab>("Rate Heads");
  const selectedRateHead = rateHeads.find((rh) => rh.id === selectedRateHeadId) ?? null;

  return (
    <div>
      <Tabs tabs={[...TABS]} active={active} onChange={(t) => { setActive(t as Tab); }} />

      {active === "Rate Heads" && (
        <div>
          <CreateRateHeadForm />
          {rateHeads.length === 0 ? (
            rateHeadsSource === "error" ? (
              <DataSourceBadge source="error" />
            ) : (
              <EmptyState
                icon="🏷️"
                title="No rate heads configured"
                message="Create the first rate head (e.g. Property Tax, Water Charge) using the form above."
              />
            )
          ) : (
            <DataTable<WithStatus<RateHeadRow>>
              columns={[
                { key: "code", label: "Code" },
                { key: "name", label: "Name" },
                { key: "category", label: "Category" },
                { key: "unitOfMeasure", label: "Unit of Measure", render: (r) => r.unitOfMeasure ?? "—" },
                { key: "statusLabel", label: "Status", cellType: "status" },
              ]}
              rows={withStatus(rateHeads)}
              sortable
              filterable
              filterPlaceholder="Filter by code or name…"
              pageSize={15}
            />
          )}
        </div>
      )}

      {active === "Rate Slabs" && (
        <div>
          <RateHeadSelector rateHeads={rateHeads} selectedId={selectedRateHeadId} />
          {!selectedRateHead ? (
            <EmptyState
              icon="🏷️"
              title="Select a rate head"
              message="Create a rate head first, then choose it above to configure its rate slabs."
            />
          ) : (
            <div>
              <CreateRateSlabForm rateHeadId={selectedRateHead.id} rateHeadLabel={`${selectedRateHead.code} — ${selectedRateHead.name}`} />
              {slabs.length === 0 ? (
                slabsSource === "error" ? (
                  <DataSourceBadge source="error" />
                ) : (
                  <EmptyState
                    icon="📶"
                    title="No rate slabs for this rate head"
                    message="Create the first slab using the form above."
                  />
                )
              ) : (
                <DataTable<WithStatus<RateSlabRow>>
                  columns={[
                    { key: "slabType", label: "Slab Type", cellType: "status" },
                    {
                      key: "bandFrom",
                      label: "Band From",
                      align: "right",
                      render: (r) => (r.bandFrom !== null ? formatMoney(r.bandFrom) : "—"),
                    },
                    {
                      key: "bandTo",
                      label: "Band To",
                      align: "right",
                      render: (r) => (r.bandTo !== null ? formatMoney(r.bandTo) : "—"),
                    },
                    {
                      key: "rateValue",
                      label: "Rate Value",
                      align: "right",
                      render: (r) => (r.slabType === "ad_valorem" ? formatBps(r.rateValue) : formatMoney(r.rateValue)),
                    },
                    {
                      key: "effectiveFrom",
                      label: "Effective From",
                      render: (r) => formatIndianDate(r.effectiveFrom),
                    },
                    {
                      key: "effectiveTo",
                      label: "Effective To",
                      render: (r) => (r.effectiveTo ? formatIndianDate(r.effectiveTo) : "—"),
                    },
                    { key: "statusLabel", label: "Status", cellType: "status" },
                  ]}
                  rows={withStatus(slabs)}
                  sortable
                  pageSize={15}
                />
              )}
            </div>
          )}
        </div>
      )}

      {active === "Penalty Rules" && (
        <div>
          <RateHeadSelector rateHeads={rateHeads} selectedId={selectedRateHeadId} />
          {!selectedRateHead ? (
            <EmptyState
              icon="⚖️"
              title="Select a rate head"
              message="Create a rate head first, then choose it above to configure its penalty (interest) rules."
            />
          ) : (
            <div>
              <CreatePenaltyRuleForm rateHeadId={selectedRateHead.id} rateHeadLabel={`${selectedRateHead.code} — ${selectedRateHead.name}`} />
              {penaltyRules.length === 0 ? (
                penaltyRulesSource === "error" ? (
                  <DataSourceBadge source="error" />
                ) : (
                  <EmptyState
                    icon="⚖️"
                    title="No penalty rules for this rate head"
                    message="Create the first penalty (interest) rule using the form above."
                  />
                )
              ) : (
                <DataTable<WithStatus<PenaltyRuleRow>>
                  columns={[
                    { key: "interestType", label: "Interest Type", cellType: "status" },
                    { key: "annualRateBps", label: "Annual Rate", align: "right", render: (r) => formatBps(r.annualRateBps) },
                    { key: "graceDays", label: "Grace Days", align: "right" },
                    { key: "capMonths", label: "Cap (Months)", align: "right", render: (r) => r.capMonths ?? "—" },
                    { key: "roundingMode", label: "Rounding" },
                    { key: "statusLabel", label: "Status", cellType: "status" },
                  ]}
                  rows={withStatus(penaltyRules)}
                  sortable
                  pageSize={15}
                />
              )}
            </div>
          )}
        </div>
      )}

      {active === "Rebate Rules" && (
        <div>
          <RateHeadSelector rateHeads={rateHeads} selectedId={selectedRateHeadId} />
          {!selectedRateHead ? (
            <EmptyState
              icon="💸"
              title="Select a rate head"
              message="Create a rate head first, then choose it above to configure its rebate rules."
            />
          ) : (
            <div>
              <CreateRebateRuleForm rateHeadId={selectedRateHead.id} rateHeadLabel={`${selectedRateHead.code} — ${selectedRateHead.name}`} />
              {rebateRules.length === 0 ? (
                rebateRulesSource === "error" ? (
                  <DataSourceBadge source="error" />
                ) : (
                  <EmptyState
                    icon="💸"
                    title="No rebate rules for this rate head"
                    message="Create the first rebate rule using the form above."
                  />
                )
              ) : (
                <DataTable<WithStatus<RebateRuleRow>>
                  columns={[
                    { key: "rebateType", label: "Rebate Type" },
                    { key: "discountBps", label: "Discount", align: "right", render: (r) => formatBps(r.discountBps) },
                    {
                      key: "validUntilDaysBeforeDue",
                      label: "Valid Until (Days Before Due)",
                      align: "right",
                      render: (r) => r.validUntilDaysBeforeDue ?? "—",
                    },
                    { key: "statusLabel", label: "Status", cellType: "status" },
                  ]}
                  rows={withStatus(rebateRules)}
                  sortable
                  pageSize={15}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
