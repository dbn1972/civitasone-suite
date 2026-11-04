import { describe, it, expect } from "vitest";
import { amountInWordsEn, amountInWordsHi, integerToIndianWords, integerToHindiWords } from "./amount-words.js";

describe("integerToIndianWords (Indian system)", () => {
  it.each([
    [0, "Zero"],
    [7, "Seven"],
    [19, "Nineteen"],
    [20, "Twenty"],
    [45, "Forty Five"],
    [100, "One Hundred"],
    [101, "One Hundred One"],
    [999, "Nine Hundred Ninety Nine"],
    [1000, "One Thousand"],
    [6002, "Six Thousand Two"],
    [99_999, "Ninety Nine Thousand Nine Hundred Ninety Nine"],
    [1_00_000, "One Lakh"],
    [1_00_001, "One Lakh One"],
    [2_13_756, "Two Lakh Thirteen Thousand Seven Hundred Fifty Six"],
    [99_99_999, "Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine"],
    [1_00_00_000, "One Crore"],
    [1_00_00_001, "One Crore One"],
    [1_02_03_004, "One Crore Two Lakh Three Thousand Four"],
    [99_99_99_999, "Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine"],
    [1_00_00_00_000, "One Hundred Crore"],
  ])("%d -> %s", (n, words) => {
    expect(integerToIndianWords(n)).toBe(words);
  });

  it("spells a crore count above 99 in the Indian system (one lakh crore)", () => {
    expect(integerToIndianWords(10n ** 12n)).toBe("One Lakh Crore");
    expect(integerToIndianWords(12_345n * 10_000_000n)).toBe("Twelve Thousand Three Hundred Forty Five Crore");
  });

  it("rejects negative input", () => {
    expect(() => integerToIndianWords(-1)).toThrow(RangeError);
  });
});

describe("amountInWordsEn", () => {
  it("whole rupees", () => {
    expect(amountInWordsEn(600_200n)).toBe("Rupees Six Thousand Two Only");
  });
  it("rupees and paise", () => {
    expect(amountInWordsEn(1_234_550n)).toBe("Rupees Twelve Thousand Three Hundred Forty Five and Fifty Paise Only");
    expect(amountInWordsEn(12_345_678n)).toBe("Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Eight Paise Only");
  });
  it("lakh and crore boundaries in paise", () => {
    expect(amountInWordsEn(9_999_999n)).toBe("Rupees Ninety Nine Thousand Nine Hundred Ninety Nine and Ninety Nine Paise Only");
    expect(amountInWordsEn(10_000_000n)).toBe("Rupees One Lakh Only");
    expect(amountInWordsEn(999_999_999n)).toBe("Rupees Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine and Ninety Nine Paise Only");
    expect(amountInWordsEn(1_000_000_000n)).toBe("Rupees One Crore Only");
  });
  it("paise only, zero and negative", () => {
    expect(amountInWordsEn(50n)).toBe("Fifty Paise Only");
    expect(amountInWordsEn(0n)).toBe("Rupees Zero Only");
    expect(amountInWordsEn(-100n)).toBe("Minus Rupees One Only");
  });
  it("exact beyond 2^53 paise (no float)", () => {
    expect(amountInWordsEn(9_007_199_254_740_993n)).toBe(
      "Rupees Ninety Lakh Seven Thousand One Hundred Ninety Nine Crore Twenty Five Lakh Forty Seven Thousand Four Hundred Nine and Ninety Three Paise Only",
    );
  });
});

describe("Hindi words", () => {
  it("irregular numbers 0-99", () => {
    expect(integerToHindiWords(0)).toBe("शून्य");
    expect(integerToHindiWords(15)).toBe("पंद्रह");
    expect(integerToHindiWords(45)).toBe("पैंतालीस");
    expect(integerToHindiWords(56)).toBe("छप्पन");
    expect(integerToHindiWords(78)).toBe("अठहत्तर");
    expect(integerToHindiWords(99)).toBe("निन्यानवे");
  });
  it("lakh and crore", () => {
    expect(integerToHindiWords(1_00_000)).toBe("एक लाख");
    expect(integerToHindiWords(1_00_00_000)).toBe("एक करोड़");
    expect(integerToHindiWords(1_23_45_678)).toBe("एक करोड़ तेईस लाख पैंतालीस हज़ार छह सौ अठहत्तर");
  });
  it("amounts", () => {
    expect(amountInWordsHi(600_200n)).toBe("छह हज़ार दो रुपये मात्र");
    expect(amountInWordsHi(1_234_550n)).toBe("बारह हज़ार तीन सौ पैंतालीस रुपये और पचास पैसे मात्र");
    expect(amountInWordsHi(10_000_000n)).toBe("एक लाख रुपये मात्र");
    expect(amountInWordsHi(0n)).toBe("शून्य रुपये मात्र");
    expect(amountInWordsHi(50n)).toBe("पचास पैसे मात्र");
  });
});
