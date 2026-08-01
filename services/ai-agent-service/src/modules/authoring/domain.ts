/**
 * authoring/domain.ts — AG-003 no-code agent authoring rules. Pure functions only.
 *
 * The same validation powers the dry-run endpoint and the publish gate, so an
 * author can never be told "looks fine" by /validate and then be rejected by
 * /publish: both call validateDefinition.
 */

export type AuthoringStatus = "draft" | "published" | "archived";

export const AUTHORING_STATUSES: readonly AuthoringStatus[] = ["draft", "published", "archived"];

/** A published definition can be archived but never demoted back to draft:
 *  callers may already be bound to it, so it is superseded, not rewritten. */
const TRANSITIONS: Record<AuthoringStatus, readonly AuthoringStatus[]> = {
  draft: ["published", "archived"],
  published: ["archived"],
  archived: [],
};

export function validateAuthoringTransition(from: string, to: string): string | null {
  if (!AUTHORING_STATUSES.includes(from as AuthoringStatus)) return `unknown status: ${from}`;
  if (!AUTHORING_STATUSES.includes(to as AuthoringStatus)) return `unknown status: ${to}`;
  const allowed = TRANSITIONS[from as AuthoringStatus];
  if (!allowed.includes(to as AuthoringStatus)) return `cannot transition definition from ${from} to ${to}`;
  return null;
}

export const MAX_SYSTEM_PROMPT_LENGTH = 16000;
export const MAX_TOOLS = 50;

export type IssueSeverity = "error" | "warning";

export interface DefinitionIssue {
  field: string;
  code: string;
  message: string;
  severity: IssueSeverity;
}

export interface AuthoringDefinitionInput {
  name?: unknown;
  description?: unknown;
  systemPrompt?: unknown;
  tools?: unknown;
  modelConfig?: unknown;
}

export interface ValidationReport {
  valid: boolean;
  publishable: boolean;
  issues: DefinitionIssue[];
}

function err(field: string, code: string, message: string): DefinitionIssue {
  return { field, code, message, severity: "error" };
}

function warn(field: string, code: string, message: string): DefinitionIssue {
  return { field, code, message, severity: "warning" };
}

/**
 * Structured validation of an authored definition.
 *
 * `valid` means the definition can be saved as a draft; `publishable` means it
 * additionally satisfies the publish gate (non-empty system prompt and at least
 * one tool). Warnings never block anything — they are authoring hints.
 */
export function validateDefinition(def: AuthoringDefinitionInput): ValidationReport {
  const issues: DefinitionIssue[] = [];

  if (typeof def.name !== "string" || def.name.trim().length === 0) {
    issues.push(err("name", "NAME_REQUIRED", "name is required"));
  } else if (def.name.length > 200) {
    issues.push(err("name", "NAME_TOO_LONG", "name must be at most 200 characters"));
  }

  const prompt = def.systemPrompt;
  if (prompt !== undefined && prompt !== null && typeof prompt !== "string") {
    issues.push(err("systemPrompt", "SYSTEM_PROMPT_TYPE", "systemPrompt must be a string"));
  } else if (typeof prompt === "string" && prompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
    issues.push(
      err("systemPrompt", "SYSTEM_PROMPT_TOO_LONG", `systemPrompt must be at most ${MAX_SYSTEM_PROMPT_LENGTH} characters`),
    );
  }

  const tools = def.tools;
  if (tools !== undefined && tools !== null) {
    if (!Array.isArray(tools)) {
      issues.push(err("tools", "TOOLS_TYPE", "tools must be an array"));
    } else {
      if (tools.length > MAX_TOOLS) {
        issues.push(err("tools", "TOOLS_TOO_MANY", `tools must contain at most ${MAX_TOOLS} entries`));
      }
      const seen = new Set<string>();
      for (const [i, entry] of tools.entries()) {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          issues.push(err(`tools[${i}]`, "TOOL_SHAPE", `tools[${i}] must be an object with a name`));
          continue;
        }
        const name = (entry as Record<string, unknown>).name;
        if (typeof name !== "string" || name.trim().length === 0) {
          issues.push(err(`tools[${i}]`, "TOOL_NAME_REQUIRED", `tools[${i}] requires a non-empty name`));
          continue;
        }
        const key = name.trim().toLowerCase();
        if (seen.has(key)) {
          issues.push(err(`tools[${i}]`, "TOOL_DUPLICATE", `duplicate tool name: ${name}`));
        }
        seen.add(key);
      }
    }
  }

  const modelConfig = def.modelConfig;
  if (modelConfig !== undefined && modelConfig !== null) {
    if (typeof modelConfig !== "object" || Array.isArray(modelConfig)) {
      issues.push(err("modelConfig", "MODEL_CONFIG_TYPE", "modelConfig must be an object"));
    } else {
      const temperature = (modelConfig as Record<string, unknown>).temperature;
      if (temperature !== undefined) {
        if (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
          issues.push(err("modelConfig.temperature", "TEMPERATURE_RANGE", "temperature must be between 0 and 2"));
        }
      }
      if ((modelConfig as Record<string, unknown>).model === undefined) {
        issues.push(warn("modelConfig.model", "MODEL_UNSET", "no model pinned; the tenant default will be used"));
      }
    }
  } else {
    issues.push(warn("modelConfig", "MODEL_CONFIG_EMPTY", "no model configuration supplied"));
  }

  // Publish gate — deliberately separate from `valid` so a half-finished draft
  // can still be saved and iterated on.
  const publishIssues: DefinitionIssue[] = [];
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    publishIssues.push(err("systemPrompt", "SYSTEM_PROMPT_REQUIRED", "a non-empty systemPrompt is required to publish"));
  }
  if (!Array.isArray(tools) || tools.length === 0) {
    publishIssues.push(err("tools", "TOOLS_REQUIRED", "at least one tool is required to publish"));
  }

  const valid = issues.every((i) => i.severity !== "error");
  const publishable = valid && publishIssues.length === 0;

  return { valid, publishable, issues: [...issues, ...publishIssues] };
}

/** Publish gate used by POST /publish. Returns the blocking issues (empty ⇒ publishable). */
export function publishBlockers(def: AuthoringDefinitionInput): DefinitionIssue[] {
  const report = validateDefinition(def);
  if (report.publishable) return [];
  return report.issues.filter((i) => i.severity === "error");
}
