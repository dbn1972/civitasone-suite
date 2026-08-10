import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";

describe("sewerage-service routes", () => {
  it("exports buildApp factory", () => {
    expect(typeof buildApp).toBe("function");
  });
});
