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

  it("does not throw and returns the matrix unchanged when the template list call fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    let matrix = seedMatrixForPattern("certificate");
    matrix = disableCell(matrix, "submitted", "sms");

    const result = await persistNotificationTemplates({ matrix }, "svc-1");
    expect(result.matrix).toEqual(matrix);
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
