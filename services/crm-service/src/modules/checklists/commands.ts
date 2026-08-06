/**
 * G7 checklists — CQRS write path. Every command is keyed on the entity id so the six
 * topics never collide in `_inbox.processed` (`publishCrmCommand` derives the messageId
 * from `${type}:${id}`, folding in the tenant and any client idempotency key).
 *
 * Each helper invalidates the read model after publishing, matching the pattern in
 * modules/onboarding: the consumer invalidates again once the write actually lands, but
 * dropping the stale entry here stops the very next read from serving a value the caller
 * has already been told is changing.
 */
import type { RequestContext } from "@civitasone/types";
import type { ChecklistResponses, ChecklistSection } from "@civitasone/checklist";
import { COMMANDS } from "../../topics.js";
import { publishCrmCommand, type Accepted } from "../../shared/residual-publish.js";
import { invalidateInstance, invalidateTemplate } from "./queries.js";
import type { ChecklistSubjectType } from "./schema.js";

export type { Accepted };

export interface CreateTemplateCommand {
  templateKey: string;
  name: string;
  description: string | null;
  sections: ChecklistSection[];
  versionNumber: number;
}

export interface UpdateTemplateCommand {
  name: string | null;
  description: string | null;
  sections: ChecklistSection[] | null;
  version: number;
}

export interface PublishTemplateCommand {
  templateKey: string;
  versionNumber: number;
  version: number;
}

export interface CreateInstanceCommand {
  subjectType: ChecklistSubjectType;
  subjectId: string;
  templateId: string;
  templateKey: string;
  templateVersionNumber: number;
  structure: ChecklistSection[];
}

export interface SubmitResponsesCommand {
  responses: ChecklistResponses;
  version: number;
}

export async function createTemplate(
  ctx: RequestContext,
  id: string,
  cmd: CreateTemplateCommand,
): Promise<Accepted> {
  const accepted = await publishCrmCommand(ctx, COMMANDS.createChecklistTemplate, id, { ...cmd });
  await invalidateTemplate(ctx.tenantId, id);
  return accepted;
}

export async function updateTemplate(
  ctx: RequestContext,
  id: string,
  cmd: UpdateTemplateCommand,
): Promise<Accepted> {
  const accepted = await publishCrmCommand(ctx, COMMANDS.updateChecklistTemplate, id, { ...cmd });
  await invalidateTemplate(ctx.tenantId, id);
  return accepted;
}

export async function publishTemplate(
  ctx: RequestContext,
  id: string,
  cmd: PublishTemplateCommand,
): Promise<Accepted> {
  const accepted = await publishCrmCommand(ctx, COMMANDS.publishChecklistTemplate, id, { ...cmd });
  await invalidateTemplate(ctx.tenantId, id);
  return accepted;
}

export async function deprecateTemplate(
  ctx: RequestContext,
  id: string,
  cmd: { version: number },
): Promise<Accepted> {
  const accepted = await publishCrmCommand(ctx, COMMANDS.deprecateChecklistTemplate, id, { ...cmd });
  await invalidateTemplate(ctx.tenantId, id);
  return accepted;
}

export async function createInstance(
  ctx: RequestContext,
  id: string,
  cmd: CreateInstanceCommand,
): Promise<Accepted> {
  const accepted = await publishCrmCommand(ctx, COMMANDS.createChecklistInstance, id, { ...cmd });
  await invalidateInstance(ctx.tenantId, id);
  return accepted;
}

export async function submitResponses(
  ctx: RequestContext,
  id: string,
  cmd: SubmitResponsesCommand,
): Promise<Accepted> {
  const accepted = await publishCrmCommand(ctx, COMMANDS.submitChecklistResponses, id, { ...cmd });
  await invalidateInstance(ctx.tenantId, id);
  return accepted;
}
