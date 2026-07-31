/**
 * agents/domain.ts — agent lifecycle, definition validation, handoff selection.
 * Pure functions only.
 */

export type AgentStatus = "active" | "paused" | "archived";

export const AGENT_STATUSES: readonly AgentStatus[] = ["active", "paused", "archived"];

/** active ⇄ paused, both → archived. `archived` is terminal. */
const TRANSITIONS: Record<AgentStatus, readonly AgentStatus[]> = {
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: [],
};

/** Returns null when the transition is legal, else an error message. */
export function validateAgentStatusTransition(from: string, to: string): string | null {
  if (!AGENT_STATUSES.includes(from as AgentStatus)) return `unknown agent status: ${from}`;
  if (!AGENT_STATUSES.includes(to as AgentStatus)) return `unknown agent status: ${to}`;
  const allowed = TRANSITIONS[from as AgentStatus];
  if (!allowed.includes(to as AgentStatus)) return `cannot transition agent from ${from} to ${to}`;
  return null;
}

export interface AgentDefinitionInput {
  name?: unknown;
  skills?: unknown;
  tools?: unknown;
}

/** Returns null when the definition is well-formed, else an error message. */
export function validateAgentDefinition(def: AgentDefinitionInput): string | null {
  if (typeof def.name !== "string" || def.name.trim().length === 0) {
    return "name is required";
  }
  if (def.name.length > 200) {
    return "name must be at most 200 characters";
  }
  for (const key of ["skills", "tools"] as const) {
    const value = def[key];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) return `${key} must be an array`;
    for (const [i, entry] of value.entries()) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return `${key}[${i}] must be an object with a name`;
      }
      const name = (entry as Record<string, unknown>).name;
      if (typeof name !== "string" || name.trim().length === 0) {
        return `${key}[${i}] requires a non-empty name`;
      }
    }
  }
  return null;
}

/** Only active agents accept invocations. */
export function canInvoke(status: string): boolean {
  return status === "active";
}

export interface HandoffCandidate {
  id: string;
  name: string;
  status: string;
  skills: Array<Record<string, unknown>> | null;
}

/**
 * Pick the agent best suited to a required skill: active agents only, matched
 * case-insensitively on skill name. The most specialised candidate (fewest
 * skills) wins; ties break on name for determinism. Returns null when nobody
 * has the skill.
 */
export function selectHandoffTarget<T extends HandoffCandidate>(requiredSkill: string, agents: T[]): T | null {
  const needle = requiredSkill.trim().toLowerCase();
  if (needle.length === 0) return null;

  const eligible = agents.filter((a) => {
    if (!canInvoke(a.status)) return false;
    const skills = a.skills ?? [];
    return skills.some((s) => {
      const name = s?.name;
      return typeof name === "string" && name.trim().toLowerCase() === needle;
    });
  });

  if (eligible.length === 0) return null;

  const sorted = [...eligible].sort((a, b) => {
    const diff = (a.skills?.length ?? 0) - (b.skills?.length ?? 0);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });

  return sorted[0] ?? null;
}
