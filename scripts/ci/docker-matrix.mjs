#!/usr/bin/env node
/**
 * docker-matrix.mjs — derive the ci.yml `docker-build` matrix from the tree.
 *
 * WHY THIS EXISTS (the defect it fixes)
 * -------------------------------------
 * The `docker-build` job used to carry a hand-written list of 33 service
 * names and build each with `file: services/<svc>/Dockerfile`. No service
 * has ever had its own Dockerfile (`find services -name Dockerfile` → 0),
 * so every one of those 33 jobs failed on every push to main with
 * `open services/<svc>/Dockerfile: no such file or directory`, and 33 of
 * the ~66 buildable services were never listed at all. The repo ships a
 * single parametrised root `Dockerfile` (see its header) that builds any
 * service via `--build-arg SERVICE/ENTRY/PORT`.
 *
 * This script emits the matrix as JSON so it is derived from the tree and
 * cannot drift: a new service under services/ with a build script is picked
 * up automatically, and its entry/port come from the one authoritative
 * declaration of how it runs (ecosystem.config.js), with the same defaults
 * the root Dockerfile itself uses.
 *
 * A "buildable service" is any directory under services/ whose package.json
 * declares a `build` script. Workers share the service image (same build,
 * different entry at deploy time), so the image is per service, not per
 * worker — exactly one matrix row per buildable service.
 *
 * ENTRY / PORT derivation
 * -----------------------
 * The PM2 app name for a service is its directory name without the
 * `-service` suffix (identity-service → "identity"). ecosystem.config.js is
 * the authoritative, already-tested declaration of each service's runtime
 * entry (`script`) and `PORT`. We read them from there:
 *   - entry: the app's `script` (e.g. dist/index.js, or dist/server.js for
 *     queue-service, whose src/index.ts is a library and src/server.ts is
 *     the HTTP entrypoint).
 *   - port:  the app's env.PORT.
 * Defaults (dist/index.js, 3000) match the root Dockerfile's own ARG
 * defaults, so a service with no explicit declaration still builds correctly.
 *
 * Usage:
 *   node scripts/ci/docker-matrix.mjs            # pretty JSON to stdout
 *   node scripts/ci/docker-matrix.mjs --compact  # single-line JSON (CI)
 *
 * The CI setup job consumes the compact form via
 *   echo "matrix=$(node scripts/ci/docker-matrix.mjs --compact)" >> "$GITHUB_OUTPUT"
 * and the docker-build job expands it with fromJSON(...).
 *
 * Exit: 0 on success; 1 if the tree looks broken (zero buildable services,
 * or a service with no derivable entry/port) so a silently-empty matrix can
 * never pass.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SERVICES_ROOT = join(REPO_ROOT, "services");
const ECOSYSTEM = join(REPO_ROOT, "ecosystem.config.js");

// The root Dockerfile's ARG defaults — keep in sync with Dockerfile.
const DEFAULT_ENTRY = "dist/index.js";
const DEFAULT_PORT = 3000;

/**
 * Buildable services: a directory under services/ with a package.json that
 * declares a `build` script.
 */
export function buildableServices(servicesRoot = SERVICES_ROOT) {
  if (existsSync(servicesRoot) === false) return [];
  return readdirSync(servicesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => {
      const pkgPath = join(servicesRoot, name, "package.json");
      if (existsSync(pkgPath) === false) return false;
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        return (
          typeof pkg.scripts?.build === "string" && pkg.scripts.build.length > 0
        );
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * Load ecosystem.config.js and index its non-worker apps by PM2 name.
 *
 * ecosystem.config.js refuses to evaluate unless NODE_ENV is exactly
 * "development" or "test" (otherwise it treats itself as production and
 * throws for every required secret). We only ever read each app's `script`
 * and `env.PORT`, never any secret, so force NODE_ENV to "development" for
 * the duration of the import and restore it afterwards.
 */
export async function ecosystemAppsByName(ecosystemPath = ECOSYSTEM) {
  const DEV_ENVS = new Set(["development", "test"]);
  const prevNodeEnv = process.env.NODE_ENV;
  const mustOverride = DEV_ENVS.has(prevNodeEnv ?? "") === false;
  if (mustOverride) process.env.NODE_ENV = "development";
  try {
    const mod = await import(pathToFileURL(ecosystemPath).href);
    const eco = mod.default ?? mod;
    const apps = Array.isArray(eco.apps) ? eco.apps : [];
    const byName = new Map();
    for (const app of apps) {
      if (typeof app?.name !== "string") continue;
      byName.set(app.name, {
        script: typeof app.script === "string" ? app.script : undefined,
        port:
          app.env && app.env.PORT != null ? Number(app.env.PORT) : undefined,
      });
    }
    return byName;
  } finally {
    if (mustOverride) {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    }
  }
}

/** PM2 app name for a service directory: drop the trailing `-service`. */
export function pm2AppName(service) {
  return service.replace(/-service$/, "");
}

/**
 * Build the matrix: one { service, entry, port } row per buildable service.
 * entry/port come from ecosystem.config.js, falling back to the root
 * Dockerfile's ARG defaults.
 */
export async function buildMatrix(opts = {}) {
  const servicesRoot = opts.servicesRoot ?? SERVICES_ROOT;
  const byName =
    opts.appsByName ?? (await ecosystemAppsByName(opts.ecosystemPath));
  const services = opts.services ?? buildableServices(servicesRoot);
  return services.map((service) => {
    const app = byName.get(pm2AppName(service));
    return {
      service,
      entry: app?.script ?? DEFAULT_ENTRY,
      port: app?.port ?? DEFAULT_PORT,
    };
  });
}

async function main() {
  const compact = process.argv.includes("--compact");
  const matrix = await buildMatrix();

  // A silently-empty matrix must never pass as a success.
  if (matrix.length === 0) {
    console.error(
      "docker-matrix: no buildable services found under services/ — the matrix would be empty",
    );
    process.exit(1);
  }
  const broken = matrix.filter(
    (row) =>
      typeof row.entry !== "string" ||
      row.entry.length === 0 ||
      Number.isFinite(row.port) === false,
  );
  if (broken.length > 0) {
    console.error(
      `docker-matrix: ${broken.length} service(s) have no derivable entry/port: ` +
        broken.map((r) => r.service).join(", "),
    );
    process.exit(1);
  }

  const payload = { include: matrix };
  process.stdout.write(
    compact ? JSON.stringify(payload) : `${JSON.stringify(payload, null, 2)}\n`,
  );
}

// Only run main() when executed directly, not when imported by the test.
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
