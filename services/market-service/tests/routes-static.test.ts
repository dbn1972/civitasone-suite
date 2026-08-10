import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";

describe("market-service routes", () => {
  it("exports buildApp factory", () => {
    expect(typeof buildApp).toBe("function");
  });
});
