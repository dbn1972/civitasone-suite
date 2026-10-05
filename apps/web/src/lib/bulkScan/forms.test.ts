import { describe, it, expect } from "vitest";
import { buildCreateBatchBody, EMPTY_BATCH_FORM, isUuid, validateBatchForm, waitForBatchDelays } from "./batchForm";
import { formToBody, formToConfig, profileToForm } from "./profileForm";
import { clientListView, listView } from "./listView";

const CTX = { docTypeIds: ["service_book", "other"], allowedTargets: ["hr_employee", "finance_payment"] };
const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("batch creation form", () => {
  it("requires a name and bounds it", () => {
    expect(validateBatchForm(EMPTY_BATCH_FORM, CTX).name).toBe("nameRequired");
    expect(validateBatchForm({ ...EMPTY_BATCH_FORM, name: "x".repeat(201) }, CTX).name).toBe("nameTooLong");
    expect(validateBatchForm({ ...EMPTY_BATCH_FORM, name: "Ok" }, CTX)).toEqual({});
  });
  it("validates tags, doc type, folder, link target and profile", () => {
    const v = { ...EMPTY_BATCH_FORM, name: "n" };
    expect(validateBatchForm({ ...v, tags: Array.from({ length: 21 }, (_, i) => `t${i}`).join(",") }, CTX).tags).toBe("tagsInvalid");
    expect(validateBatchForm({ ...v, tags: "x".repeat(65) }, CTX).tags).toBe("tagsInvalid");
    expect(validateBatchForm({ ...v, defaultDocType: "nope" }, CTX).defaultDocType).toBe("docTypeUnknown");
    expect(validateBatchForm({ ...v, targetFolderId: "not-a-uuid" }, CTX).targetFolderId).toBe("folderInvalid");
    expect(validateBatchForm({ ...v, linkTarget: "eoffice_file" }, CTX).linkTarget).toBe("targetNotAllowed");
    expect(validateBatchForm({ ...v, linkTarget: "bogus" }, CTX).linkTarget).toBe("targetInvalid");
    expect(validateBatchForm({ ...v, linkTargetId: "abc" }, CTX).linkTarget).toBe("targetMissing");
    expect(validateBatchForm({ ...v, profileId: "x" }, CTX).profileId).toBe("profileInvalid");
    expect(validateBatchForm({ ...v, targetFolderId: UUID, profileId: UUID, linkTarget: "hr_employee" }, CTX)).toEqual({});
  });
  it("builds the request body exactly as the server schema expects", () => {
    expect(buildCreateBatchBody({ ...EMPTY_BATCH_FORM, name: "  Batch 1 ", tags: "a, b", defaultDocType: "service_book", linkTarget: "hr_employee", linkTargetId: " e1 ", targetFolderId: UUID, profileId: UUID })).toEqual({
      name: "Batch 1", targetFolderId: UUID, defaultTags: ["a", "b"], defaultDocType: "service_book", linkTarget: { target: "hr_employee", targetId: "e1" }, profileId: UUID,
    });
    expect(buildCreateBatchBody({ ...EMPTY_BATCH_FORM, name: "n" })).toEqual({ name: "n", defaultTags: [] });
  });
  it("uuid check and bounded create-wait schedule", () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid("zzz")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(waitForBatchDelays(4)).toEqual([300, 550, 800, 1050]);
    expect(Math.max(...waitForBatchDelays(30))).toBe(2000);
  });
});

describe("profile form", () => {
  it("round-trips only the overridden keys", () => {
    const form = profileToForm({ name: "P", description: null, config: { languages: ["hin"], dpi: 300, linkDefaults: { target: "hr_employee" }, classification: { uncertainMargin: 0.3 } } });
    expect(form).toMatchObject({ name: "P", languages: ["hin"], dpi: 300, linkTarget: "hr_employee", uncertainMargin: 0.3 });
    expect(form.reviewThreshold).toBeUndefined();
    expect(formToConfig(form)).toEqual({ languages: ["hin"], dpi: 300, linkDefaults: { target: "hr_employee" }, classification: { uncertainMargin: 0.3 } });
    expect(formToBody({ ...form, description: "  " })).toEqual({ name: "P", config: formToConfig(form) });
  });
});

describe("empty vs error vs ready", () => {
  it("a failed load is never empty", () => {
    expect(listView({ source: "error", data: { items: [] } })).toBe("error");
    expect(listView({ source: "api", data: { items: [] } })).toBe("empty");
    expect(listView({ source: "api", data: { items: [1] } })).toBe("ready");
    expect(listView({ source: "api", data: [] })).toBe("empty");
    expect(clientListView({ error: true, loading: false, count: 0 })).toBe("error");
    expect(clientListView({ error: false, loading: true, count: 0 })).toBe("loading");
    expect(clientListView({ error: false, loading: false, count: 0 })).toBe("empty");
  });
});
