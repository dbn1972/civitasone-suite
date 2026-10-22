/**
 * GAP-HR-EMPLOYEES-IMPORT-02: bulk-import/failure.ts -- mapping a create-consumer failure to a stable,
 * PII-free code, and the queue wrapper that now forwards subscribe options (onOutcome).
 */
import { describe, it, expect, vi } from "vitest";
import { NonRetryableError } from "@civitasone/queue";
import { classifyCreateFailure, failureCodeFromOutcome, sqlStateOf, IMPORT_FAILURE } from "../src/modules/bulk-import/failure.js";
import { isCommandRefusal } from "../src/shared/outbox.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";

const pgError = (code: string) => Object.assign(new Error("duplicate key value violates unique constraint"), { code });

describe("sqlStateOf", () => {
  it("reads the SQLSTATE off the error itself or off a wrapped cause (drizzle wraps driver errors)", () => {
    expect(sqlStateOf(pgError("23505"))).toBe("23505");
    expect(sqlStateOf(Object.assign(new Error("Failed query: insert ..."), { cause: pgError("23503") }))).toBe("23503");
  });
  it("ignores things that are not SQLSTATEs", () => {
    expect(sqlStateOf(new Error("boom"))).toBeUndefined();
    expect(sqlStateOf(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBeUndefined();
    expect(sqlStateOf(null)).toBeUndefined();
    expect(sqlStateOf("23505")).toBeUndefined();
  });
});

describe("classifyCreateFailure", () => {
  it.each([
    ["23505", "EMPLOYEE_NO_EXISTS"],
    ["23503", "INVALID_REFERENCE"],
    ["23514", "INVALID_VALUE"],
    ["23502", "INVALID_VALUE"],
    ["22P02", "INVALID_VALUE"],
    ["22001", "INVALID_VALUE"],
    ["22007", "INVALID_VALUE"],
  ])("turns SQLSTATE %s into a non-retryable refusal coded %s", (state, code) => {
    const out = classifyCreateFailure(pgError(state));
    expect(isCommandRefusal(out)).toBe(true);
    expect(out).toBeInstanceOf(NonRetryableError);
    expect((out as { code: string }).code).toBe(code);
  });

  it("carries a parseable code in the message (that is all the queue's outcome hook sees) and never the SQL or values", () => {
    const wrapped = Object.assign(new Error('Failed query: insert into "employee"."hrms_employees" params: Asha Rao,9876543210'), { cause: pgError("23505") });
    const out = classifyCreateFailure(wrapped) as Error;
    expect(out.message).toMatch(/^EMPLOYEE_NO_EXISTS: /);
    expect(out.message).not.toMatch(/Asha|9876543210|insert into/);
  });

  it("leaves a transient failure (lost connection, deadlock) untouched so it is still retried", () => {
    const transient = Object.assign(new Error("connection terminated"), { code: "ECONNRESET" });
    expect(classifyCreateFailure(transient)).toBe(transient);
    const deadlock = pgError("40P01");
    expect(classifyCreateFailure(deadlock)).toBe(deadlock);
  });
});

describe("failureCodeFromOutcome", () => {
  it("recovers the code from a rejected outcome's reason", () => {
    expect(failureCodeFromOutcome({ status: "rejected", reason: "EMPLOYEE_NO_EXISTS: employee could not be created (sqlstate 23505)" })).toBe("EMPLOYEE_NO_EXISTS");
    expect(failureCodeFromOutcome({ status: "rejected", reason: "INVALID_REFERENCE: x" })).toBe("INVALID_REFERENCE");
  });
  it("falls back to CREATE_FAILED for retries-exhausted, unknown codes and missing reasons -- never echoing the reason", () => {
    expect(failureCodeFromOutcome({ status: "failed", reason: "EMPLOYEE_NO_EXISTS: ignored for a retries-exhausted failure" })).toBe(IMPORT_FAILURE.CREATE_FAILED);
    expect(failureCodeFromOutcome({ status: "rejected", reason: "SOMETHING_ELSE: Asha Rao" })).toBe(IMPORT_FAILURE.CREATE_FAILED);
    expect(failureCodeFromOutcome({ status: "rejected" })).toBe(IMPORT_FAILURE.CREATE_FAILED);
  });
});

describe("tenantScoped", () => {
  it("passes subscribe options (onOutcome) through to the underlying queue", () => {
    const subscribe = vi.fn();
    const scoped = tenantScoped({ subscribe } as never);
    const onOutcome = vi.fn();
    scoped.subscribe("t.topic", async () => {}, { onOutcome });
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0]![0]).toBe("t.topic");
    expect(subscribe.mock.calls[0]![2]).toEqual({ onOutcome });
  });

  it("still works with no options", () => {
    const subscribe = vi.fn();
    tenantScoped({ subscribe } as never).subscribe("t.topic", async () => {});
    expect(subscribe.mock.calls[0]![2]).toBeUndefined();
  });
});
