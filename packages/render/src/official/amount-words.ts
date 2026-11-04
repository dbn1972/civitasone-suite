/**
 * Amount in words for Indian official documents (payslip, sanction order, PO, invoice, voucher).
 *
 * Indian numbering system: crore (10^7), lakh (10^5), thousand, hundred. Amounts are exact bigint
 * paise end to end, never a float. Above 99 crore the crore count is itself spelt in the Indian
 * system ("One Thousand Crore", "One Lakh Crore"), which is how Government accounts write it.
 *
 *   amountInWordsEn(12345678n)  -> "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Eight Paise Only"
 *   amountInWordsHi(600200n)    -> "छह हज़ार दो रुपये मात्र"
 */

const EN_ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
] as const;
const EN_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"] as const;

/** Hindi number words 0-99 (each is irregular, so a table is the only correct form). */
const HI_0_99 = [
  "शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ",
  "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस",
  "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस",
  "तीस", "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस",
  "चालीस", "इकतालीस", "बयालीस", "तैंतालीस", "चवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास",
  "पचास", "इक्यावन", "बावन", "तिरपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ",
  "साठ", "इकसठ", "बासठ", "तिरसठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर",
  "सत्तर", "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उन्यासी",
  "अस्सी", "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सत्तासी", "अट्ठासी", "नवासी",
  "नब्बे", "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पचानवे", "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे",
] as const;

const CRORE = 10_000_000n;
const LAKH = 100_000n;
const THOUSAND = 1_000n;

interface Vocabulary {
  belowHundred(n: number): string;
  hundred: string;
  thousand: string;
  lakh: string;
  crore: string;
  zero: string;
}

const EN: Vocabulary = {
  belowHundred(n) {
    if (n < 20) return EN_ONES[n] as string;
    const tens = EN_TENS[Math.floor(n / 10)] as string;
    const ones = n % 10;
    return ones === 0 ? tens : `${tens} ${EN_ONES[ones] as string}`;
  },
  hundred: "Hundred",
  thousand: "Thousand",
  lakh: "Lakh",
  crore: "Crore",
  zero: "Zero",
};

const HI: Vocabulary = {
  belowHundred: (n) => HI_0_99[n] as string,
  hundred: "सौ",
  thousand: "हज़ार",
  lakh: "लाख",
  crore: "करोड़",
  zero: "शून्य",
};

function belowThousand(v: Vocabulary, n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${v.belowHundred(hundreds)} ${v.hundred}`);
  if (rest > 0) parts.push(v.belowHundred(rest));
  return parts.join(" ");
}

function indianWords(v: Vocabulary, n: bigint): string {
  if (n < 0n) throw new RangeError("indianWords: negative input");
  if (n === 0n) return v.zero;
  const parts: string[] = [];
  const crore = n / CRORE;
  let rest = n % CRORE;
  if (crore > 0n) parts.push(`${indianWords(v, crore)} ${v.crore}`);
  const lakh = Number(rest / LAKH);
  rest %= LAKH;
  if (lakh > 0) parts.push(`${v.belowHundred(lakh)} ${v.lakh}`);
  const thousand = Number(rest / THOUSAND);
  rest %= THOUSAND;
  if (thousand > 0) parts.push(`${v.belowHundred(thousand)} ${v.thousand}`);
  const below = Number(rest);
  if (below > 0) parts.push(belowThousand(v, below));
  return parts.join(" ");
}

/** A whole number in English words, Indian system ("One Crore Two Lakh Three Thousand"). */
export function integerToIndianWords(n: bigint | number): string {
  return indianWords(EN, toWhole(n));
}

/** A whole number in Hindi words, Indian system ("एक करोड़ दो लाख तीन हज़ार"). */
export function integerToHindiWords(n: bigint | number): string {
  return indianWords(HI, toWhole(n));
}

function toWhole(n: bigint | number): bigint {
  if (typeof n === "bigint") return n;
  if (!Number.isSafeInteger(n)) throw new RangeError("integer words: not a safe integer");
  return BigInt(n);
}

function splitMinor(minor: bigint): { negative: boolean; rupees: bigint; paise: bigint } {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  return { negative, rupees: abs / 100n, paise: abs % 100n };
}

/**
 * "Rupees Six Thousand Two Only", "Rupees Twelve Thousand Three Hundred Forty Five and Fifty Paise Only",
 * "Fifty Paise Only", "Rupees Zero Only". Negative amounts are prefixed "Minus".
 */
export function amountInWordsEn(minor: bigint): string {
  const { negative, rupees, paise } = splitMinor(minor);
  let body: string;
  if (rupees === 0n && paise === 0n) body = "Rupees Zero Only";
  else if (paise === 0n) body = `Rupees ${indianWords(EN, rupees)} Only`;
  else if (rupees === 0n) body = `${indianWords(EN, paise)} Paise Only`;
  else body = `Rupees ${indianWords(EN, rupees)} and ${indianWords(EN, paise)} Paise Only`;
  return negative ? `Minus ${body}` : body;
}

/** "छह हज़ार दो रुपये मात्र", "बारह हज़ार तीन सौ पैंतालीस रुपये और पचास पैसे मात्र". Negative: "ऋण ...". */
export function amountInWordsHi(minor: bigint): string {
  const { negative, rupees, paise } = splitMinor(minor);
  let body: string;
  if (rupees === 0n && paise === 0n) body = "शून्य रुपये मात्र";
  else if (paise === 0n) body = `${indianWords(HI, rupees)} रुपये मात्र`;
  else if (rupees === 0n) body = `${indianWords(HI, paise)} पैसे मात्र`;
  else body = `${indianWords(HI, rupees)} रुपये और ${indianWords(HI, paise)} पैसे मात्र`;
  return negative ? `ऋण ${body}` : body;
}
