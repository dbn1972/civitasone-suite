import { describe, it, expect } from "vitest";
import { isEofficeFileInFlight, normalizeFileStatus } from "./eofficeFileStatus";

describe("isEofficeFileInFlight", () => {
  it("open / in progress / pending are in flight, in any casing or spacing", () => {
    for (const s of ["open", "in_progress", "In Progress", "in-progress", "PENDING"]) expect(isEofficeFileInFlight(s)).toBe(true);
  });
  it("rejected, closed, approved, withdrawn, empty are not", () => {
    for (const s of ["rejected", "closed", "approved", "withdrawn", "", null, undefined]) expect(isEofficeFileInFlight(s)).toBe(false);
  });
  it("normalizes", () => expect(normalizeFileStatus(" In Progress ")).toBe("in_progress"));
});
