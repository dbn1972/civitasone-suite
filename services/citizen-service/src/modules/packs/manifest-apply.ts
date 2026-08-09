import type { ServiceDefinitionInsert } from "../catalogue/schema.js";
import type { LaneBinding } from "../catalogue/lane-bindings.js";
import type { RequiredDocument } from "../catalogue/domain.js";
import { tradeLicenseManifestBlocks } from "./manifests/trade-license.js";
import { hallBookingManifestBlocks } from "./manifests/hall-booking.js";
import { eventPermissionManifestBlocks } from "./manifests/event-permission.js";
import { pgrManifestBlocks } from "./manifests/pgr.js";
import { waterConnectionManifestBlocks } from "./manifests/water-connection.js";
import { fireNocManifestBlocks } from "./manifests/fire-noc.js";
import { propertyTaxManifestBlocks } from "./manifests/property-tax.js";
import { birthDeathManifestBlocks } from "./manifests/birth-death.js";
import { shopsEstablishmentsManifestBlocks } from "./manifests/shops-establishments.js";
import { streetVendorManifestBlocks } from "./manifests/street-vendor.js";
import { advertisementManifestBlocks } from "./manifests/advertisement-hoarding.js";
import { roadCuttingManifestBlocks } from "./manifests/road-cutting.js";
import { crematoriumManifestBlocks } from "./manifests/crematorium-booking.js";
import { parkingPassManifestBlocks } from "./manifests/parking-pass.js";
import { marketStallManifestBlocks } from "./manifests/market-stall.js";
import { municipalPropertyRentManifestBlocks } from "./manifests/municipal-property-rent.js";
import { generalNocManifestBlocks } from "./manifests/general-noc.js";
import { sewerConnectionManifestBlocks } from "./manifests/sewer-connection.js";
import { desludgingManifestBlocks } from "./manifests/desludging-booking.js";
import { citizenAppointmentManifestBlocks } from "./manifests/citizen-appointment.js";

// Every optional block is written from a nullable DB column via `?? undefined`
// (see manifest-export.ts). Under exactOptionalPropertyTypes a bare `?: T`
// rejects an explicit `undefined`, so these carry `| undefined` — matching the
// convention already used by the catalogue domain types (e.g. RequiredDocument).
export interface PackManifestBlocks {
  description?: string | undefined;
  slaDays?: number | undefined;
  formId?: string | undefined;
  forms?: unknown[] | undefined;
  eligibilityRuleSetId?: string | undefined;
  workflowDefinitionId?: string | undefined;
  feeScheduleId?: string | undefined;
  feeModel?: "flat" | "slab" | "engine" | undefined;
  hoaCode?: string | undefined;
  issuanceType?: string | undefined;
  outputs?: unknown[] | undefined;
  // Reuse the catalogue domain type rather than redeclaring a structurally
  // incompatible inline shape (domain has `label?`/`verifiedAtLane?` as
  // `| undefined`, which exactOptionalPropertyTypes rejects against `label: string`).
  requiredDocuments?: RequiredDocument[] | undefined;
  /** FN-25 — per-lane SLA + escalation designations. */
  laneBindings?: LaneBinding[] | undefined;
  channels?: string[] | undefined;
  feeFromMinor?: number | undefined;
  feeCurrency?: string | undefined;
}

export function blocksFromManifest(
  packKey: string,
  manifest: Record<string, unknown> | null | undefined,
): PackManifestBlocks | null {
  const raw = manifest?.blocks;
  if (raw && typeof raw === "object") return raw as PackManifestBlocks;
  // municipal-in-v1 reference pack (BRD §8.1) — all six services.
  if (packKey === "pack:trade-license") return tradeLicenseManifestBlocks();
  if (packKey === "pack:pgr") return pgrManifestBlocks();
  if (packKey === "pack:water-connection") return waterConnectionManifestBlocks();
  if (packKey === "pack:fire-noc") return fireNocManifestBlocks();
  if (packKey === "pack:property-tax") return propertyTaxManifestBlocks();
  if (packKey === "pack:birth-death") return birthDeathManifestBlocks();
  // Non-municipal packs (Phase 3 / DoD (g)) — same 8-block wiring, other sectors.
  if (packKey === "pack:hall-booking") return hallBookingManifestBlocks();
  if (packKey === "pack:event-permission") return eventPermissionManifestBlocks();
  // Wider citizen-facing catalogue — the services a ULB issues in volume.
  if (packKey === "pack:shops-establishments") return shopsEstablishmentsManifestBlocks();
  if (packKey === "pack:street-vendor") return streetVendorManifestBlocks();
  if (packKey === "pack:advertisement-hoarding") return advertisementManifestBlocks();
  if (packKey === "pack:road-cutting") return roadCuttingManifestBlocks();
  if (packKey === "pack:crematorium-booking") return crematoriumManifestBlocks();
  if (packKey === "pack:parking-pass") return parkingPassManifestBlocks();
  if (packKey === "pack:market-stall") return marketStallManifestBlocks();
  if (packKey === "pack:municipal-property-rent") return municipalPropertyRentManifestBlocks();
  if (packKey === "pack:general-noc") return generalNocManifestBlocks();
  // P0 gap closure — sewerage, desludging, appointments.
  if (packKey === "pack:sewer-connection") return sewerConnectionManifestBlocks();
  if (packKey === "pack:desludging-booking") return desludgingManifestBlocks();
  if (packKey === "pack:citizen-appointment") return citizenAppointmentManifestBlocks();
  return null;
}

/** Merge manifest block wiring into a new catalogue draft row. */
export function applyManifestToDefinition(
  base: ServiceDefinitionInsert,
  packKey: string,
  manifest: Record<string, unknown> | null | undefined,
): ServiceDefinitionInsert {
  const blocks = blocksFromManifest(packKey, manifest);
  if (!blocks) return base;

  const formsWithMeta = (blocks.forms ?? base.forms)?.map((f, i) =>
    i === 0 && typeof f === "object" && f !== null
      ? {
          ...f,
          runtimeMeta: {
            description: blocks.description,
            feeFromMinor: blocks.feeFromMinor,
            feeCurrency: blocks.feeCurrency,
          },
        }
      : f,
  );

  const merged: ServiceDefinitionInsert = {
    ...base,
    forms: (formsWithMeta ?? base.forms) as never,
    outputs: (blocks.outputs ?? base.outputs) as never,
    requiredDocuments: blocks.requiredDocuments ?? base.requiredDocuments ?? [],
    laneBindings: blocks.laneBindings ?? base.laneBindings ?? [],
    channels: (blocks.channels ?? base.channels) as never,
  };

  if (blocks.slaDays != null) merged.slaDays = blocks.slaDays;
  if (blocks.formId != null) merged.formId = blocks.formId;
  if (blocks.eligibilityRuleSetId != null) merged.eligibilityRuleSetId = blocks.eligibilityRuleSetId;
  if (blocks.workflowDefinitionId != null) merged.workflowDefinitionId = blocks.workflowDefinitionId;
  if (blocks.feeScheduleId != null) merged.feeScheduleId = blocks.feeScheduleId;
  if (blocks.feeModel != null) merged.feeModel = blocks.feeModel;
  if (blocks.hoaCode != null) merged.hoaCode = blocks.hoaCode;
  if (blocks.issuanceType != null) merged.issuanceType = blocks.issuanceType;

  return merged;
}
