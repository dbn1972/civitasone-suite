/**
 * platform-integrations — command payload contracts (zod).
 *
 * The routes validate the HTTP body, run synchronous pre-accept checks, then
 * publish one of these commands; the consumer re-parses the payload here (the
 * queue is a trust boundary too) and does the DB write + audit in ONE
 * transaction. Routes never write the database.
 *
 * Secrets: `sealedPatch` values MUST already be "enc:v2:" envelopes. The
 * consumer's schema rejects anything else, so a plaintext secret can neither
 * travel through the queue/outbox/DLQ nor be stored.
 */
import { z } from "zod";
import { INTEGRATION_CATEGORIES, PROVIDER_STATUSES } from "./schema.js";

export const EDITIONS = ["govt_dept", "psu", "small_office"] as const;

const key = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
const httpsUrlOrNull = z.string().url().max(2048).refine((u) => u.startsWith("https://"), "must be https").nullable();

export const providerPatchSchema = z.object({
  status: z.enum(PROVIDER_STATUSES).optional(),
  availability: z.object({
    mode: z.enum(["all", "restricted"]),
    tenantIds: z.array(z.string().uuid()).max(500).default([]),
    editions: z.array(z.enum(EDITIONS)).default([]),
  }).optional(),
  endpoints: z.object({ sandbox: httpsUrlOrNull, production: httpsUrlOrNull }).optional(),
}).refine((p) => p.status !== undefined || p.availability !== undefined || p.endpoints !== undefined, "at least one of status, availability, endpoints is required");

export const providerUpdateCommand = z.object({
  key,
  expectedVersion: z.number().int().min(1),
  patch: providerPatchSchema,
});

export const recordSaveCommand = z.object({
  /** Roles of the caller, stamped by the route from the verified JWT; the consumer re-checks category access. */
  actorRoles: z.array(z.string()).default([]),
  providerKey: key,
  category: z.enum(INTEGRATION_CATEGORIES),
  newId: z.string().uuid(),
  /** null => create. */
  expectedVersion: z.number().int().min(1).nullable(),
  enabled: z.boolean(),
  config: z.record(z.unknown()),
  sealedPatch: z.record(z.string().startsWith("enc:v2:")),
  clearSecrets: z.array(z.string()).default([]),
});

export const recordDeleteCommand = z.object({
  /** Roles of the caller, stamped by the route from the verified JWT; the consumer re-checks category access. */
  actorRoles: z.array(z.string()).default([]),
  providerKey: key,
  expectedVersion: z.number().int().min(1),
});

export const recordTestCommand = z.object({
  /** Roles of the caller, stamped by the route from the verified JWT; the consumer re-checks category access. */
  actorRoles: z.array(z.string()).default([]),
  providerKey: key,
  environment: z.enum(["sandbox", "production"]),
  status: z.enum(["success", "failure"]),
  code: z.string().max(40),
  message: z.string().max(1000),
});

export const switchRequestCommand = z.object({
  /** Roles of the caller, stamped by the route from the verified JWT; the consumer re-checks category access. */
  actorRoles: z.array(z.string()).default([]),
  requestId: z.string().uuid(),
  providerKey: key,
  reason: z.string().trim().min(5).max(1000),
  baseVersion: z.number().int().min(1),
});

export const switchDecideCommand = z.object({
  /** Roles of the caller, stamped by the route from the verified JWT; the consumer re-checks category access. */
  actorRoles: z.array(z.string()).default([]),
  requestId: z.string().uuid(),
  decision: z.enum(["approve", "reject", "cancel"]),
  note: z.string().trim().max(1000).nullable().default(null),
});

export const revertSandboxCommand = z.object({
  /** Roles of the caller, stamped by the route from the verified JWT; the consumer re-checks category access. */
  actorRoles: z.array(z.string()).default([]),
  providerKey: key,
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().min(5).max(1000),
});

export const settingsUpdateCommand = z.object({
  actorRoles: z.array(z.string()).default([]),
  requireProductionApproval: z.boolean(),
  /** null => first write for the tenant. */
  expectedVersion: z.number().int().min(1).nullable(),
});

export const policyRequestCommand = z.object({
  actorRoles: z.array(z.string()).default([]),
  requestId: z.string().uuid(),
  reason: z.string().trim().min(5).max(1000),
});

export const policyDecideCommand = z.object({
  actorRoles: z.array(z.string()).default([]),
  requestId: z.string().uuid(),
  decision: z.enum(["approve", "reject", "cancel"]),
  note: z.string().trim().max(1000).nullable().default(null),
});

export type PolicyRequestCommand = z.infer<typeof policyRequestCommand>;
export type PolicyDecideCommand = z.infer<typeof policyDecideCommand>;
export type ProviderUpdateCommand = z.infer<typeof providerUpdateCommand>;
export type RecordSaveCommand = z.infer<typeof recordSaveCommand>;
export type RecordDeleteCommand = z.infer<typeof recordDeleteCommand>;
export type RecordTestCommand = z.infer<typeof recordTestCommand>;
export type SwitchRequestCommand = z.infer<typeof switchRequestCommand>;
export type SwitchDecideCommand = z.infer<typeof switchDecideCommand>;
export type RevertSandboxCommand = z.infer<typeof revertSandboxCommand>;
export type SettingsUpdateCommand = z.infer<typeof settingsUpdateCommand>;
