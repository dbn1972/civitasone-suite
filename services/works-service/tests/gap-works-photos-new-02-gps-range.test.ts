/** GAP-WORKS-EXECUTION-PHOTOS-NEW-02: photo GPS is range-validated server-side, both-or-neither. */
import { describe, it, expect } from "vitest";
import { uploadPhotoSchema } from "../src/modules/execution/validators.js";

const base = { workId: "3f000000-cccc-4000-8000-0000000000a1", fileKey: "photos/a.jpg" };

describe("uploadPhotoSchema GPS", () => {
  it("accepts no coordinates and a valid pair", () => {
    expect(uploadPhotoSchema.safeParse(base).success).toBe(true);
    expect(uploadPhotoSchema.safeParse({ ...base, latitude: 19.07, longitude: 72.87 }).success).toBe(true);
    expect(uploadPhotoSchema.safeParse({ ...base, latitude: 0, longitude: 0 }).success).toBe(true);
  });
  it("rejects out-of-range latitude/longitude", () => {
    expect(uploadPhotoSchema.safeParse({ ...base, latitude: 95, longitude: 10 }).success).toBe(false);
    expect(uploadPhotoSchema.safeParse({ ...base, latitude: -91, longitude: 10 }).success).toBe(false);
    expect(uploadPhotoSchema.safeParse({ ...base, latitude: 10, longitude: 181 }).success).toBe(false);
    expect(uploadPhotoSchema.safeParse({ ...base, latitude: 10, longitude: Number.NaN }).success).toBe(false);
  });
  it("rejects a lone coordinate", () => {
    expect(uploadPhotoSchema.safeParse({ ...base, latitude: 10 }).success).toBe(false);
    expect(uploadPhotoSchema.safeParse({ ...base, longitude: 10 }).success).toBe(false);
  });
});
