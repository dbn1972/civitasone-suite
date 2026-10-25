import { revalidateInventoryViews } from "./_actions";

/**
 * Await the cache purge before refresh/push. A failed purge (no request scope, offline) must
 * never block or fail the user's write, so errors are swallowed: the 15-60 s TTL is the fallback.
 */
export async function purgeInventoryCache(): Promise<void> {
  try {
    await revalidateInventoryViews();
  } catch {
    // best effort
  }
}
