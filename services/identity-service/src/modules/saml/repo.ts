import { eq } from "drizzle-orm";
import { db, scopedRead, type Db } from "../../shared/db.js";
import { samlTenantConfig, type SamlTenantConfigRow } from "./schema.js";

export type Writer = Pick<Db, "insert" | "update" | "select">;

export async function findByTenant(tenantId: string): Promise<SamlTenantConfigRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(samlTenantConfig).where(eq(samlTenantConfig.tenantId, tenantId)).limit(1),
  );
  return rows[0] ?? null;
}

export async function findByTenantTx(tx: Writer, tenantId: string): Promise<SamlTenantConfigRow | null> {
  const rows = await tx.select().from(samlTenantConfig).where(eq(samlTenantConfig.tenantId, tenantId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Upsert the per-tenant SAML config. One row per tenant_id (uq_saml_tenant_config_tenant).
 * Runs in a transaction so the find + insert/update is atomic under concurrent PUTs.
 */
export async function upsert(
  tenantId: string,
  actorId: string,
  body: {
    entityId: string;
    acsUrl: string;
    idpMetadataUrl?: string | undefined;
    idpMetadataXml?: string | undefined;
    signRequests: boolean;
    nameIdFormat: "email" | "persistent" | "transient";
  },
): Promise<SamlTenantConfigRow> {
  return db.transaction(async (tx) => {
    const existing = await findByTenantTx(tx, tenantId);
    if (existing) {
      await tx.update(samlTenantConfig)
        .set({
          entityId: body.entityId,
          acsUrl: body.acsUrl,
          idpMetadataUrl: body.idpMetadataUrl ?? null,
          idpMetadataXml: body.idpMetadataXml ?? null,
          signRequests: body.signRequests,
          nameIdFormat: body.nameIdFormat,
          updatedAt: new Date(),
          updatedBy: actorId,
          version: existing.version + 1,
        })
        .where(eq(samlTenantConfig.tenantId, tenantId));
    } else {
      await tx.insert(samlTenantConfig).values({
        tenantId,
        entityId: body.entityId,
        acsUrl: body.acsUrl,
        idpMetadataUrl: body.idpMetadataUrl ?? null,
        idpMetadataXml: body.idpMetadataXml ?? null,
        signRequests: body.signRequests,
        nameIdFormat: body.nameIdFormat,
        createdBy: actorId,
        updatedBy: actorId,
      });
    }
    const saved = await findByTenantTx(tx, tenantId);
    if (!saved) throw new Error("saml config upsert did not persist");
    return saved;
  });
}
