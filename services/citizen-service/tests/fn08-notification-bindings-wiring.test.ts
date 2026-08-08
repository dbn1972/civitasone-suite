/**
 * FN-08 — consumer wiring smoke (source-level): lifecycle consumers must call
 * enqueuePackNotifications so pack bindings reach notification.send.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function src(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("FN-08 pack notification binding wiring", () => {
  it("application consumer enqueues pack notifications on submit and status events", () => {
    const s = src("src/modules/application/consumer.ts");
    expect(s).toMatch(/enqueuePackNotifications/);
    expect(s).toMatch(/lifecycleEvent:\s*"submitted"/);
    expect(s).toMatch(/"approved"/);
    expect(s).toMatch(/"rejected"/);
    expect(s).toMatch(/"issued"/);
  });

  it("fee-payment consumer enqueues payment_due and payment_received", () => {
    const s = src("src/modules/fee-payment/consumer.ts");
    expect(s).toMatch(/enqueuePackNotifications/);
    expect(s).toMatch(/lifecycleEvent:\s*"payment_due"/);
    expect(s).toMatch(/lifecycleEvent:\s*"payment_received"/);
    expect(s).toMatch(/pay_link/);
    expect(s).toMatch(/formatAmountMajor/);
  });

  it("issuance consumer enqueues issued with cert_no", () => {
    const s = src("src/modules/issuance/consumer.ts");
    expect(s).toMatch(/enqueuePackNotifications/);
    expect(s).toMatch(/lifecycleEvent:\s*"issued"/);
    expect(s).toMatch(/cert_no/);
  });
});
