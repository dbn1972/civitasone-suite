/**
 * The web upload form omits folderId/mimeType/sizeBytes when empty (it must not
 * send null). Run that exact body shape through the real uploadFileBody schema.
 */
import { describe, it, expect } from "vitest";
import { uploadFileBody } from "../src/modules/files/validators.js";

describe("uploadFileBody vs web form body", () => {
  it("accepts the root-folder body with empty optionals omitted", () => {
    expect(uploadFileBody.safeParse({ name: "a.pdf", tags: [] }).success).toBe(true);
  });
  it("accepts a fully populated body", () => {
    const body = { name: "a.pdf", folderId: "5b1d2f0e-6a43-4c1e-9f64-3b8d7c2a1e90", mimeType: "application/pdf", sizeBytes: 12, tags: ["x"] };
    expect(uploadFileBody.safeParse(body).success).toBe(true);
  });
  it("still rejects null optionals (why the form must omit them)", () => {
    expect(uploadFileBody.safeParse({ name: "a.pdf", folderId: null, tags: [] }).success).toBe(false);
  });
});
