import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard: no locale file may contain the same key twice in one object, at any depth.
 *
 * JSON.parse (and therefore next-intl) silently keeps the LAST duplicate, so a block that an auto-merge pasted
 * twice -- or one half of a block that two branches both added -- disappears without any error, and the copy
 * that "wins" can be the older, partial one (HR cluster 05 found duplicate `training` blocks in hi.json this
 * way). Parity tests cannot see it either, because they read the already-collapsed object.
 */
function findDuplicateKeys(text: string): string[] {
  let i = 0;
  const dups: string[] = [];
  const skipWs = (): void => { while (i < text.length && /\s/.test(text[i]!)) i++; };
  /** Reads the string literal at `i` and returns its decoded value. */
  const readString = (): string => {
    const start = ++i;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    const raw = text.slice(start, i);
    i++;
    return JSON.parse(`"${raw}"`) as string;
  };
  const readValue = (path: string): void => {
    skipWs();
    const c = text[i];
    if (c === "{") {
      i++;
      skipWs();
      if (text[i] === "}") { i++; return; }
      const seen = new Set<string>();
      for (;;) {
        skipWs();
        const key = readString();
        skipWs();
        i++; // ':'
        const keyPath = path ? `${path}.${key}` : key;
        if (seen.has(key)) dups.push(keyPath);
        seen.add(key);
        readValue(keyPath);
        skipWs();
        if (text[i] === ",") { i++; continue; }
        i++; // '}'
        return;
      }
    } else if (c === "[") {
      i++;
      skipWs();
      if (text[i] === "]") { i++; return; }
      for (let n = 0; ; n++) {
        readValue(`${path}[${n}]`);
        skipWs();
        if (text[i] === ",") { i++; continue; }
        i++; // ']'
        return;
      }
    } else if (c === '"') {
      readString();
    } else {
      while (i < text.length && !/[\s,}\]]/.test(text[i]!)) i++; // number / true / false / null
    }
  };
  readValue("");
  return dups;
}

describe("locale JSON has no duplicate keys", () => {
  const files = readdirSync(__dirname).filter((f) => f.endsWith(".json")).sort();

  it("finds the locale files it is meant to guard", () => {
    expect(files).toEqual(expect.arrayContaining(["en.json", "hi.json"]));
  });

  it.each(files)("%s has no key repeated within an object", (file) => {
    expect(findDuplicateKeys(readFileSync(join(__dirname, file), "utf8"))).toEqual([]);
  });

  describe("the detector itself", () => {
    it("reports a repeated top-level block and a repeated nested key, by path", () => {
      expect(findDuplicateKeys('{"a":{"x":1,"x":2},"b":1,"b":{"y":1}}')).toEqual(["a.x", "b"]);
    });
    it("reports duplicates inside arrays, and keys that differ only by an escape", () => {
      expect(findDuplicateKeys('{"l":[{"k":1,"k":2}],"A":1,"\\u0041":2}')).toEqual(["l[0].k", "A"]);
    });
    it("does not flag the same key in different objects, nor a repeated value", () => {
      expect(findDuplicateKeys('{"a":{"x":"x"},"b":{"x":"x"},"c":[{"x":1},{"x":1}],"d":"d","e":null,"f":-1.5e3,"g":true,"h":{},"i":[]}')).toEqual([]);
    });
    it("is not fooled by braces, quotes and colons inside strings", () => {
      expect(findDuplicateKeys('{"a":"{\\"b\\":1,\\"b\\":2}","c":"x, y: z"}')).toEqual([]);
    });
  });
});
