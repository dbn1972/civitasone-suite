/**
 * Global test setup for location-service.
 *
 * Ensures all non-PostGIS-dependent migrations are applied to the test database
 * before tests run. PostGIS-dependent tests (spatial, cadastral, road-network,
 * geo-points) are skipped if PostGIS is not available.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://location_svc:location_dev_pw@localhost:5435/civitas_location";

/** Migrations that require PostGIS (geom columns, spatial indexes, ST_* functions). */
const POSTGIS_MIGRATIONS = new Set([
  "0011_postgis_spatial.sql",
  "0014_land_cadastral_rls.sql",
  "0015_locations_geom_trigger.sql",
  "0016_spatial_features.sql",
  "0017_road_network.sql",
  "0019_geo_points.sql",
]);

/** Migrations already applied by system init (skip gracefully). */
const INIT_MIGRATIONS = new Set([
  "0001_init.sql",
]);

export async function setup(): Promise<void> {
  const sql = postgres(DATABASE_URL, { max: 1 });

  try {
    // Check if PostGIS is available
    const postgisAvailable = await checkPostGIS(sql);

    // Create migration tracking table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS location._applied_migrations (
        name varchar(256) PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `.catch(() => { /* table may already exist or role lacks CREATE */ });

    // List already-applied migrations
    let applied: Set<string>;
    try {
      const rows = await sql`SELECT name FROM location._applied_migrations`;
      applied = new Set(rows.map((r) => r.name as string));
    } catch {
      applied = new Set<string>();
    }

    // Read and sort migration files
    const migrationsDir = join(import.meta.dirname, "..", "migrations");
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      if (INIT_MIGRATIONS.has(file)) continue;
      if (POSTGIS_MIGRATIONS.has(file) && !postgisAvailable) continue;

      const content = await readFile(join(migrationsDir, file), "utf-8");
      try {
        await sql.unsafe(content);
        await sql`INSERT INTO location._applied_migrations (name) VALUES (${file}) ON CONFLICT DO NOTHING`.catch(() => {});
      } catch (err) {
        // Skip migrations that fail due to missing prerequisites (PostGIS, permissions, already exists)
        const msg = (err as Error).message ?? "";
        if (
          msg.includes("postgis") ||
          msg.includes("geometry") ||
          msg.includes("already exists") ||
          msg.includes("permission denied") ||
          msg.includes("does not exist")
        ) continue;
        // Non-critical migration failure — log and continue
        console.warn(`[location-service setup] migration ${file} failed: ${msg.slice(0, 120)}`);
      }
    }
  } finally {
    await sql.end();
  }
}

async function checkPostGIS(sql: postgres.Sql): Promise<boolean> {
  try {
    const rows = await sql`SELECT 1 FROM pg_extension WHERE extname = 'postgis'`;
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Exported for tests to conditionally skip PostGIS-dependent suites. */
export async function isPostGISAvailable(): Promise<boolean> {
  const sql = postgres(DATABASE_URL, { max: 1 });
  try {
    return await checkPostGIS(sql);
  } finally {
    await sql.end();
  }
}
