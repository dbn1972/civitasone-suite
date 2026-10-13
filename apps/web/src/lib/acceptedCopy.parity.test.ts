import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import { ACCEPTED_COPY } from "./acceptedCopy";

describe("asyncAccepted copy parity (SF-15)", () => {
  it("messages en/hi mirror lib/acceptedCopy for every key", () => {
    expect((en as Record<string, unknown>).asyncAccepted).toEqual(ACCEPTED_COPY.en);
    expect((hi as Record<string, unknown>).asyncAccepted).toEqual(ACCEPTED_COPY.hi);
  });
  it("hi has the same keys as en and no value is left in English", () => {
    expect(Object.keys(ACCEPTED_COPY.hi).sort()).toEqual(Object.keys(ACCEPTED_COPY.en).sort());
    for (const k of Object.keys(ACCEPTED_COPY.en) as Array<keyof typeof ACCEPTED_COPY.en>) {
      expect(ACCEPTED_COPY.hi[k]).not.toBe(ACCEPTED_COPY.en[k]);
    }
  });
});
