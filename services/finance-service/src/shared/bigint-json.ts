// Serialize BigInt as a string in JSON responses.
//
// Drizzle `bigint("...", { mode: "bigint" })` columns (e.g. recon break
// `deltaMinor`, opening-balance `debitMinor`/`creditMinor`) reach `reply.send()`
// as native JS BigInt values. Node's JSON.stringify throws
// "Do not know how to serialize a BigInt" on those, turning the route into a 500.
// Emitting them as strings matches the `*Minor` string convention the other
// finance routes already use and is accepted by the web app's formatMoney().
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function (): string {
  return this.toString();
};
