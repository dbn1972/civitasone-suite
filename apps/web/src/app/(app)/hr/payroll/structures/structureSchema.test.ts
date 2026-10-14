import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { validateStructure } from "./structureSchema";

/** Every key a schema returns must exist in both locale bundles (hrFormErrors2). */
const expectKey = (key: string) => {
  expect((enMessages as unknown as Record<string, Record<string, string>>).hrFormErrors2[key], `en ${key}`).toBeTruthy();
  expect((hiMessages as unknown as Record<string, Record<string, string>>).hrFormErrors2[key], `hi ${key}`).toBeTruthy();
};

const ok = { name: "Level 6 Staff", description: "" };

describe("structureSchema schema", () => {
  it("accepts a valid body", () => {
    expect(validateStructure(ok)).toEqual({});
  });
  it("blank name -> structureNameRequired", () => {
    expect(validateStructure({ ...ok, name: "   " }).name).toBe("structureNameRequired");
    expectKey("structureNameRequired");
  });
  it("name over 128 -> structureNameMax", () => {
    expect(validateStructure({ ...ok, name: "n".repeat(129) }).name).toBe("structureNameMax");
    expectKey("structureNameMax");
  });
  it("description over 500 -> structureDescriptionMax", () => {
    expect(validateStructure({ ...ok, description: "d".repeat(501) }).description).toBe("structureDescriptionMax");
    expectKey("structureDescriptionMax");
  });
});
