// Serialize BigInt as a string in JSON responses.
//
// Drizzle `bigint("...", { mode: "bigint" })` columns (authority_limits
// `maxAmount`, migration 0032_money_bigint_paise.sql) reach `reply.send()` as
// native JS BigInt values. Node's JSON.stringify throws "Do not know how to
// serialize a BigInt" on those, turning the route into a 500. Emitting them as
// strings matches the `*Minor`/money string convention the web app already
// expects (see @civitasone/schemas zMoneyMinorString). Mirrors works-service /
// revenue-service / finance-service shared/bigint-json.ts.
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function (): string {
  return this.toString();
};
