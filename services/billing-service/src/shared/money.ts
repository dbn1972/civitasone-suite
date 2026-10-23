/**
 * JSON serialisation of bigint money for billing-service gateway adapters.
 * (Major-unit formatting lives in @civitasone/schemas/money: minorToMajorString /
 * minorToMajorNumber.)
 */

/**
 * JSON.stringify that emits every bigint as an exact bare integer literal.
 * Payment-gateway JSON APIs take `amount` as an integer; JSON.stringify cannot
 * encode a bigint and a float coercion would lose precision above 2^53.
 *
 * Each bigint is first replaced by a per-call, unguessable marker string and the
 * marker (with its quotes) is then replaced by the bare digits, so a caller-supplied
 * string can never be mistaken for a marker.
 */
export function stringifyWithBigInt(value: unknown): string {
  const nonce = globalThis.crypto.randomUUID();
  const prefix = `__BIGINT_${nonce}_`;
  const markerRe = new RegExp(`"${prefix}(-?\\d+)__"`, "g");
  const json = JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "bigint" ? `${prefix}${v.toString()}__` : v,
  );
  return json.replace(markerRe, "$1");
}
