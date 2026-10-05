/** Dominant-script detection from recognised text (Unicode block counting; deterministic). */
const RANGES: ReadonlyArray<readonly [string, number, number]> = [
  ["Devanagari", 0x0900, 0x097f],
  ["Bengali", 0x0980, 0x09ff],
  ["Gurmukhi", 0x0a00, 0x0a7f],
  ["Gujarati", 0x0a80, 0x0aff],
  ["Oriya", 0x0b00, 0x0b7f],
  ["Tamil", 0x0b80, 0x0bff],
  ["Telugu", 0x0c00, 0x0c7f],
  ["Kannada", 0x0c80, 0x0cff],
  ["Malayalam", 0x0d00, 0x0d7f],
  ["Arabic", 0x0600, 0x06ff],
  ["Arabic", 0x0750, 0x077f],
  ["Latin", 0x0041, 0x005a],
  ["Latin", 0x0061, 0x007a],
  ["Latin", 0x00c0, 0x024f],
];

/** Returns the script with the most letters in `text`, or null if there are no letters. */
export function detectScript(text: string): string | null {
  const counts = new Map<string, number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    for (const [name, lo, hi] of RANGES) {
      if (cp >= lo && cp <= hi) { counts.set(name, (counts.get(name) ?? 0) + 1); break; }
    }
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [name, n] of counts) if (n > bestN) { best = name; bestN = n; }
  return best;
}
