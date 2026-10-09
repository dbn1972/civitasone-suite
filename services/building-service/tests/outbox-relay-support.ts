import { relayOnce } from "@civitasone/outbox";

/**
 * relayOnce() claims the oldest <=batch unpublished rows of the whole service
 * outbox, across every tenant. Other test files in this package leave
 * unpublished rows behind (different tenants, never relayed), so in CI a
 * single relayOnce(.., 100) could be filled with those older rows and never
 * reach the row the integration test just enqueued ("must have an unpublished
 * ... row to relay" / no delivery or GL journal). Drain until empty instead.
 */
export async function relayAll(db: never, queue: never, service: string): Promise<number> {
  let total = 0;
  for (let i = 0; i < 50; i++) {
    const n = await relayOnce(db, queue, 100, service);
    if (n === 0) break;
    total += n;
  }
  return total;
}
