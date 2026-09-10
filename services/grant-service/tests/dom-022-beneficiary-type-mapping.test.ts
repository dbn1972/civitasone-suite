/**
 * DOM-022 regression test — see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md.
 *
 * `grant_beneficiaries_type_check` (migration 0011, mirroring
 * beneficiary/validators.ts's createBeneficiaryBody.type enum) only ever
 * allows the DB to hold type IN ('individual', 'institution', 'society',
 * 'mission'). beneficiary/queries.ts's mapBeneficiaryType used to have a
 * dead branch for the unreachable value "ngo" (and "government") and no
 * explicit case for "society"/"mission", so both of those real, storable
 * values silently collapsed to "individual" in listGranteeSummaries'
 * API response — the exact mislabeling DOM-022 describes.
 *
 * DoD: a beneficiary saved as "society" or "mission" reads back as that
 * type, not "individual".
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { grantBeneficiaries } from "../src/modules/beneficiary/schema.js";
import { listGranteeSummaries } from "../src/modules/beneficiary/queries.js";

const ACTOR = "50000000-aaaa-4000-8000-000000000002";

async function seed(tenant: string, rows: Array<{ id: string; type: string }>) {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.insert(grantBeneficiaries).values(
      rows.map((r) => ({
        id: r.id, tenantId: tenant, name: `Beneficiary ${r.type}`, type: r.type,
        createdBy: ACTOR, updatedBy: ACTOR,
      })),
    );
  }));
}

async function wipe(tenant: string) {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.delete(grantBeneficiaries).where(eq(grantBeneficiaries.tenantId, tenant));
  }));
}

afterAll(async () => { await sqlClient.end(); });

describe("DOM-022 — mapBeneficiaryType matches the DB CHECK's real allowed values", () => {
  it("society and mission beneficiaries read back as their own type, not individual", async () => {
    const tenant = randomUUID();
    const ids = {
      individual: randomUUID(),
      institution: randomUUID(),
      society: randomUUID(),
      mission: randomUUID(),
    };
    await seed(tenant, [
      { id: ids.individual, type: "individual" },
      { id: ids.institution, type: "institution" },
      { id: ids.society, type: "society" },
      { id: ids.mission, type: "mission" },
    ]);
    try {
      const summaries = await listGranteeSummaries(tenant, 100);
      const byId = new Map(summaries.map((s) => [s.id, s.type]));

      // The bug: these two used to fall through the missing cases to "individual".
      expect(byId.get(ids.society)).toBe("society");
      expect(byId.get(ids.mission)).toBe("mission");

      // Unaffected values still map correctly.
      expect(byId.get(ids.individual)).toBe("individual");
      expect(byId.get(ids.institution)).toBe("institution");
    } finally {
      await wipe(tenant);
    }
  });
});
