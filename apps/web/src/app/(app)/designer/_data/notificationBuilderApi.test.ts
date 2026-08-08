import { describe, expect, it } from "vitest";
import { disableCell, seedMatrixForPattern } from "@/app/_components/ds/designer/notificationTypes";
import {
  mergeOutputsWithNotifications,
  notificationsConfigToUi,
  notificationsUiToConfig,
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
