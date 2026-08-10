import { describe, it, expect, afterEach } from "vitest";
import {
  FINANCE_CHALLAN_CREATE,
  BILLING_INVOICE_CREATE,
  NOTIFICATION_SEND,
  buildMunicipalFeeChallanPayload,
  buildMunicipalStatusNotification,
  municipalDecisionNotificationEventType,
  MUNICIPAL_FEE_RECEIPT_HEAD_PLACEHOLDER,
  resolveMunicipalFeeReceiptHeadId,
} from "../src/municipal-cross.js";

describe("municipal cross-service event helpers", () => {
  afterEach(() => {
    delete process.env.MUNICIPAL_FEE_RECEIPT_HEAD_ID;
  });

  it("exports canonical finance and notification topics", () => {
    expect(FINANCE_CHALLAN_CREATE).toBe("finance.challan.create");
    expect(BILLING_INVOICE_CREATE).toBe("billing.invoice.create");
    expect(NOTIFICATION_SEND).toBe("notification.send");
  });

  it("buildMunicipalFeeChallanPayload serialises bigint fee amounts", () => {
    const payload = buildMunicipalFeeChallanPayload({
      id: "c1",
      tenantId: "t1",
      depositor: "Acme Shop",
      amountMinor: 150000n,
      sourceService: "shop",
      sourceRef: "app-1",
    });
    expect(payload.amountMinor).toBe(150000);
    expect(payload.receiptHeadId).toBe(MUNICIPAL_FEE_RECEIPT_HEAD_PLACEHOLDER);
    expect(payload.challanNo).toBe("PENDING");
    expect(payload.sourceService).toBe("shop");
  });

  it("resolveMunicipalFeeReceiptHeadId honours env override", () => {
    process.env.MUNICIPAL_FEE_RECEIPT_HEAD_ID = "dddddddd-0001-0000-0000-000000000020";
    expect(resolveMunicipalFeeReceiptHeadId()).toBe("dddddddd-0001-0000-0000-000000000020");
  });

  it("municipalDecisionNotificationEventType maps approved to citizen template", () => {
    expect(
      municipalDecisionNotificationEventType("shop.application.decided", "approved"),
    ).toBe("citizen.application.approved");
    expect(
      municipalDecisionNotificationEventType("shop.application.decided", "rejected"),
    ).toBe("shop.application.decided");
  });

  it("buildMunicipalStatusNotification uses citizen.application.approved template", () => {
    const note = buildMunicipalStatusNotification({
      eventType: "citizen.application.approved",
      recipient: "user-1",
      recipientId: "user-1",
      variables: { applicationId: "app-1" },
    });
    expect(note.templateId).toBe("00000000-0000-4000-8001-000000000004");
    expect(note.eventType).toBe("citizen.application.approved");
  });
});
