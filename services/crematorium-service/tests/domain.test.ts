import { describe, it, expect } from "vitest";
import {
  canTransition,
  generateBookingNumber,
  calculateFeeMinor,
} from "../src/modules/bookings/domain.js";

describe("crematorium-service domain", () => {
  it("allows requested → confirmed", () => {
    expect(canTransition("requested", "confirmed")).toBe(true);
  });
  it("rejects completed → confirmed", () => {
    expect(canTransition("completed", "confirmed")).toBe(false);
  });
  it("allows confirmed → completed", () => {
    expect(canTransition("confirmed", "completed")).toBe(true);
  });
  it("allows requested → cancelled", () => {
    expect(canTransition("requested", "cancelled")).toBe(true);
  });
  it("generates booking number", () => {
    expect(generateBookingNumber("DEL", 6)).toMatch(/^CREM\/DEL\/\d{4}\/000006$/);
  });
  it("calculates electric cremation fee", () => {
    expect(calculateFeeMinor("electric_cremation")).toBe(150000n);
  });
  it("calculates burial fee", () => {
    expect(calculateFeeMinor("burial")).toBe(30000n);
  });
});