// A-N2 (UAT post-b14, GIGW 3.0 "last updated"): build metadata baked into the
// web bundle by next.config.mjs. Kept in its own module so it is unit-tested
// (scripts/build-info.test.mjs) without loading the whole Next config.

function validIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The instant this build was made, as an ISO string: BUILD_TIME when the
 * pipeline pins it, else SOURCE_DATE_EPOCH (seconds, reproducible builds),
 * else the clock when next.config.mjs is evaluated (i.e. `next build`).
 */
export function buildTimeIso(env = process.env, now = new Date()) {
  const pinned = validIso(env.BUILD_TIME?.trim());
  if (pinned) return pinned;
  const epoch = env.SOURCE_DATE_EPOCH?.trim();
  if (epoch && /^\d+$/.test(epoch)) return new Date(Number(epoch) * 1000).toISOString();
  return now.toISOString();
}
