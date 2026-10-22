import { describe, it, expect } from "vitest";
import { listContainsId } from "./listContainsId";

describe("listContainsId", () => {
  it("finds an id in a bare array", () => {
    expect(listContainsId([{ id: "a" }, { id: "b" }], "b")).toBe(true);
  });

  it("finds an id in a { data } envelope", () => {
    expect(listContainsId({ data: [{ id: "a" }] }, "a")).toBe(true);
  });

  it("is false when the id is absent", () => {
    expect(listContainsId([{ id: "a" }], "z")).toBe(false);
    expect(listContainsId({ data: [] }, "z")).toBe(false);
  });

  it("is false for payloads that are not lists, and for malformed rows", () => {
    expect(listContainsId(null, "a")).toBe(false);
    expect(listContainsId(undefined, "a")).toBe(false);
    expect(listContainsId("a", "a")).toBe(false);
    expect(listContainsId({ data: "nope" }, "a")).toBe(false);
    expect(listContainsId([null, 3, { name: "no id" }], "a")).toBe(false);
  });
});
