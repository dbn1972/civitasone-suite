import { describe, expect, it } from "vitest";
import { emptyNotificationsDesign, seedMatrixForPattern } from "@/app/_components/ds/designer/notificationTypes";
import type { FormFieldDefinition } from "@/app/_components/ds/designer/formTypes";
import {
  defaultSampleValues,
  matrixCompleteness,
  mergeFieldsForNotifications,
  sampleFormDesignFromFields,
  summarizeDesign,
} from "./notificationBuilderModel";

describe("notificationBuilderModel", () => {
  it("includes B2 form answers in merge fields", () => {
    const fields: FormFieldDefinition[] = [
      {
        id: "f1",
        apiName: "trade_name",
        type: "text",
        label: "Trade name",
        required: true,
        sectionId: "s1",
      },
    ];
    const merged = mergeFieldsForNotifications(fields);
    expect(merged.some((f) => f.key === "trade_name" && f.group === "Form answers")).toBe(true);
    expect(merged.some((f) => f.key === "app_no")).toBe(true);
  });

  it("builds sample FormDesign for FormRenderer preview", () => {
    const design = sampleFormDesignFromFields([], "Trade License");
    expect(design.sections[0]?.fieldIds).toContain("applicant_name");
    expect(design.fields.applicant_name?.apiName).toBe("applicant_name");
  });

  it("summarises locale completeness across enabled cells", () => {
    const matrix = seedMatrixForPattern("certificate");
    const c = matrixCompleteness(matrix, "certificate");
    expect(c.enabledCount).toBeGreaterThan(0);
    expect(c.localesComplete).toBe(true);
    expect(c.meterLabel).toMatch(/^EN \d+\/\d+ · HI \d+\/\d+$/);

    matrix.submitted!.sms!.body.hi = "";
    const incomplete = matrixCompleteness(matrix, "certificate");
    expect(incomplete.localesComplete).toBe(false);
    expect(summarizeDesign({ matrix }, "certificate")).toMatch(/messages on/);
  });

  it("explains empty enablement", () => {
    const empty = emptyNotificationsDesign("collection");
    for (const channels of Object.values(empty.matrix)) {
      for (const cell of Object.values(channels ?? {})) {
        if (cell) cell.enabled = false;
      }
    }
    expect(summarizeDesign(empty, "collection")).toMatch(/No messages enabled/);
  });

  it("defaults sample values with service name", () => {
    expect(defaultSampleValues("Hall Booking").service_name).toBe("Hall Booking");
  });
});
