/**
 * CH-04 — POST /v1/crm/communications/template-preview
 *
 * Fetches a template from notification-service, resolves placeholders with
 * real contact data + caller-supplied variables, and returns the resolved body
 * along with any unresolved variable names.
 */
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { templatePreviewBody } from "./template-preview-validators.js";

const PREVIEW_ROLES = ["crm_user", "crm_admin", "super_admin"];

const NOTIFICATION_BASE = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:3006";
const HTTP_TIMEOUT_MS = Number(process.env.CROSS_SERVICE_TIMEOUT_MS ?? 10_000);

/** Variable pattern: {{variableName}} or {variableName} (supports both) */
const VARIABLE_PATTERN = /\{\{(\w+)\}\}|\{(\w+)\}/g;

interface ContactFields {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  city: string | null;
  designation: string | null;
}

async function fetchContact(tenantId: string, contactId: string): Promise<ContactFields | null> {
  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT
      COALESCE(name, '') AS "name",
      email,
      phone,
      company,
      city,
      designation
    FROM crm.contacts
    WHERE tenant_id = ${tenantId} AND id = ${contactId} AND status = 'active'
    LIMIT 1
  `)) as unknown as ContactFields[];
  return rows[0] ?? null;
}

interface TemplateResponse {
  id: string;
  body: string;
  variables?: string[];
}

async function fetchTemplate(templateId: string): Promise<TemplateResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${NOTIFICATION_BASE}/notifications/templates/${templateId}`, {
      signal: controller.signal,
      headers: { "content-type": "application/json" },
    });
    if (!res.ok) {
      if (res.status === 404) throw new HttpError(404, "TEMPLATE_NOT_FOUND", "template not found");
      if (res.status >= 500) throw new HttpError(503, "TEMPLATE_SERVICE_UNAVAILABLE", "notification-service is temporarily unavailable");
      throw new HttpError(502, "UPSTREAM_ERROR", `notification-service returned ${res.status}`);
    }
    const json = await res.json() as { data?: TemplateResponse };
    return json.data ?? (json as unknown as TemplateResponse);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // Network failure — service unavailable
    throw new HttpError(503, "TEMPLATE_SERVICE_UNAVAILABLE", "notification-service is temporarily unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extract mandatory variable names from a template body.
 * Supports both {{variableName}} and {variableName} syntax.
 */
export function extractVariables(body: string): string[] {
  const vars = new Set<string>();
  let match: RegExpExecArray | null;
  VARIABLE_PATTERN.lastIndex = 0;
  while ((match = VARIABLE_PATTERN.exec(body)) !== null) {
    // match[1] is from {{var}}, match[2] is from {var}
    const varName = match[1] ?? match[2];
    if (varName) vars.add(varName);
  }
  return [...vars];
}

/**
 * Resolve placeholders in body using contact fields + supplied variables.
 * Supports both {{var}} and {var} syntax.
 */
export function resolvePlaceholders(
  body: string,
  contactFields: Record<string, string | null>,
  suppliedVars: Record<string, string>,
): { resolvedBody: string; missingVariables: string[]; sampleValues: Record<string, string> } {
  const missing: string[] = [];
  const merged: Record<string, string | null> = { ...contactFields, ...suppliedVars };
  const sampleValues: Record<string, string> = {};

  const resolvedBody = body.replace(VARIABLE_PATTERN, (fullMatch, doubleBraceVar?: string, singleBraceVar?: string) => {
    const varName = doubleBraceVar ?? singleBraceVar ?? "";
    const value = merged[varName];
    if (value !== undefined && value !== null && value !== "") {
      sampleValues[varName] = value;
      return value;
    }
    missing.push(varName);
    return fullMatch;
  });

  return { resolvedBody, missingVariables: [...new Set(missing)], sampleValues };
}

export async function templatePreviewRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/communications/template-preview", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PREVIEW_ROLES);
    const body = templatePreviewBody.parse(req.body);

    // Fetch template from notification-service
    const template = await fetchTemplate(body.templateId);

    // Fetch contact fields
    const contact = await fetchContact(ctx.tenantId, body.contactId);
    if (!contact) {
      throw new HttpError(404, "CONTACT_NOT_FOUND", "contact not found or inactive");
    }

    // Build contact fields map
    const contactFields: Record<string, string | null> = {
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      company: contact.company,
      city: contact.city,
      designation: contact.designation,
    };

    const { resolvedBody, missingVariables, sampleValues } = resolvePlaceholders(
      template.body,
      contactFields,
      body.variables ?? {},
    );

    return reply.code(200).send({
      data: {
        resolved: resolvedBody,
        resolvedBody,
        missingVariables,
        contact: contactFields,
        sampleValues,
      },
    });
  });
}
