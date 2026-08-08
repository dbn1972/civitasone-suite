/**
 * FN-16 — Reporting & Analytics per Service.
 * FN-31 — Per-Service KPI Dashboard.
 * Pure domain, no I/O.
 *
 * BRD FN-16: "auto-attach archetype-keyed reports: issued register, pending/SLA
 * breach, revenue vs demand … Acceptance: new Certificate pack gets working
 * Issued Register without extra config."
 * BRD FN-31: "auto dashboard: volume, median processing time, fee collection
 * rate, SLA compliance … Acceptance: publish new pack → dashboard populates."
 *
 * "Without extra config" is the whole requirement: a designer publishes a pack
 * and reports/tiles exist. So both functions here are total over ServicePattern
 * and derive everything from blocks the pack already carries.
 *
 * THE RULE THAT SHAPES THIS MODULE: a report or tile is emitted only when its
 * data can actually exist. A free service must not get a "Revenue vs Demand"
 * report — an empty revenue report does not read as "not applicable", it reads
 * as "collection has failed", and a department head acts on that. Likewise no
 * SLA compliance tile without an SLA to comply with. Suppressing an
 * inapplicable metric is more honest than rendering it at zero, and it is why
 * every builder below takes the pack's blocks rather than only its pattern.
 *
 * Correspondingly, no metric is invented that the data model cannot answer:
 * booking no-show and cancellation rates are absent because no application
 * status records either. Adding them would produce a permanently-zero tile.
 */

import type { ServicePattern } from "../catalogue/domain.js";

/* ─────────────────────────── shared inputs ─────────────────────────── */

/** The subset of pack blocks that decides what is measurable. */
export interface AnalyticsBlocks {
  slaDays?: number | undefined;
  feeFromMinor?: number | undefined;
  feeModel?: string | undefined;
  issuanceType?: string | undefined;
  outputs?: readonly { type: string }[] | undefined;
}

function charges(blocks: AnalyticsBlocks | null | undefined): boolean {
  // A pack that names a fee model but no amount still collects (slab/formula
  // schedules resolve the amount at runtime), so either signal counts.
  const fee = blocks?.feeFromMinor;
  if (typeof fee === "number" && fee > 0) return true;
  return typeof blocks?.feeModel === "string" && blocks.feeModel.length > 0 && fee !== 0;
}

function hasSla(blocks: AnalyticsBlocks | null | undefined): boolean {
  return typeof blocks?.slaDays === "number" && blocks.slaDays > 0;
}

/* ──────────────────────────── FN-16 reports ─────────────────────────── */

export interface ReportTemplate {
  key: string;
  title: string;
  /** Plain-language purpose, shown under the title in the report list. */
  purpose: string;
  columns: string[];
  /** Filters offered to the user; date range is implicit on every report. */
  filters: string[];
  /** Who this report is for — drives default visibility. */
  audience: ("department_head" | "finance" | "auditor" | "counter_staff")[];
}

const ISSUED_REGISTER_COLUMNS = [
  "applicationNumber", "outputNumber", "applicantName", "ward",
  "submittedAt", "issuedAt", "processingDays", "office", "issuedBy",
];

const PENDING_COLUMNS = [
  "applicationNumber", "applicantName", "currentLane", "assignedTo",
  "submittedAt", "ageDays", "slaDueAt", "slaBreached", "office",
];

const REVENUE_COLUMNS = [
  "applicationNumber", "demandedMinor", "collectedMinor", "outstandingMinor",
  "paymentMode", "receiptNumber", "collectedAt", "hoaCode", "office",
];

/** The register of things this pattern produces — named for what it produces. */
function registerReport(pattern: ServicePattern): ReportTemplate {
  switch (pattern) {
    case "certificate":
      return {
        key: "issued_register",
        title: "Issued Register",
        purpose: "Every certificate issued in the period, with how long each took.",
        columns: ISSUED_REGISTER_COLUMNS,
        filters: ["office", "ward", "issuedBy"],
        audience: ["department_head", "auditor"],
      };
    case "booking":
      return {
        key: "booking_register",
        title: "Booking Register",
        purpose: "Every confirmed booking in the period, by facility and slot.",
        columns: [...ISSUED_REGISTER_COLUMNS, "facility", "bookingDate", "slot"],
        filters: ["office", "facility", "bookingDate"],
        audience: ["department_head", "counter_staff"],
      };
    case "collection":
      return {
        key: "demand_collection_register",
        title: "Demand & Collection Register",
        purpose: "Demand raised against collection received, with arrears carried forward.",
        columns: [...REVENUE_COLUMNS, "demandPeriod", "arrearsMinor"],
        filters: ["office", "ward", "demandPeriod"],
        audience: ["finance", "auditor", "department_head"],
      };
    case "grievance":
      return {
        key: "grievance_register",
        title: "Grievance Register",
        purpose: "Every grievance received in the period and how it was disposed.",
        columns: [
          "applicationNumber", "category", "ward", "submittedAt",
          "resolvedAt", "processingDays", "outcome", "office",
        ],
        filters: ["office", "ward", "category", "outcome"],
        audience: ["department_head", "auditor"],
      };
  }
}

