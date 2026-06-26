/**
 * finance-service: tenant onboarding consumer.
 *
 * Listens for tenant.tenant.onboarded events and seeds the chart-of-accounts
 * (budget.finance_major_heads) with the standard Indian government HoA major
 * heads mandated by CGA / PFMS.
 *
 * Idempotent: the major head code is a PK — duplicate seeds are silently
 * ignored via ON CONFLICT DO NOTHING. Safe to redeliver.
 *
 * These are the canonical CGA major heads covering the core expenditure,
 * receipt, and loan segments required for every government tenant to operate.
 * Tenant-specific sub-heads and minor heads are configured post-onboarding
 * by the finance admin via the HoA management UI.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { financeMajorHeads } from "../hoa/schema.js";

const AUDIT_TOPIC = "audit.event.record";
const TENANT_ONBOARDED = "tenant.tenant.onboarded";

/** Standard CGA major heads seeded for every new government tenant. */
const STANDARD_MAJOR_HEADS: Array<{
  code: string;
  description: string;
  sector: string;
  accountType: string;
}> = [
  // Revenue Receipts
  { code: "0020", description: "Corporation Tax",                           sector: "General",  accountType: "receipt" },
  { code: "0021", description: "Taxes on Income other than Corporation Tax",sector: "General",  accountType: "receipt" },
  { code: "0049", description: "Interest Receipts",                         sector: "General",  accountType: "receipt" },
  { code: "0050", description: "Dividends and Profits",                     sector: "General",  accountType: "receipt" },
  { code: "0070", description: "Other Administrative Services — Receipts",  sector: "General",  accountType: "receipt" },
  { code: "0071", description: "Contributions and Recoveries towards Pension",sector:"Social",  accountType: "receipt" },
  { code: "0075", description: "Miscellaneous General Services",            sector: "General",  accountType: "receipt" },
  // General Services Expenditure
  { code: "2014", description: "Administration of Justice",                 sector: "General",  accountType: "expenditure" },
  { code: "2016", description: "Audit",                                     sector: "General",  accountType: "expenditure" },
  { code: "2049", description: "Interest Payments",                         sector: "General",  accountType: "expenditure" },
  { code: "2052", description: "Secretariat — General Services",            sector: "General",  accountType: "expenditure" },
  { code: "2053", description: "District Administration",                   sector: "General",  accountType: "expenditure" },
  { code: "2054", description: "Treasury and Accounts Administration",      sector: "General",  accountType: "expenditure" },
  { code: "2055", description: "Police",                                    sector: "General",  accountType: "expenditure" },
  { code: "2059", description: "Public Works — Office Buildings",           sector: "General",  accountType: "expenditure" },
  { code: "2070", description: "Other Administrative Services",             sector: "General",  accountType: "expenditure" },
  { code: "2071", description: "Pensions and Other Retirement Benefits",    sector: "Social",   accountType: "expenditure" },
  { code: "2075", description: "Miscellaneous General Services",            sector: "General",  accountType: "expenditure" },
  // Social Services Expenditure
  { code: "2202", description: "General Education",                         sector: "Social",   accountType: "expenditure" },
  { code: "2203", description: "Technical Education",                       sector: "Social",   accountType: "expenditure" },
  { code: "2210", description: "Medical and Public Health",                 sector: "Social",   accountType: "expenditure" },
  { code: "2211", description: "Family Welfare",                            sector: "Social",   accountType: "expenditure" },
  { code: "2215", description: "Water Supply and Sanitation",               sector: "Social",   accountType: "expenditure" },
  { code: "2216", description: "Housing",                                   sector: "Social",   accountType: "expenditure" },
  { code: "2217", description: "Urban Development",                         sector: "Social",   accountType: "expenditure" },
  { code: "2225", description: "Welfare of Scheduled Castes ST and OBC",   sector: "Social",   accountType: "expenditure" },
  { code: "2230", description: "Labour and Employment",                     sector: "Social",   accountType: "expenditure" },
  { code: "2235", description: "Social Security and Welfare",               sector: "Social",   accountType: "expenditure" },
  { code: "2245", description: "Relief on Account of Natural Calamities",  sector: "Social",   accountType: "expenditure" },
  // Economic Services Expenditure
  { code: "2401", description: "Crop Husbandry",                            sector: "Economic", accountType: "expenditure" },
  { code: "2403", description: "Animal Husbandry",                          sector: "Economic", accountType: "expenditure" },
  { code: "2406", description: "Forestry and Wild Life",                    sector: "Economic", accountType: "expenditure" },
  { code: "2415", description: "Agricultural Research and Education",       sector: "Economic", accountType: "expenditure" },
  { code: "2501", description: "Special Programmes for Rural Development",  sector: "Economic", accountType: "expenditure" },
  { code: "2505", description: "Rural Employment",                          sector: "Economic", accountType: "expenditure" },
  { code: "2515", description: "Other Rural Development Programmes",        sector: "Economic", accountType: "expenditure" },
  { code: "2700", description: "Major Irrigation",                          sector: "Economic", accountType: "expenditure" },
  { code: "2702", description: "Minor Irrigation",                          sector: "Economic", accountType: "expenditure" },
  { code: "2801", description: "Power",                                     sector: "Economic", accountType: "expenditure" },
  { code: "2810", description: "New and Renewable Energy",                  sector: "Economic", accountType: "expenditure" },
  { code: "2851", description: "Village and Small Industries",              sector: "Economic", accountType: "expenditure" },
  { code: "2852", description: "Industries",                                sector: "Economic", accountType: "expenditure" },
  { code: "3054", description: "Roads and Bridges",                         sector: "Economic", accountType: "expenditure" },
  { code: "3451", description: "Secretariat — Economic Services",           sector: "Economic", accountType: "expenditure" },
  { code: "3452", description: "Tourism",                                   sector: "Economic", accountType: "expenditure" },
  { code: "3454", description: "Census Surveys and Statistics",             sector: "Economic", accountType: "expenditure" },
  { code: "3475", description: "Other General Economic Services",           sector: "Economic", accountType: "expenditure" },
  // Grants-in-Aid
  { code: "3601", description: "Grants-in-Aid to State Governments",        sector: "General",  accountType: "expenditure" },
  { code: "3602", description: "Grants-in-Aid to UT Governments",           sector: "General",  accountType: "expenditure" },
  // Capital Expenditure
  { code: "4059", description: "Capital Outlay on Public Works",            sector: "General",  accountType: "capital" },
  { code: "4202", description: "Capital Outlay on Education Sports Art Culture", sector: "Social", accountType: "capital" },
  { code: "4210", description: "Capital Outlay on Medical and Public Health",sector: "Social",  accountType: "capital" },
  { code: "4215", description: "Capital Outlay on Water Supply and Sanitation",sector:"Social", accountType: "capital" },
  { code: "4216", description: "Capital Outlay on Housing",                 sector: "Social",   accountType: "capital" },
  { code: "4401", description: "Capital Outlay on Crop Husbandry",          sector: "Economic", accountType: "capital" },
  { code: "4702", description: "Capital Outlay on Minor Irrigation",        sector: "Economic", accountType: "capital" },
  { code: "4801", description: "Capital Outlay on Power Projects",          sector: "Economic", accountType: "capital" },
  { code: "5054", description: "Capital Outlay on Roads and Bridges",       sector: "Economic", accountType: "capital" },
  // Loans
  { code: "6002", description: "Internal Debt of the State Government",     sector: "General",  accountType: "loan" },
  { code: "6004", description: "Loans from the Central Government",         sector: "General",  accountType: "loan" },
  { code: "6202", description: "Loans for Education Sports Art Culture",    sector: "Social",   accountType: "loan" },
  { code: "6401", description: "Loans for Crop Husbandry",                  sector: "Economic", accountType: "loan" },
  { code: "6801", description: "Loans for Power Projects",                  sector: "Economic", accountType: "loan" },
  { code: "7601", description: "Loans to Government Servants etc.",         sector: "General",  accountType: "loan" },
  // Public Account
  { code: "8006", description: "Small Savings Provident Fund etc.",         sector: "Social",   accountType: "public_account" },
  { code: "8009", description: "State Provident Funds",                     sector: "Social",   accountType: "public_account" },
  { code: "8011", description: "Insurance and Pension Funds",               sector: "Social",   accountType: "public_account" },
  { code: "8338", description: "Deposits of Local Funds",                   sector: "General",  accountType: "public_account" },
  { code: "8443", description: "Civil Deposits",                            sector: "General",  accountType: "public_account" },
  { code: "8550", description: "Civil Advances",                            sector: "General",  accountType: "public_account" },
  { code: "8658", description: "Suspense Accounts",                         sector: "General",  accountType: "public_account" },
  { code: "8670", description: "Cheques and Bills",                         sector: "General",  accountType: "public_account" },
  { code: "8999", description: "Cash Balance",                              sector: "General",  accountType: "public_account" },
];

