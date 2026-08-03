/**
 * steps/dispatch.ts unit tests (P1-8) — the pure planning half of step dispatch.
 *
 * Covers, per step type, that a step's config is honoured rather than ignored;
 * that an unsupported type or unusable config is a hard failure and never a
 * default; and the api_call SSRF allowlist, which is the one place a
 * tenant-authored value reaches the network.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  planStep,
  performApiCall,
  assertUrlAllowed,
  readPath,
  evaluate,
  StepDispatchError,
  FAILURE_CODES,
} from "../src/modules/steps/dispatch.js";

const PROFILE = "eeeeeeee-1111-4000-8000-000000000001";
const TEMPLATE = "ffffffff-1111-4000-8000-000000000001";
const NOW = new Date("2026-08-03T10:00:00.000Z");

function plan(stepType: string, config: Record<string, unknown>, context: Record<string, unknown> = {}) {
  return planStep({ stepType, config, profileId: PROFILE, context, now: NOW });
}

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ── Unsupported / unusable steps ─────────────────────────────────────────────

describe("planStep — a step it cannot honour never becomes a success", () => {
  it("rejects an unknown step type as a non-retryable failure", () => {
    try {
      plan("send_carrier_pigeon", {});
      expect.unreachable("planStep must throw for an unknown step type");
    } catch (err) {
      expect(err).toBeInstanceOf(StepDispatchError);
      expect((err as StepDispatchError).code).toBe(FAILURE_CODES.unknownStepType);
      expect((err as StepDispatchError).retryable).toBe(false);
    }
  });

  it("names the supported types in the error so the operator can fix the journey", () => {
    expect(() => plan("email_blast", {})).toThrow(/send_notification, wait, condition_check, api_call/);
  });

  it("rejects send_notification with no templateId", () => {
    try {
      plan("send_notification", { channel: "email" });
      expect.unreachable("planStep must reject a config it cannot dispatch");
    } catch (err) {
      expect((err as StepDispatchError).code).toBe(FAILURE_CODES.invalidStepConfig);
      expect((err as StepDispatchError).retryable).toBe(false);
    }
  });

  it("rejects a wait step with no delay at all", () => {
    try {
      plan("wait", {});
      expect.unreachable("a wait with no delay is not a wait");
    } catch (err) {
      expect((err as StepDispatchError).code).toBe(FAILURE_CODES.invalidStepConfig);
    }
  });

  it("rejects a negative wait delay", () => {
    expect(() => plan("wait", { delayHours: -3 })).toThrow(StepDispatchError);
  });

  it("rejects a condition step with no operator", () => {
    expect(() => plan("condition_check", { attribute: "tier" })).toThrow(StepDispatchError);
  });
});

// ── send_notification ────────────────────────────────────────────────────────

describe("planStep — send_notification", () => {
  it("builds the notification command from the step config", () => {
    const p = plan("send_notification", {
      templateId: TEMPLATE,
      channel: "sms",
      variables: { name: "Asha" },
    });
    expect(p.kind).toBe("notify");
    expect(p.status).toBe("completed");
    expect(p.runOutcome).toBe("advance");
    expect(p.kind === "notify" && p.notification).toEqual({
      templateId: TEMPLATE,
      recipientId: PROFILE,
      channel: "sms",
      variables: { name: "Asha" },
      category: "marketing",
    });
  });

  it("defaults the recipient to the enrolled profile", () => {
    const p = plan("send_notification", { templateId: TEMPLATE });
    expect(p.kind === "notify" && p.notification["recipientId"]).toBe(PROFILE);
  });

  it("honours an explicit recipient override", () => {
    const other = "eeeeeeee-2222-4000-8000-000000000002";
    const p = plan("send_notification", { templateId: TEMPLATE, recipientId: other });
    expect(p.kind === "notify" && p.notification["recipientId"]).toBe(other);
  });

  it("defaults to a marketing send so notification-service applies its consent gate", () => {
    const p = plan("send_notification", { templateId: TEMPLATE });
    expect(p.kind === "notify" && p.notification["category"]).toBe("marketing");
  });

  it("allows a transactional send to be declared explicitly", () => {
    const p = plan("send_notification", { templateId: TEMPLATE, category: "transactional" });
    expect(p.kind === "notify" && p.notification["category"]).toBe("transactional");
  });
});

// ── wait ─────────────────────────────────────────────────────────────────────

describe("planStep — wait", () => {
  it("parks the run at a resume deadline instead of completing", () => {
    const p = plan("wait", { delayHours: 2 });
    expect(p.kind).toBe("wait");
    expect(p.status).toBe("waiting");
    expect(p.runOutcome).toBe("park");
    expect(p.kind === "wait" && p.resumeAt.toISOString()).toBe("2026-08-03T12:00:00.000Z");
  });

  it("sums every delay unit supplied", () => {
    const p = plan("wait", { delayDays: 1, delayHours: 2, delayMinutes: 3, delaySeconds: 4 });
    const expected = NOW.getTime() + (86_400 + 7_200 + 180 + 4) * 1_000;
    expect(p.kind === "wait" && p.resumeAt.getTime()).toBe(expected);
  });
});

// ── condition_check ──────────────────────────────────────────────────────────

describe("planStep — condition_check", () => {
  it("continues the run when the gate passes", () => {
    const p = plan("condition_check", { attribute: "tier", operator: "eq", value: "gold" }, { tier: "gold" });
    expect(p.status).toBe("completed");
    expect(p.runOutcome).toBe("advance");
    expect(p.kind === "condition" && p.passed).toBe(true);
  });

  it("skips the step but keeps the run going when onFalse defaults to skip", () => {
    const p = plan("condition_check", { attribute: "tier", operator: "eq", value: "gold" }, { tier: "bronze" });
    expect(p.status).toBe("skipped");
    expect(p.runOutcome).toBe("advance");
    expect(p.kind === "condition" && p.passed).toBe(false);
  });

  it("exits the run when the gate asks for it", () => {
    const p = plan(
      "condition_check",
      { attribute: "optedIn", operator: "eq", value: true, onFalse: "exit" },
      { optedIn: false },
    );
    expect(p.status).toBe("skipped");
    expect(p.runOutcome).toBe("exit");
  });

  it("reads a nested attribute path", () => {
    const p = plan(
      "condition_check",
      { attribute: "profile.address.state", operator: "eq", value: "Odisha" },
      { profile: { address: { state: "Odisha" } } },
    );
    expect(p.kind === "condition" && p.passed).toBe(true);
  });

  it("treats a missing attribute as not matching rather than throwing", () => {
    const p = plan("condition_check", { attribute: "absent", operator: "eq", value: 1 }, {});
    expect(p.kind === "condition" && p.passed).toBe(false);
    expect(p.status).toBe("skipped");
  });
});

describe("readPath", () => {
  it("walks nested records", () => {
    expect(readPath({ a: { b: { c: 7 } } }, "a.b.c")).toBe(7);
  });

  it("returns undefined for a missing hop", () => {
    expect(readPath({ a: {} }, "a.b.c")).toBeUndefined();
  });

  it("returns undefined when a hop is not an object", () => {
    expect(readPath({ a: 5 }, "a.b")).toBeUndefined();
  });
});

describe("evaluate — condition operators", () => {
  it("eq / neq compare strictly", () => {
    expect(evaluate("eq", "a", "a")).toBe(true);
    expect(evaluate("eq", 1, "1")).toBe(false);
    expect(evaluate("neq", 1, 2)).toBe(true);
  });

  it("exists / not_exists treat null as absent", () => {
    expect(evaluate("exists", null, undefined)).toBe(false);
    expect(evaluate("exists", 0, undefined)).toBe(true);
    expect(evaluate("not_exists", undefined, undefined)).toBe(true);
  });

  it("numeric comparisons coerce and refuse non-numbers", () => {
    expect(evaluate("gt", 5, 3)).toBe(true);
    expect(evaluate("gte", 3, 3)).toBe(true);
    expect(evaluate("lt", 2, 3)).toBe(true);
    expect(evaluate("lte", 3, 3)).toBe(true);
    expect(evaluate("gt", "abc", 3)).toBe(false);
  });

  it("in checks membership of the expected list", () => {
    expect(evaluate("in", "b", ["a", "b"])).toBe(true);
    expect(evaluate("in", "z", ["a", "b"])).toBe(false);
    expect(evaluate("in", "a", "not-an-array")).toBe(false);
  });

  it("contains works on arrays and strings", () => {
    expect(evaluate("contains", ["x", "y"], "x")).toBe(true);
    expect(evaluate("contains", "hello world", "world")).toBe(true);
    expect(evaluate("contains", 42, "4")).toBe(false);
  });
});

// ── api_call SSRF guard ──────────────────────────────────────────────────────

describe("assertUrlAllowed — api_call target guard", () => {
  beforeEach(() => {
    process.env["JOURNEY_API_CALL_ALLOWED_HOSTS"] = "hooks.example.gov.in,.partner.example.com";
    delete process.env["JOURNEY_API_CALL_ALLOW_INSECURE"];
  });

  it("allows an exact allowlisted https host", () => {
    expect(assertUrlAllowed("https://hooks.example.gov.in/journey").hostname).toBe("hooks.example.gov.in");
  });

  it("allows a subdomain of a dot-prefixed allowlist entry", () => {
    expect(assertUrlAllowed("https://eu.partner.example.com/hook").hostname).toBe("eu.partner.example.com");
  });

  it("allows the apex of a dot-prefixed allowlist entry", () => {
    expect(assertUrlAllowed("https://partner.example.com/hook").hostname).toBe("partner.example.com");
  });

  it("fails closed when no allowlist is configured", () => {
    delete process.env["JOURNEY_API_CALL_ALLOWED_HOSTS"];
    try {
      assertUrlAllowed("https://hooks.example.gov.in/journey");
      expect.unreachable("an unconfigured allowlist must block every api_call");
    } catch (err) {
      expect((err as StepDispatchError).code).toBe(FAILURE_CODES.apiCallNotConfigured);
      expect((err as StepDispatchError).retryable).toBe(false);
    }
  });

  it("blocks a host that is not allowlisted", () => {
    try {
      assertUrlAllowed("https://attacker.example.net/steal");
      expect.unreachable("an off-allowlist host must be blocked");
    } catch (err) {
      expect((err as StepDispatchError).code).toBe(FAILURE_CODES.apiCallBlocked);
    }
  });

  it("does not let a lookalike suffix pass the exact-host rule", () => {
    expect(() => assertUrlAllowed("https://evilhooks.example.gov.in.attacker.net/x")).toThrow(StepDispatchError);
  });

  it("rejects plain http unless explicitly permitted", () => {
    expect(() => assertUrlAllowed("http://hooks.example.gov.in/journey")).toThrow(/must use https/);
    process.env["JOURNEY_API_CALL_ALLOW_INSECURE"] = "true";
    expect(assertUrlAllowed("http://hooks.example.gov.in/journey").protocol).toBe("http:");
  });

  it("rejects a non-http scheme", () => {
    expect(() => assertUrlAllowed("file:///etc/passwd")).toThrow(StepDispatchError);
  });

  it("blocks loopback, private and cloud-metadata addresses even when allowlisted", () => {
    for (const host of ["127.0.0.1", "localhost", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254"]) {
      process.env["JOURNEY_API_CALL_ALLOWED_HOSTS"] = host;
      process.env["JOURNEY_API_CALL_ALLOW_INSECURE"] = "true";
      expect(() => assertUrlAllowed(`http://${host}/latest/meta-data`)).toThrow(/loopback, link-local or private/);
    }
  });

  it("blocks IPv6 loopback and unique-local addresses", () => {
    process.env["JOURNEY_API_CALL_ALLOWED_HOSTS"] = "::1,fd00::1";
    expect(() => assertUrlAllowed("https://[::1]/x")).toThrow(StepDispatchError);
    expect(() => assertUrlAllowed("https://[fd00::1]/x")).toThrow(StepDispatchError);
  });

  it("rejects a malformed url", () => {
    expect(() => assertUrlAllowed("not a url")).toThrow(StepDispatchError);
  });
});

describe("performApiCall — request shape and failure classification", () => {
  beforeEach(() => {
    process.env["JOURNEY_API_CALL_ALLOWED_HOSTS"] = "hooks.example.gov.in";
  });

  const request = {
    url: "https://hooks.example.gov.in/journey",
    method: "POST" as const,
    timeoutMs: 1_000,
    body: { event: "step" },
  };
  const meta = { idempotencyKey: "msg-1", correlationId: "corr-1", tenantId: "t-1" };

  it("sends the correlation and idempotency headers with the configured body", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const res = await performApiCall(request, meta, (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch);

    expect(res.status).toBe(200);
    expect(seen!.url).toBe("https://hooks.example.gov.in/journey");
    expect(seen!.init.method).toBe("POST");
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("msg-1");
    expect(headers["x-correlation-id"]).toBe("corr-1");
    expect(seen!.init.body).toBe(JSON.stringify({ event: "step" }));
  });

  it("treats 4xx as a terminal rejection", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 422 })) as unknown as typeof fetch;
    await expect(performApiCall(request, meta, fetchImpl)).rejects.toMatchObject({
      code: FAILURE_CODES.apiCallRejected,
      retryable: false,
    });
  });

  it("treats 5xx as retryable", async () => {
    const fetchImpl = (async () => new Response("boom", { status: 503 })) as unknown as typeof fetch;
    await expect(performApiCall(request, meta, fetchImpl)).rejects.toMatchObject({
      code: FAILURE_CODES.apiCallUnavailable,
      retryable: true,
    });
  });

  it("treats 429 as retryable, not as a client error", async () => {
    const fetchImpl = (async () => new Response("slow down", { status: 429 })) as unknown as typeof fetch;
    await expect(performApiCall(request, meta, fetchImpl)).rejects.toMatchObject({
      code: FAILURE_CODES.apiCallUnavailable,
      retryable: true,
    });
  });

  it("treats a transport failure as retryable", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    await expect(performApiCall(request, meta, fetchImpl)).rejects.toMatchObject({
      code: FAILURE_CODES.apiCallUnavailable,
      retryable: true,
    });
  });

  it("does not call out at all when the target is blocked", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      performApiCall({ ...request, url: "https://attacker.example.net/x" }, meta, fetchImpl),
    ).rejects.toMatchObject({ code: FAILURE_CODES.apiCallBlocked });
    expect(called).toBe(false);
  });
});
