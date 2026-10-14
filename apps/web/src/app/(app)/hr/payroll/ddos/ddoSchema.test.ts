import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { validateDdo } from "./ddoSchema";

/** Every key a schema returns must exist in both locale bundles (hrFormErrors2). */
const expectKey = (key: string) => {
  expect((enMessages as unknown as Record<string, Record<string, string>>).hrFormErrors2[key], `en ${key}`).toBeTruthy();
  expect((hiMessages as unknown as Record<string, Record<string, string>>).hrFormErrors2[key], `hi ${key}`).toBeTruthy();
};

const ok = { ddoCode: "DDO-001", name: "Treasury DDO" };
const RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,31}$/;

describe("ddoSchema schema", () => {
  it("accepts a valid body", () => {
    expect(validateDdo(ok, RE)).toEqual({});
  });
  it("blank code -> ddoCodeRequired", () => {
    expect(validateDdo({ ...ok, ddoCode: "" }, RE).ddoCode).toBe("ddoCodeRequired");
    expectKey("ddoCodeRequired");
  });
  it("code over 32 -> ddoCodeMax", () => {
    expect(validateDdo({ ...ok, ddoCode: "D".repeat(33) }, RE).ddoCode).toBe("ddoCodeMax");
    expectKey("ddoCodeMax");
  });
  it("code with a space -> ddoCodeFormat", () => {
    expect(validateDdo({ ...ok, ddoCode: "DDO 001" }, RE).ddoCode).toBe("ddoCodeFormat");
    expectKey("ddoCodeFormat");
  });
  it("blank name -> ddoNameRequired", () => {
    expect(validateDdo({ ...ok, name: "" }, RE).name).toBe("ddoNameRequired");
    expectKey("ddoNameRequired");
  });
  it("name over 200 -> ddoNameMax", () => {
    expect(validateDdo({ ...ok, name: "n".repeat(201) }, RE).name).toBe("ddoNameMax");
    expectKey("ddoNameMax");
  });
});