export function registerTenantOnboardConsumers(queue: Queue): void {
  /**
   * tenant.tenant.onboarded → seed the chart-of-accounts for this tenant.
   *
   * Keyed by msg.messageId (the outbox row id) which is stable across relay
   * redeliveries, so markProcessed guarantees exactly-once seeding even if the
   * relay fires multiple times.
   */
  queue.subscribe<{
    tenantId: string;
    adminEmail: string;
    adminName: string;
    edition: string;
  }>(TENANT_ONBOARDED, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent

      // Insert all standard major heads; ON CONFLICT DO NOTHING so re-runs and
      // shared-master scenarios (all tenants on the same DB) are safe.
      for (const head of STANDARD_MAJOR_HEADS) {
        await tx
          .insert(financeMajorHeads)
          .values({
            code:        head.code,
            description: head.description,
            sector:      head.sector,
            accountType: head.accountType,
          })
          .onConflictDoNothing();
      }

      // Audit trail: every mutation must be audited (CLAUDE.md §3).
      await enqueue(tx, {
        topic:         AUDIT_TOPIC,
        eventType:     AUDIT_TOPIC,
        tenantId:      p.tenantId,
        actorId:       msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service:      "finance",
          action:       "seed_chart_of_accounts",
          resourceType: "major_head_master",
          resourceId:   p.tenantId,
          outcome:      "success",
          headsSeeded:  STANDARD_MAJOR_HEADS.length,
        },
      });
    });
  });
}
