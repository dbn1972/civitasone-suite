/**
 * tick() scans ALL tenants, so two e-Courts DB tests running in parallel files
 * would see each other's tracked matters. Serialise them with a session-level
 * Postgres advisory lock held on a dedicated connection for the file's duration.
 */
import postgres from "postgres";

const KEY = 5150707;

export async function acquireEcourtsDbLock(): Promise<() => Promise<void>> {
  const client = postgres(process.env["DATABASE_URL"]!, { max: 1 });
  await client`select pg_advisory_lock(${KEY})`;
  return async () => {
    await client`select pg_advisory_unlock(${KEY})`;
    await client.end();
  };
}
