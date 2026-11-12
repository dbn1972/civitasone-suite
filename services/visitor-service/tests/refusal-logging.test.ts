/**
 * Every non-retryable consumer refusal must leave a log line with reason + correlation id
 * (previously a refusal only surfaced as a bare DLQ entry).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NonRetryableError } from "@civitasone/queue";

const warn = vi.fn();
vi.mock("pino", () => ({ pino: () => ({ warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn() }) }));

const { nonRetryableOnDomainRejection, logNonRetryableRefusals } = await import("../src/shared/domain-rejection.js");

const msg = { tenantId: "t-1", correlationId: "corr-42", messageId: "m-1", payload: {} } as never;

class DomainError extends Error {
  constructor(public code: string, m: string) { super(`[${code}] ${m}`); this.name = "DomainError"; }
}

beforeEach(() => warn.mockReset());

describe("refusal logging", () => {
  it("logs a NonRetryableError with topic, tenant, correlation id and reason, then rethrows it", async () => {
    const h = nonRetryableOnDomainRejection(async () => { throw new NonRetryableError("pass expired"); }, "visitor.check_in.record");
    await expect(h(msg)).rejects.toBeInstanceOf(NonRetryableError);
    expect(warn).toHaveBeenCalledTimes(1);
    const [fields, text] = warn.mock.calls[0]!;
    expect(fields).toMatchObject({ event: "consumer_refused", topic: "visitor.check_in.record", tenantId: "t-1", correlationId: "corr-42", reason: "pass expired" });
    expect(text).toContain("pass expired");
  });

  it("converts and logs a DomainError", async () => {
    const h = nonRetryableOnDomainRejection(async () => { throw new DomainError("INVALID_TRANSITION", "nope"); }, "t");
    await expect(h(msg)).rejects.toBeInstanceOf(NonRetryableError);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not log transient errors (they are retried)", async () => {
    const h = nonRetryableOnDomainRejection(async () => { throw new Error("ECONNRESET"); }, "t");
    await expect(h(msg)).rejects.toThrow("ECONNRESET");
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs once when the worker-level wrapper sits outside the module wrapper", async () => {
    const inner = nonRetryableOnDomainRejection(async () => { throw new NonRetryableError("refused"); }, "t");
    const outer = logNonRetryableRefusals(inner, "t");
    await expect(outer(msg)).rejects.toBeInstanceOf(NonRetryableError);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("the worker-level wrapper alone logs a handler's NonRetryableError", async () => {
    const outer = logNonRetryableRefusals(async () => { throw new NonRetryableError("printer gone"); }, "visitor.print_job.create");
    await expect(outer(msg)).rejects.toBeInstanceOf(NonRetryableError);
    expect(warn.mock.calls[0]![0]).toMatchObject({ topic: "visitor.print_job.create", correlationId: "corr-42" });
  });
});
