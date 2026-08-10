import { describe, it, expect } from "vitest";
import {
  calculateRegistrationFee,
  generateRegistrationNumber,
} from "../src/modules/registration/domain.js";
import {
  canTransition,
  generateComplaintNumber,
  routeComplaint,
} from "../src/modules/complaints/domain.js";

describe("animal-service domain", () => {
  it("calculates dog registration fee", () => {
    expect(calculateRegistrationFee("dog")).toBe(50000n);
  });
  it("calculates default registration fee", () => {
    expect(calculateRegistrationFee("other")).toBe(25000n);
  });
  it("generates registration number", () => {
    expect(generateRegistrationNumber("DEL", 5)).toMatch(/^ANML-REG\/DEL\/\d{4}\/000005$/);
  });
  it("allows reported → assigned complaint", () => {
    expect(canTransition("reported", "assigned")).toBe(true);
  });
  it("rejects closed → assigned complaint", () => {
    expect(canTransition("closed", "assigned")).toBe(false);
  });
  it("generates complaint number", () => {
    expect(generateComplaintNumber("MUM", 2)).toMatch(/^ANML\/MUM\/\d{4}\/000002$/);
  });
  it("routes snake to veterinary", () => {
    expect(routeComplaint("snake", "low")).toBe("veterinary");
  });
  it("routes cattle to cattle squad", () => {
    expect(routeComplaint("cattle", "medium")).toBe("cattle_squad");
  });
  it("routes bite complaints to animal control", () => {
    expect(routeComplaint("bite", "high")).toBe("animal_control");
  });
});