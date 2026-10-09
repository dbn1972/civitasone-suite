/**
 * FF-02 WP1 — Mode resolver tests (section 4.2).
 *
 * mode(topic, tenant) =
 *   - "off"  if EVENT_CONTRACT_MODE=off  (the global kill switch, D-18)
 *   - else the LOWER of the contract's own mode and, when the contract is
 *     "enforce" but the tenant is not listed in EVENT_CONTRACT_ENFORCE_TENANTS,
 *     "warn".
 *   - EVENT_CONTRACT_MODE=warn caps every contract at "warn".
 *
 * The default of EVENT_CONTRACT_MODE is "off" — the kill switch is the default
 * (D-18) — so a brand-new contract never enforces by accident.
 */
import { describe, it, expect } from "vitest";
import { resolveMode, type ContractModeEnv } from "../../src/contracts/modes.js";

const env = (over: Partial<ContractModeEnv> = {}): ContractModeEnv => ({
  EVENT_CONTRACT_MODE: undefined,
  EVENT_CONTRACT_ENFORCE_TENANTS: undefined,
  ...over,
});

describe("resolveMode — global kill switch", () => {
  it("defaults to off when EVENT_CONTRACT_MODE is unset (kill switch is the default)", () => {
    expect(resolveMode("enforce", "t-1", env())).toBe("off");
  });

  it("off overrides everything, including an enforce contract on a listed tenant", () => {
    expect(
      resolveMode("enforce", "t-1", env({ EVENT_CONTRACT_MODE: "off", EVENT_CONTRACT_ENFORCE_TENANTS: "*" })),
    ).toBe("off");
  });

  it("warn caps an enforce contract at warn for every tenant", () => {
    expect(
      resolveMode("enforce", "t-1", env({ EVENT_CONTRACT_MODE: "warn", EVENT_CONTRACT_ENFORCE_TENANTS: "*" })),
    ).toBe("warn");
  });
});

describe("resolveMode — per_contract", () => {
  const base = env({ EVENT_CONTRACT_MODE: "per_contract" });

  it("an off contract stays off", () => {
    expect(resolveMode("off", "t-1", base)).toBe("off");
  });

  it("a warn contract stays warn regardless of the tenant list", () => {
    expect(resolveMode("warn", "t-1", base)).toBe("warn");
    expect(resolveMode("warn", "t-1", env({ EVENT_CONTRACT_MODE: "per_contract", EVENT_CONTRACT_ENFORCE_TENANTS: "t-1" }))).toBe("warn");
  });

  it("an enforce contract is capped to warn when the tenant is not listed", () => {
    expect(resolveMode("enforce", "t-1", base)).toBe("warn");
    expect(
      resolveMode("enforce", "t-1", env({ EVENT_CONTRACT_MODE: "per_contract", EVENT_CONTRACT_ENFORCE_TENANTS: "t-2,t-3" })),
    ).toBe("warn");
  });

  it("an enforce contract enforces when the tenant is explicitly listed", () => {
    expect(
      resolveMode("enforce", "t-1", env({ EVENT_CONTRACT_MODE: "per_contract", EVENT_CONTRACT_ENFORCE_TENANTS: "t-2, t-1 ,t-3" })),
    ).toBe("enforce");
  });

  it("an enforce contract enforces when the tenant wildcard '*' is set", () => {
    expect(
      resolveMode("enforce", "any-tenant", env({ EVENT_CONTRACT_MODE: "per_contract", EVENT_CONTRACT_ENFORCE_TENANTS: "*" })),
    ).toBe("enforce");
  });
});

describe("resolveMode — relay-time (no tenant) is never enforce", () => {
  it("without a tenant, an enforce contract resolves at most to warn", () => {
    // Relay-time validation on publish is warn-only (section 4.2) so a
    // pre-deploy row cannot become a permanently stuck poison row.
    expect(
      resolveMode("enforce", undefined, env({ EVENT_CONTRACT_MODE: "per_contract", EVENT_CONTRACT_ENFORCE_TENANTS: "*" })),
    ).toBe("warn");
  });

  it("off still wins with no tenant", () => {
    expect(resolveMode("enforce", undefined, env({ EVENT_CONTRACT_MODE: "off" }))).toBe("off");
  });
});
