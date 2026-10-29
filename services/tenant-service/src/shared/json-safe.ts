/**
 * JSON has no bigint: JSON.stringify throws "Do not know how to serialize a BigInt", which surfaced as a 500 on
 * plan create (cache prime + queue publish) and on plan reads (reply.send). Money stays bigint minor units in the
 * DB and domain code; at every JSON boundary it is a decimal string (the consumer already does BigInt(string)).
 */
export function jsonSafe<T>(value: T): T {
  if (typeof value === "bigint") return value.toString() as unknown as T;
  if (Array.isArray(value)) return value.map(jsonSafe) as unknown as T;
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)])) as T;
  }
  return value;
}
