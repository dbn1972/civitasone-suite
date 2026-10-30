import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { disableCell, seedMatrixForPattern } from "@/app/_components/ds/designer/notificationTypes";
import {
  mergeOutputsWithNotifications,
  notificationsConfigToUi,
  notificationsUiToConfig,
  persistNotificationTemplates,
} from "./notificationBuilderApi";

describe("notificationBuilderApi", () => {
  it("round-trips enabled and explicitly disabled bindings", () => {
    let matrix = seedMatrixForPattern("certificate");
    matrix = disableCell(matrix, "submitted", "sms");
    const cfg = notificationsUiToConfig({ matrix });
    expect(cfg.kind).toBe("notifications");
    const submittedSms = cfg.bindings.find((b) => b.event === "submitted" && b.channel === "sms");
    expect(submittedSms?.enabled).toBe(false);
    expect(submittedSms?.body.en).toBeTruthy();

    const ui = notificationsConfigToUi([cfg], "certificate");
    expect(ui.matrix.submitted?.sms?.enabled).toBe(false);
    expect(ui.matrix.payment_due?.whatsapp?.enabled).toBe(true);
  });

  it("merges notifications into outputs without dropping other kinds", () => {
    const existing = [{ kind: "issuance", outputType: "certificate" }];
    const cfg = notificationsUiToConfig({ matrix: seedMatrixForPattern("booking") });
    const merged = mergeOutputsWithNotifications(existing, cfg);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual(existing[0]);
    expect((merged[1] as { kind: string }).kind).toBe("notifications");
  });
});

/**
 * UX-016: persistNotificationTemplates's parseJson used to throw the raw
 * response body text (or a `Request failed (${status})` fallback) on a
 * failed template create/update — the same class of leak useFormError
 * closes for components (UX-003). This module is a plain async data
 * client, not a component, so it can't use that hook; it now goes through
 * the same catalogued toHumanError vocabulary instead. The caller here
 * treats a template save as best-effort (bindings are still saved in the
 * service definition's own outputs jsonb even if the template call fails),
 * so the message is caught rather than surfaced — this test pins that
 * still-safe fallback behavior rather than the message text itself.
 */
describe("notificationBuilderApi — persistNotificationTemplates stays best-effort on a failed template save", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("rejects (so the builder shows offline, not saved) when the template list call fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    let matrix = seedMatrixForPattern("certificate");
    matrix = disableCell(matrix, "submitted", "sms");

    await expect(persistNotificationTemplates({ matrix }, "svc-1")).rejects.toThrow(/unavailable/);
  });

  it("does not throw when the template list loads but the create call fails", async () => {
    fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      // The list read has no `method` (a plain GET); the create/update call
      // is always a POST or PATCH — distinguish on that, since both hit the
      // same "/notification/templates" path.
      if (!init?.method) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      return Promise.resolve(new Response("", { status: 503 }));
    });
    const matrix = seedMatrixForPattern("certificate");

    await expect(persistNotificationTemplates({ matrix }, "svc-1")).resolves.toBeTruthy();
  });
});

// CLOS3-S1-09: a non-OK template list used to be treated as "no templates exist", so every enabled
// cell POSTed a duplicate template under the same name.
describe("notificationBuilderApi — persistNotificationTemplates with an unreadable template list (CLOS3-S1-09)", () => {
  const fetchMock = vi.fn();
  const design = {
    matrix: { submitted: { email: { enabled: true, body: { en: "Hello" } } } },
  } as unknown as Parameters<typeof persistNotificationTemplates>[0];
  const writes = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method);

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates nothing and rejects so the caller can show offline when the list answers 503", async () => {
    fetchMock.mockImplementation(async (_i: RequestInfo | URL, init?: RequestInit) =>
      init?.method ? new Response(JSON.stringify({ id: "new" }), { status: 200 }) : new Response("", { status: 503 }),
    );
    await expect(persistNotificationTemplates(design, "k")).rejects.toThrow(/unavailable/);
    expect(writes()).toHaveLength(0);
  });

  it("still creates the template when the list is readable and empty", async () => {
    fetchMock.mockImplementation(async (_i: RequestInfo | URL, init?: RequestInit) =>
      init?.method
        ? new Response(JSON.stringify({ id: "new" }), { status: 200 })
        : new Response(JSON.stringify([]), { status: 200 }),
    );
    await persistNotificationTemplates(design, "k");
    const w = writes();
    expect(w).toHaveLength(1);
    expect((w[0][1] as RequestInit).method).toBe("POST");
  });
});

// UAT F73: the builder called /api/proxy/v1/notification/templates, which the gateway maps to
// /v1/notification/templates. notification-service serves template CRUD only at
// /notifications/templates (reached via /api/proxy/notification/templates), so the list call
// 404'd and nothing was saved.
describe("notificationBuilderApi: persistNotificationTemplates targets the served template path (UAT F73)", () => {
  const fetchMock = vi.fn();
  const SERVED = "/api/proxy/notification/templates";
  const design = {
    matrix: {
      submitted: { email: { enabled: true, body: { en: "Hello" }, subject: { en: "Hi" } } },
      approved: { sms: { enabled: true, body: { en: "Approved" } } },
    },
  } as unknown as Parameters<typeof persistNotificationTemplates>[0];

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists, creates and updates via /api/proxy/notification/templates and binds the current version id", async () => {
    fetchMock.mockImplementation(async (_i: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) {
        return new Response(
          JSON.stringify([{ id: "tmpl-old", name: "svc:k:approved:sms", channel: "sms", body: "Old", subject: null }]),
          { status: 200 },
        );
      }
      const id = init.method === "PATCH" ? "tmpl-v2" : "tmpl-new";
      return new Response(JSON.stringify({ id, status: "accepted", correlationId: "c" }), { status: 202 });
    });

    const next = await persistNotificationTemplates(design, "k");

    const calls = fetchMock.mock.calls.map(([url, init]) => [String(url), (init as RequestInit | undefined)?.method ?? "GET"]);
    expect(calls).toEqual(
      expect.arrayContaining([
        [SERVED, "GET"],
        [SERVED, "POST"],
        [`${SERVED}/tmpl-old`, "PATCH"],
      ]),
    );
    expect(calls).toHaveLength(3);
    for (const [url] of calls) expect(url).not.toContain("/v1/notification/");

    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
      channel: "email",
      name: "svc:k:submitted:email",
      body: "Hello",
      subject: "Hi",
    });

    expect(next.matrix.submitted?.email?.templateId).toBe("tmpl-new");
    // PATCH supersedes tmpl-old; the binding follows the new current version.
    expect(next.matrix.approved?.sms?.templateId).toBe("tmpl-v2");
  });
});
