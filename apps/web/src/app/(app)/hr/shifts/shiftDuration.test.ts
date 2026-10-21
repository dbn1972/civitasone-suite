import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { formatShiftDuration, type ShiftDurationTranslator } from "./shiftDuration";

function translator(locale: "en" | "hi"): ShiftDurationTranslator {
  const t = createTranslator({ locale, messages: locale === "hi" ? hiMessages : enMessages, namespace: "shifts" });
  return (key, values) => t(key, values);
}

describe("formatShiftDuration (GAP-HR-SHIFTS-02)", () => {
  const en = translator("en");

  it("a 22:00-06:00 night shift (480 min from the API) reads 8h 0m", () => {
    expect(formatShiftDuration(480, en)).toBe("8h 0m");
  });

  it("whole hours and part hours both use the h/m form", () => {
    expect(formatShiftDuration(510, en)).toBe("8h 30m");
    expect(formatShiftDuration(60, en)).toBe("1h 0m");
  });

  it("under an hour is minutes, and zero is a real zero rather than a dash", () => {
    expect(formatShiftDuration(15, en)).toBe("15 min");
    expect(formatShiftDuration(0, en)).toBe("0 min");
  });

  it("absent / invalid input is a dash", () => {
    expect(formatShiftDuration(undefined, en)).toBe("—");
    expect(formatShiftDuration(null, en)).toBe("—");
    expect(formatShiftDuration(Number.NaN, en)).toBe("—");
    expect(formatShiftDuration(-5, en)).toBe("—");
  });

  it("is localised: the Hindi wording is used, with no English unit left behind", () => {
    const hi = translator("hi");
    expect(formatShiftDuration(480, hi)).toBe("8 घं 0 मि");
    expect(formatShiftDuration(15, hi)).toBe("15 मिनट");
    expect(formatShiftDuration(480, hi)).not.toMatch(/[hm]\b/);
  });
});
