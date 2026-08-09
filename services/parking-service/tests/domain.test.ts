import { describe, it, expect } from "vitest";
import {
  canTransition,
  generateBookingNumber,
  calculateParkingFee,
} from "../src/modules/bookings/domain.js";
import { generatePassNumber } from "../src/modules/passes/domain.js";
import { generateViolationNumber, calculateFineMinor } from "../src/modules/enforcement/domain.js";

describe("parking-service domain", () => {
  it("allows booked → active", () => {
    expect(canTransition("booked", "active")).toBe(true);
  });
  it("rejects completed → active", () => {
    expect(canTransition("completed", "active")).toBe(false);
  });
  it("generates booking number", () => {
    expect(generateBookingNumber("MUM", 4)).toMatch(/^PKG-B\/MUM\/\d{4}\/000004$/);
  });
  it("calculates parking fee by hour ceiling", () => {
    expect(calculateParkingFee(61, 5000n)).toBe(10000n);
  });
  it("calculates single hour parking fee", () => {
    expect(calculateParkingFee(30, 5000n)).toBe(5000n);
  });
  it("generates pass number", () => {
    expect(generatePassNumber("DEL", 1)).toMatch(/^PKG-P\/DEL\/\d{4}\/000001$/);
  });
  it("generates violation number", () => {
    expect(generateViolationNumber("PNQ", 7)).toMatch(/^PKG-V\/PNQ\/\d{4}\/000007$/);
  });
  it("calculates obstruction fine", () => {
    expect(calculateFineMinor("obstruction")).toBe(200000n);
  });
  it("calculates default fine", () => {
    expect(calculateFineMinor("unknown")).toBe(50000n);
  });
});