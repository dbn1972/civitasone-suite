/**
 * V4-G-06 — pack notifications must be addressed to the citizen's real
 * email / mobile, never the citizen profile UUID (notification-service passes
 * `recipient` verbatim to the SMTP / SMS / WhatsApp adapters).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { enqueuePackNotifications } from "./notification-bindings.js";

vi.mock("../../shared/outbox.js", () => ({
  enqueue: vi.fn(async () => undefined),
}));

vi.mock("./repo.js", () => ({
  findPublishedByServiceIdTx: vi.fn(),
}));

import { enqueue } from "../../shared/outbox.js";
import * as catalogueRepo from "./repo.js";

const TPL_EMAIL = globalThis.crypto.randomUUID();
const TPL_SMS = globalThis.crypto.randomUUID();
const TPL_WA = globalThis.crypto.randomUUID();
const TPL_INAPP = globalThis.crypto.randomUUID();
const SERVICE_ID = globalThis.crypto.randomUUID();
const TENANT = globalThis.crypto.randomUUID();
const CITIZEN = globalThis.crypto.randomUUID();

function txWithProfile(profile: { email: string | null; mobile: string | null } | null) {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (profile ? [profile] : []) }) }) }),
  } as never;
}

function bind(channels: Array<[string, string]>) {
  vi.mocked(catalogueRepo.findPublishedByServiceIdTx).mockResolvedValue({
    id: "def", tenantId: TENANT, serviceKey: "k", serviceId: SERVICE_ID, name: "Svc",
    outputs: [{
      kind: "notifications",
      bindings: channels.map(([channel, templateId]) => ({ event: "submitted", channel, enabled: true, templateId })),
    }],
  } as never);
}

async function run(tx: never, recipientId = CITIZEN) {
  const count = await enqueuePackNotifications(tx, {
    tenantId: TENANT, actorId: "a", correlationId: "c", serviceId: SERVICE_ID,
    lifecycleEvent: "submitted", recipient: recipientId, recipientId,
  });
  const payloads = vi.mocked(enqueue).mock.calls.map((c) => c[1].payload as {
    channel: string; recipient: string; recipientId?: string;
  });
  return { count, payloads };
}

describe("V4-G-06 citizen recipient resolution", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("addresses email to profile.email and sms/whatsapp to profile.mobile, keeping recipientId", async () => {
    bind([["email", TPL_EMAIL], ["sms", TPL_SMS], ["whatsapp", TPL_WA]]);
    const { count, payloads } = await run(txWithProfile({ email: "citizen@example.org", mobile: "+919800000000" }));
    expect(count).toBe(3);
    expect(payloads.find((p) => p.channel === "email")?.recipient).toBe("citizen@example.org");
    expect(payloads.find((p) => p.channel === "sms")?.recipient).toBe("+919800000000");
    expect(payloads.find((p) => p.channel === "whatsapp")?.recipient).toBe("+919800000000");
    expect(payloads.every((p) => p.recipientId === CITIZEN)).toBe(true);
    expect(payloads.some((p) => p.recipient === CITIZEN)).toBe(false);
  });

  it("keeps the citizen id for in_app (inbox is keyed by user id)", async () => {
    bind([["in_app", TPL_INAPP]]);
    const { payloads } = await run(txWithProfile(null));
    expect(payloads[0]?.recipient).toBe(CITIZEN);
  });

  it("skips a channel the citizen has no address for instead of sending to the UUID", async () => {
    bind([["email", TPL_EMAIL], ["sms", TPL_SMS]]);
    const { count, payloads } = await run(txWithProfile({ email: "citizen@example.org", mobile: null }));
    expect(count).toBe(1);
    expect(payloads.map((p) => p.channel)).toEqual(["email"]);
  });

  it("skips external channels when the profile does not exist", async () => {
    bind([["sms", TPL_SMS]]);
    const { count } = await run(txWithProfile(null));
    expect(count).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
