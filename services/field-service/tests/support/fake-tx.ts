/**
 * Minimal drizzle-shaped fake for repo tests. Every builder method returns the
 * same thenable, which resolves to the next queued result, and the method
 * names + args are recorded so tests can assert on the query that was built.
 */
export interface Recorded {
  verb: "select" | "insert" | "update";
  calls: Array<[string, unknown[]]>;
}

export function makeFakeTx(results: unknown[]) {
  const ops: Recorded[] = [];
  const start = (verb: Recorded["verb"]) => (...args: unknown[]) => {
    const rec: Recorded = { verb, calls: [[verb, args]] };
    ops.push(rec);
    const result = results.shift();
    const chain: unknown = new Proxy(function () {}, {
      get(_t, key) {
        if (key === "then") {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(result).then(res, rej);
        }
        return (...a: unknown[]) => {
          rec.calls.push([String(key), a]);
          return chain;
        };
      },
    });
    return chain;
  };
  const tx = { select: start("select"), insert: start("insert"), update: start("update") };
  return { tx, ops };
}

export const T = "aaaaaaaa-0001-4000-8000-000000000001";
export const NOW = new Date("2026-08-27T12:00:00.000Z");
