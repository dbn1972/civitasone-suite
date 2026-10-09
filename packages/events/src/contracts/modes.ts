/**
 * FF-02 WP1 — Contract mode resolver (design C3, section 4.2).
 *
 * Resolves the EFFECTIVE mode for a (contract, tenant) pair from the contract's
 * own default mode and the environment. The rules (D-18):
 *
 *   mode(topic, tenant):
 *     - "off"  when EVENT_CONTRACT_MODE is "off" or unset  (kill switch is the
 *       DEFAULT, so a brand-new contract never enforces by accident).
 *     - "warn" ceiling when EVENT_CONTRACT_MODE is "warn".
 *     - otherwise ("per_contract"): the contract's own mode, except an
 *       "enforce" contract is capped to "warn" unless the tenant is listed in
 *       EVENT_CONTRACT_ENFORCE_TENANTS (a comma list, or "*").
 *
 * Relay-time validation runs with NO tenant and must never be "enforce": a
 * pre-deploy outbox row could otherwise become a permanently stuck poison row
 * (section 4.2). So a missing tenant caps an enforce contract at "warn".
 *
 * Environment variables are read on every message on a hot path, so this is a
 * pure function of its inputs — no feature-flag fetch, no I/O (section 4.1).
 */

export type ContractMode = "off" | "warn" | "enforce";

/** The subset of process.env this resolver reads (passed in, never read here). */
export interface ContractModeEnv {
  /** Global switch: "off" (default/kill switch) | "warn" | "per_contract". */
  EVENT_CONTRACT_MODE: string | undefined;
  /** Comma list of tenant ids, or "*". Empty = enforce for nobody. */
  EVENT_CONTRACT_ENFORCE_TENANTS: string | undefined;
}

const RANK: Record<ContractMode, number> = { off: 0, warn: 1, enforce: 2 };

/** Return the lower (less strict) of two modes. */
function floor(a: ContractMode, b: ContractMode): ContractMode {
  return RANK[a] <= RANK[b] ? a : b;
}

function tenantEnforced(tenantId: string | undefined, list: string | undefined): boolean {
  if (!tenantId) return false; // relay-time (no tenant) never enforces
  if (!list) return false;
  const entries = list.split(",").map((s) => s.trim()).filter(Boolean);
  return entries.includes("*") || entries.includes(tenantId);
}

/**
 * Resolve the effective mode.
 *
 * @param contractMode the contract's own default mode ("off" | "warn" | "enforce")
 * @param tenantId     the message's tenant, or undefined at relay time
 * @param env          the relevant environment variables
 */
export function resolveMode(
  contractMode: ContractMode,
  tenantId: string | undefined,
  env: ContractModeEnv,
): ContractMode {
  const global = (env.EVENT_CONTRACT_MODE ?? "off").trim();

  // Kill switch / default: nothing enforces or warns.
  if (global === "off" || global === "") return "off";

  // Global warn ceiling.
  if (global === "warn") return floor(contractMode, "warn");

  // per_contract (any other value is treated conservatively as per_contract):
  // start from the contract's own mode.
  if (contractMode !== "enforce") return contractMode;

  // An enforce contract only enforces for a listed tenant; otherwise warn.
  return tenantEnforced(tenantId, env.EVENT_CONTRACT_ENFORCE_TENANTS) ? "enforce" : "warn";
}

/** Read the resolver's environment from a process.env-like record. */
export function modeEnvFromProcess(
  source: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): ContractModeEnv {
  return {
    EVENT_CONTRACT_MODE: source.EVENT_CONTRACT_MODE,
    EVENT_CONTRACT_ENFORCE_TENANTS: source.EVENT_CONTRACT_ENFORCE_TENANTS,
  };
}
