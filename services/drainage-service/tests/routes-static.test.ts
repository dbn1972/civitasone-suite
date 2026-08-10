import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";

describe("drainage-service routes", () => {
  it("exports buildApp factory", () => {
    expect(typeof buildApp).toBe("function");
  });
});
