import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import type { TenantLifecycleRequest } from "@/app/_data/loaders";
import {
  availableActions, checkEditForm, checkPolicyForm, failureKey, hasAnyAction, hasOpenRequest, knownErrorCode,
  normalizePolicy, pendingPolicyOf, requestTone, tenantStatusKey, tenantStatusTone, toggleRole, toIsoOrNull, FALLBACK_POLICY,
} from "./lifecycleModel";

function req(over: Partial<TenantLifecycleRequest> = {}): TenantLifecycleRequest {
  return {
    id: "r1", kind: "suspend", status: "pending", reason: "x", payload: {}, effectiveAt: null,
    requestedAt: "2026-10-03T00:00:00Z", requestedByYou: false, requiredApprovals: 1, approvalsCount: 0,
    decidedAt: null, decidedByYou: false, decisionReason: null, failureCode: null, directExecution: false, canDecide: true, canCancel: false, cancelledByYou: false, cancelReason: null,
    ...over,
  };
}

describe("tenant status", () => {
  it("maps known statuses and never passes an unknown raw value through", () => {
    expect(tenantStatusKey("Suspended")).toBe("suspended");
    expect(tenantStatusKey("weird_state")).toBe("unknown");
    expect(tenantStatusKey(undefined)).toBe("unknown");
    expect(tenantStatusTone("active")).toBe("good");
    expect(tenantStatusTone("suspended")).toBe("bad");
  });
  it("request tones", () => {
    expect(requestTone("pending")).toBe("warn");
    expect(requestTone("executed")).toBe("good");
    expect(requestTone("failed")).toBe("bad");
  });
});

describe("availableActions", () => {
  it("active tenant: suspend + edit, no reactivate", () => {
    expect(availableActions("active", [])).toEqual({ suspend: true, reactivate: false, edit: true });
  });
  it("suspended tenant: reactivate + edit, no suspend", () => {
    expect(availableActions("suspended", [])).toEqual({ suspend: false, reactivate: true, edit: true });
  });
  it("an open request of a kind hides that action, a finished one does not", () => {
    expect(availableActions("active", [req({ kind: "suspend", status: "pending" })]).suspend).toBe(false);
    expect(availableActions("active", [req({ kind: "suspend", status: "rejected" })]).suspend).toBe(true);
    expect(hasOpenRequest([req({ kind: "edit", status: "scheduled" })], "edit")).toBe(true);
  });
  it("archived and unknown tenants are read-only", () => {
    expect(hasAnyAction(availableActions("archived", []))).toBe(false);
    expect(hasAnyAction(availableActions("???", []))).toBe(false);
  });
});

describe("error code mapping", () => {
  it("only catalogued codes get specific copy", () => {
    expect(knownErrorCode("MAKER_CHECKER_VIOLATION")).toBe("MAKER_CHECKER_VIOLATION");
    expect(knownErrorCode("SOMETHING_ELSE")).toBeNull();
    expect(failureKey("EXECUTION_FAILED")).toBe("EXECUTION_FAILED");
    expect(failureKey("nope")).toBe("default");
    expect(failureKey(null)).toBe("default");
  });
});

describe("checkEditForm", () => {
  const current = { name: "Old Office", domain: "old.gov.in", edition: "psu" };
  it("requires a change and returns only what changed", () => {
    expect(checkEditForm(current, current)).toEqual({ ok: false, error: "noChange" });
    expect(checkEditForm({ ...current, name: " New Office " }, current)).toEqual({ ok: true, changes: { name: "New Office" } });
    expect(checkEditForm({ ...current, edition: "small_office" }, current)).toEqual({ ok: true, changes: { edition: "small_office" } });
  });
  it("validates name and domain", () => {
    expect(checkEditForm({ ...current, name: "A" }, current)).toEqual({ ok: false, error: "name" });
    expect(checkEditForm({ ...current, domain: "bad domain!" }, current)).toEqual({ ok: false, error: "domain" });
  });
});

describe("policy helpers", () => {
  it("normalizePolicy falls back to the strict default for anything unusable", () => {
    expect(normalizePolicy(null)).toEqual(FALLBACK_POLICY);
    expect(normalizePolicy({ policy: {} as never, isDefault: true, pendingChange: null }).requiresSecondApprover).toBe(true);
    const p = normalizePolicy({ policy: { requiresSecondApprover: false, approverRoles: ["super_admin"], minApprovals: 2, reasonRequired: false, notifyTenantAdmins: false }, isDefault: false, pendingChange: null });
    expect(p).toEqual({ requiresSecondApprover: false, approverRoles: ["super_admin"], minApprovals: 2, reasonRequired: false, notifyTenantAdmins: false });
  });
  it("checkPolicyForm needs a role and a real change", () => {
    expect(checkPolicyForm({ ...FALLBACK_POLICY, approverRoles: [] }, FALLBACK_POLICY)).toEqual({ ok: false, error: "roles" });
    expect(checkPolicyForm({ ...FALLBACK_POLICY, approverRoles: [...FALLBACK_POLICY.approverRoles].reverse() }, FALLBACK_POLICY)).toEqual({ ok: false, error: "noChange" });
    expect(checkPolicyForm({ ...FALLBACK_POLICY, minApprovals: 2 }, FALLBACK_POLICY)).toEqual({ ok: true });
  });
  it("toggleRole / pendingPolicyOf / toIsoOrNull", () => {
    expect(toggleRole(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleRole(["a", "b"], "a")).toEqual(["b"]);
    const open = req({ kind: "policy_change" });
    expect(pendingPolicyOf([open], null)).toBe(open);
    expect(pendingPolicyOf([req({ kind: "policy_change", status: "executed" })], null)).toBeNull();
    expect(toIsoOrNull("")).toBeNull();
    expect(toIsoOrNull("not a date")).toBeNull();
    expect(toIsoOrNull("2026-10-04T10:00")).toMatch(/^2026-10-04T/);
  });
});

describe("tenantLifecycle messages", () => {
  type Tree = { [k: string]: string | Tree };
  const flat = (o: Tree, prefix = ""): Record<string, string> =>
    Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
      if (typeof v === "string") acc[prefix + k] = v; else Object.assign(acc, flat(v, `${prefix}${k}.`));
      return acc;
    }, {});
  const en = flat((enMessages as unknown as { tenantLifecycle: Tree }).tenantLifecycle);
  const hi = flat((hiMessages as unknown as { tenantLifecycle: Tree }).tenantLifecycle);
  const params = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort().join(",");

  it("hi has exactly the en keys, with the same placeholders", () => {
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) expect(params(hi[k]!), k).toBe(params(en[k]!));
  });
  it("every tenant/request status and kind the model can emit has a label", () => {
    for (const k of ["active", "suspended", "draft", "archived", "unknown"]) expect(en[`tenantStatus.${k}`]).toBeTruthy();
    for (const k of ["pending", "scheduled", "executed", "rejected", "failed", "unknown"]) expect(en[`requestStatus.${k}`]).toBeTruthy();
    for (const k of ["suspend", "reactivate", "edit", "policy_change", "unknown"]) expect(en[`kind.${k}`]).toBeTruthy();
  });
});
