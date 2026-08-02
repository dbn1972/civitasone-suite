// Serialize BigInt as a string in JSON responses.
//
// Drizzle `bigint("...", { mode: "bigint" })` columns (e.g. bills
// `grossAmountMinor`/`netPayableMinor`, boq `amountMinor`/`rate`, tender
// `tenderAmountMinor`, approvals `approvedAmountMinor`/`tsAmountMinor`) reach
// `reply.send()` as native JS BigInt values. Node's JSON.stringify throws
// "Do not know how to serialize a BigInt" on those, turning the route into a 500.
// Emitting them as strings matches the `*Minor` string convention the web app's
// formatMoney() already expects.
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function (): string {
  return this.toString();
};
