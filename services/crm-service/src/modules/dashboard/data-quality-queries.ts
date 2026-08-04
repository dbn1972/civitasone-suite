/**
 * Data-quality dashboard queries (DQ-004).
 * Loads the tenant's active records and builds a data-quality report.
 */
import { eq, and, sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { contacts, accounts } from "../contacts/schema.js";
import {
  buildReport,
  type DataQualityEntity,
  type DataQualityFilter,
  type RecordInput,
  type DataQualityReport,
} from "./data-quality.js";

const SCAN_LIMIT = 5000;

async function loadContactRecords(tenantId: string): Promise<RecordInput[]> {
  const rows = await scopedRead((tx) =>
    tx
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        phone: contacts.phone,
        company: contacts.company,
        designation: contacts.designation,
        city: contacts.city,
        leadSource: contacts.leadSource,
        pincode: contacts.pincode,
        gstin: contacts.gstin,
        pan: contacts.pan,
        lastActivityAt: contacts.lastActivityAt,
      })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), sql`${contacts.status} = 'active'`))
      .limit(SCAN_LIMIT),
  );
  return rows.map((r) => ({
    id: r.id,
    attributes: {
      name: r.name,
      email: r.email,
      phone: r.phone,
      company: r.company,
      designation: r.designation,
      city: r.city,
      leadSource: r.leadSource,
      pincode: r.pincode,
      gstin: r.gstin,
      pan: r.pan,
    },
    lastActivityAt: r.lastActivityAt,
  }));
}

async function loadAccountRecords(tenantId: string): Promise<RecordInput[]> {
  // Accounts carry no last-activity timestamp; use updated_at as the recency
  // proxy for staleness.
  const rows = await scopedRead((tx) =>
    tx
      .select({
        id: accounts.id,
        name: accounts.name,
        industry: accounts.industry,
        website: accounts.website,
        gstin: accounts.gstin,
        pan: accounts.pan,
        updatedAt: accounts.updatedAt,
      })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), sql`${accounts.status} = 'active'`))
      .limit(SCAN_LIMIT),
  );
  return rows.map((r) => ({
    id: r.id,
    attributes: {
      name: r.name,
      industry: r.industry,
      website: r.website,
      gstin: r.gstin,
      pan: r.pan,
    },
    lastActivityAt: r.updatedAt,
  }));
}

export async function getDataQuality(
  tenantId: string,
  entity: DataQualityEntity,
  opts: { staleDays: number; filter?: DataQualityFilter | null },
): Promise<DataQualityReport> {
  const records =
    entity === "accounts" ? await loadAccountRecords(tenantId) : await loadContactRecords(tenantId);
  return buildReport(records, entity, {
    staleDays: opts.staleDays,
    filter: opts.filter ?? null,
  });
}
