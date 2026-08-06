/**
 * Command publishing helpers for the programmes module (G12).
 *
 * Routes call these and return 202. Nothing here touches Postgres — the consumer owns
 * every write. `commandId` derives the messageId from the caller's `x-idempotency-key`
 * (scoped by tenant + topic + entity), so a retried POST collapses onto one message and
 * the consumer's inbox dedupe drops the duplicate.
 *
 * Each helper invalidates the read cache after publishing. That is belt-and-braces: the
 * consumer invalidates again once the write commits, but doing it here too stops a reader
 * that polls immediately after a 202 from being served a value it can already see is old.
 */
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";
import { invalidateProgramme } from "./queries.js";
import type { CoverageScope } from "./schema.js";
import type { MetricKind, ProgrammeStatus } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * `scope` defaults to the target entity id but can be overridden. It matters for the
 * metric write: its row id is freshly generated per request, so scoping the messageId on
 * it would make a client retry look like a brand-new command. Scoping on
 * programme+period+metric instead means a retry derives the SAME messageId and is dropped
 * by the inbox, which is what `x-idempotency-key` promises.
 */
async function publish(
  ctx: RequestContext,
  type: string,
  id: string,
  payload: Record<string, unknown>,
  scope?: string,
): Promise<Accepted> {
  await queue.publish(type, {
    messageId: commandId(ctx, `${type}:${scope ?? id}`),
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export interface CreateProgrammeCommand {
  programmeCode: string;
  name: string;
  description: string | null;
  accountId: string;
  contractId: string | null;
  productLine: string;
  startDate: string | null;
  endDate: string | null;
  sponsoringDepartment: string | null;
  coverageScope: CoverageScope;
  status: ProgrammeStatus;
}

export async function createProgramme(
  ctx: RequestContext,
  id: string,
  cmd: CreateProgrammeCommand,
): Promise<Accepted> {
  const accepted = await publish(ctx, COMMANDS.createProgramme, id, { ...cmd });
  await invalidateProgramme(ctx.tenantId, id);
  return accepted;
}

export interface UpdateProgrammeCommand {
  /** Only the fields the caller actually sent — an absent key means "leave it alone". */
  changed: {
    name?: string | undefined;
    description?: string | null | undefined;
    contractId?: string | null | undefined;
    productLine?: string | undefined;
    startDate?: string | null | undefined;
    endDate?: string | null | undefined;
    sponsoringDepartment?: string | null | undefined;
    coverageScope?: CoverageScope | undefined;
  };
  version: number;
}

export async function updateProgramme(
  ctx: RequestContext,
  id: string,
  cmd: UpdateProgrammeCommand,
): Promise<Accepted> {
  const accepted = await publish(ctx, COMMANDS.updateProgramme, id, { ...cmd });
  await invalidateProgramme(ctx.tenantId, id);
  return accepted;
}

export interface ChangeStatusCommand {
  fromStatus: ProgrammeStatus;
  toStatus: ProgrammeStatus;
  reason: string | null;
  version: number;
}

export async function changeProgrammeStatus(
  ctx: RequestContext,
  id: string,
  cmd: ChangeStatusCommand,
): Promise<Accepted> {
  const accepted = await publish(ctx, COMMANDS.changeProgrammeStatus, id, { ...cmd });
  await invalidateProgramme(ctx.tenantId, id);
  return accepted;
}

export interface RecordMetricCommand {
  programmeId: string;
  periodStart: string;
  periodEnd: string;
  metricKey: string;
  metricKind: MetricKind;
  /** Minor units as a STRING (monetary metrics), else null. */
  valueMinor: string | null;
  currency: string | null;
  /** Decimal STRING (counts / ratios), else null. */
  valueNumeric: string | null;
}

export async function recordProgrammeMetric(
  ctx: RequestContext,
  metricId: string,
  cmd: RecordMetricCommand,
): Promise<Accepted> {
  const accepted = await publish(
    ctx,
    COMMANDS.recordProgrammeMetric,
    metricId,
    { ...cmd },
    `${cmd.programmeId}:${cmd.periodStart}:${cmd.metricKey}`,
  );
  await invalidateProgramme(ctx.tenantId, cmd.programmeId);
  return accepted;
}

export interface LinkDealCommand {
  dealId: string;
  dealVersion: number;
}

export async function linkDealToProgramme(
  ctx: RequestContext,
  programmeId: string,
  cmd: LinkDealCommand,
): Promise<Accepted> {
  const accepted = await publish(ctx, COMMANDS.linkDealToProgramme, programmeId, { ...cmd });
  await invalidateProgramme(ctx.tenantId, programmeId);
  return accepted;
}
