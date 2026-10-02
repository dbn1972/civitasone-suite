/**
 * GAP-RECRUITMENT-CAREERS-DETAIL-02: the consent version the candidate accepted is
 * persisted on the row AND carried on the audit event (no DB: repo/outbox mocked).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ insert: vi.fn(async () => undefined), enqueue: vi.fn(async () => undefined) }));
vi.mock("../src/shared/db.js", () => ({ db: { transaction: async (fn: (tx: unknown) => unknown) => fn({}) } }));
vi.mock("../src/shared/infra.js", () => ({ queue: {} }));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: m.enqueue }));
vi.mock("../src/modules/recruitment/repo.js", () => ({ insertApplication: m.insert, findApplicationByDedupKey: vi.fn() }));

import { submitPublicApplication } from "../src/modules/recruitment/commands.js";
import { CAREERS_CONSENT_VERSION } from "@civitasone/schemas";

beforeEach(() => { m.insert.mockClear(); m.enqueue.mockClear(); });

describe("submitPublicApplication consent", () => {
  it("stores the version and puts it on the audit payload", async () => {
    await submitPublicApplication("t1", {
      jobOpeningId: "j1", applicantName: "A B", email: "a@example.test", consent: true, consentVersion: CAREERS_CONSENT_VERSION,
    } as never, "a@example.test");
    const row = (m.insert.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(row.consentVersion).toBe(CAREERS_CONSENT_VERSION);
    expect(row.consentGivenAt).toBeInstanceOf(Date);
    const audit = (m.enqueue.mock.calls as unknown as [unknown, { topic: string; payload: Record<string, unknown> }][]).find((c) => c[1].topic === "audit.event.record")![1];
    expect(audit.payload.consentVersion).toBe(CAREERS_CONSENT_VERSION);
  });
});