/**
 * Reports auto-attached to a published pack.
 *
 * Total over ServicePattern — a new pattern will fail to compile here rather
 * than silently publish with no reports.
 */
export function reportTemplatesForPack(
  pattern: ServicePattern,
  blocks: AnalyticsBlocks | null | undefined = {},
): ReportTemplate[] {
  const reports: ReportTemplate[] = [registerReport(pattern)];

  reports.push({
    key: "pending_sla_breach",
    title: hasSla(blocks) ? "Pending & SLA Breach" : "Pending Applications",
    purpose: hasSla(blocks)
      ? "Everything still open, flagged where it has passed its SLA."
      : "Everything still open, oldest first. No SLA is set for this service.",
    columns: hasSla(blocks) ? PENDING_COLUMNS : PENDING_COLUMNS.filter((c) => !c.startsWith("sla")),
    filters: hasSla(blocks) ? ["office", "currentLane", "slaBreached"] : ["office", "currentLane"],
    audience: ["department_head", "counter_staff"],
  });

  // Only for services that take money — see the module header.
  if (charges(blocks) && pattern !== "collection") {
    reports.push({
      key: "revenue_vs_demand",
      title: "Revenue vs Demand",
      purpose: "Fee demanded against fee actually collected, by head of account.",
      columns: REVENUE_COLUMNS,
      filters: ["office", "paymentMode", "hoaCode"],
      audience: ["finance", "auditor"],
    });
  }

  return reports;
}

/* ────────────────────────── FN-31 dashboard ─────────────────────────── */

export type KpiUnit = "count" | "days" | "percent";

export interface KpiTile {
  key: string;
  title: string;
  unit: KpiUnit;
  /** What the number means, so a tile is never read the wrong way round. */
  description: string;
  /** True when a higher number is the better outcome. */
  higherIsBetter: boolean;
  /** Target to compare against, when the pack declares one. */
  target?: number | undefined;
}

/**
 * KPI tiles for a published pack's dashboard.
 *
 * Every tile answers a question the application/payment data can answer. Tiles
 * whose data cannot exist for this pack are omitted rather than shown at zero.
 */
export function dashboardTilesForPack(
  pattern: ServicePattern,
  blocks: AnalyticsBlocks | null | undefined = {},
): KpiTile[] {
  const tiles: KpiTile[] = [
    {
      key: "volume",
      title: "Applications received",
      unit: "count",
      description: "Applications submitted in the selected period.",
      higherIsBetter: true,
    },
    {
      key: "median_processing_days",
      title: "Median processing time",
      unit: "days",
      description: "Middle value of submission-to-disposal time for cases closed in the period.",
      higherIsBetter: false,
      ...(hasSla(blocks) ? { target: blocks!.slaDays } : {}),
    },
    {
      key: "disposal_rate",
      title: "Disposal rate",
      unit: "percent",
      description: "Share of applications received in the period that have reached a final decision.",
      higherIsBetter: true,
    },
  ];

  if (hasSla(blocks)) {
    tiles.push({
      key: "sla_compliance",
      title: "SLA compliance",
      unit: "percent",
      description: `Share of disposed applications closed within the ${blocks!.slaDays}-day SLA.`,
      higherIsBetter: true,
      target: 100,
    });
  }

  if (charges(blocks)) {
    tiles.push({
      key: "fee_collection_rate",
      title: "Fee collection rate",
      unit: "percent",
      description: "Fee collected as a share of fee demanded in the period.",
      higherIsBetter: true,
      target: 100,
    });
  }

  // Pattern-specific tiles, each backed by data that genuinely exists.
  if (pattern === "certificate" || pattern === "booking") {
    tiles.push({
      key: "rejection_rate",
      title: "Rejection rate",
      unit: "percent",
      description: "Share of disposed applications that were rejected.",
      higherIsBetter: false,
    });
  }
  if (pattern === "grievance") {
    tiles.push({
      key: "escalation_rate",
      title: "Escalation rate",
      unit: "percent",
      description: "Share of grievances that passed their lane SLA and were escalated.",
      higherIsBetter: false,
    });
  }

  return tiles;
}
