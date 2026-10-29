/**
 * Bounded Redis connect for gateway boot (UAT FQ9: boot-order hang).
 *
 * After a host reboot the gateway started before Redis (127.0.0.1:6381) and never served: buildApp()
 * awaited `redis.connect()` for the rate-limit store and the quota store before `app.listen()`, and
 * neither await was bounded, so a Redis that was not up yet held the process before listen. This
 * helper waits at most `timeoutMs` for the first connect and never throws; callers decide what to do
 * when it is not ready (rate-limit: in-process store; quota: in-memory until Redis becomes ready).
 */
export const REDIS_CONNECT_TIMEOUT_MS = Math.max(
  250,
  Number(process.env.GATEWAY_REDIS_CONNECT_TIMEOUT_MS ?? 5_000) || 5_000,
);

/** Exponential reconnect backoff, capped at 10s; never gives up (Redis may simply start later). */
export function redisRetryStrategy(attempt: number): number {
  return Math.min(250 * 2 ** Math.min(attempt, 6), 10_000);
}

/**
 * Resolve true once `client.connect()` succeeds, false on failure or after `timeoutMs`.
 * The connect attempt is NOT cancelled on timeout — ioredis keeps reconnecting in the background.
 */
export async function connectWithin(
  client: { connect(): Promise<unknown> },
  timeoutMs: number = REDIS_CONNECT_TIMEOUT_MS,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref?.();
  });
  const connected = client.connect().then(() => true, () => false);
  try {
    return await Promise.race([connected, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
