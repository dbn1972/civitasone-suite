/**
 * Assessment module — command publishing helpers.
 *
 * _Requirements: SVC-131, Requirement 6_
 */
import { publishCommand } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { RequestContext } from "../../shared/context.js";

export function createAssessment(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.assessmentCreate, ctx, payload);
}

export function reviseAssessment(ctx: RequestContext, assessmentId: string, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.assessmentRevise, ctx, { ...payload, assessmentId });
}

export function remitAssessment(ctx: RequestContext, assessmentId: string, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.assessmentRemit, ctx, { ...payload, assessmentId });
}

export function remitDecide(ctx: RequestContext, assessmentId: string, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.assessmentRemitDecide, ctx, { ...payload, assessmentId });
}
