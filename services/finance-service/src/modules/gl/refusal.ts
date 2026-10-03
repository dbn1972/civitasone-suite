/**
 * Which errors thrown while posting a journal are DETERMINISTIC REFUSALS -- retrying cannot change the answer until
 * somebody fixes the chart or the period -- as opposed to transient failures (database down, a lost budget race) that
 * must keep their retry behaviour. A refusal is reported to the producer as `finance.gl.rejected` carrying its code, so a
 * record that depends on the journal (asset-service) can show "not posted, and why" instead of waiting forever.
 */
const REFUSAL_CODE = /^(UNKNOWN_ACCOUNT_CODE|PERIOD_[A-Z_]+|NOT_LEAF_ACCOUNT|CONTROL_ACCOUNT|JOURNAL_[A-Z_]+|ORG_[A-Z_]+)$/;

export function refusalCode(err: unknown): string | null {
  if (err === null || typeof err !== "object") return null;
  if ((err as { name?: unknown }).name === "UnknownAccountCodeError") return "UNKNOWN_ACCOUNT_CODE";
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && REFUSAL_CODE.test(code)) return code;
  const message = (err as { message?: unknown }).message;
  if (typeof message === "string") {
    const m = /^\[?([A-Z][A-Z_]+)\]?[:\s]/.exec(message);
    if (m && REFUSAL_CODE.test(m[1] as string)) return m[1] as string;
  }
  return null;
}
