/**
 * docker-matrix test — the ci.yml docker-build matrix is derived from the
 * tree and cannot drift, and every entry it names resolves to a real source.
 *
 * CI: Architecture Guard job (.github/workflows/ci.yml arch-guard)
 *     runs: pnpm exec vitest run tests/ops/docker-matrix.test.ts
 *
 * WHAT IT LOCKS (defect ST-M01-01 / D-ST-22)
 * ------------------------------------------
 * The docker-build job used to carry a hand-written list of 33 services and
 * build each with `file: services/<svc>/Dockerfile` — a path that exists for
 * NO service (confirmed: `find services -name Dockerfile` → 0), so all 33
 * jobs failed on every push to main, and 33 of the ~66 buildable services
 * were never listed. The job now derives its matrix from
 * scripts/ci/docker-matrix.mjs and builds every service from the single
 * parametrised root Dockerfile. These tests fail if the two ever diverge:
 *   - the matrix must equal exactly the set of buildable services;
 *   - every matrix entry must point at a src file that compiles to that
 *     dist entry (dist/index.js ← src/index.ts, dist/server.js ← src/server.ts);
 *   - ci.yml must consume the derived matrix (no reintroduced hand list, no
 *     per-service Dockerfile path, root Dockerfile only).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildableServices,
  buildMatrix,
  pm2AppName,
} from "../../scripts/ci/docker-matrix.mjs";

const ROOT = resolve(__dirname, "../..");
const SERVICES = join(ROOT, "services");
const CI_YML = join(ROOT, ".github", "workflows", "ci.yml");

/** services/* dirs with a package.json that has a build script — the ground truth. */
function groundTruthBuildable(): string[] {
  return readdirSync(SERVICES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => {
      const pkgPath = join(SERVICES, name, "package.json");
      if (!existsSync(pkgPath)) return false;
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

/** dist/foo.js → src/foo.ts (the entry's compiled-from source). */
function srcForEntry(service: string, entry: string): string | null {
  const m = entry.match(/^dist\/(.+)\.js$/);
  if (!m) return null;
  return join(SERVICES, service, "src", `${m[1]}.ts`);
}

describe("docker-build matrix is derived from the tree", () => {
  it("covers at least the whole fleet (sanity: a real repo, not a broken scan)", () => {
    const svcs = groundTruthBuildable();
    // The repo has ~66 buildable services; a count far below that means the
    // discovery broke and the matrix would silently shrink.
    expect(svcs.length).toBeGreaterThanOrEqual(60);
  });

  it("equals exactly the set of buildable services — no omissions, no extras", async () => {
    const matrix = await buildMatrix();
    const matrixServices = matrix.map((r) => r.service).sort();
    expect(matrixServices).toEqual(groundTruthBuildable());
    // No duplicate rows (workers share the image → one row per service).
    expect(new Set(matrixServices).size).toBe(matrixServices.length);
  });

  it("the generator's own buildable list matches the ground truth", () => {
    expect(buildableServices()).toEqual(groundTruthBuildable());
  });
});

describe("every matrix entry resolves to a real source entrypoint", () => {
  it("each ENTRY (dist/*.js) has a matching src/*.ts in that service", async () => {
    const matrix = await buildMatrix();
    const missing: string[] = [];
    for (const row of matrix) {
      const src = srcForEntry(row.service, row.entry);
      if (src === null) {
        missing.push(
          `${row.service}: entry "${row.entry}" is not of the form dist/<name>.js`,
        );
        continue;
      }
      if (!existsSync(src)) {
        missing.push(
          `${row.service}: entry "${row.entry}" → missing source ${src.replace(ROOT + "/", "")}`,
        );
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("queue-service is the HTTP entrypoint (dist/server.js), not the library index", async () => {
    // Regression lock: queue-service/src/index.ts is a library barrel; its
    // HTTP server is src/server.ts. Building it with the default dist/index.js
    // would ship an image that binds no port.
    const matrix = await buildMatrix();
    const queue = matrix.find((r) => r.service === "queue-service");
    expect(queue?.entry).toBe("dist/server.js");
  });

  it("every PORT is a positive integer", async () => {
    const matrix = await buildMatrix();
    for (const row of matrix) {
      expect(
        Number.isInteger(row.port),
        `${row.service} port ${row.port}`,
      ).toBe(true);
      expect(row.port).toBeGreaterThan(0);
    }
  });

  it("entry/port agree with ecosystem.config.js for a known sample", async () => {
    const matrix = await buildMatrix();
    const expectations: Record<string, { entry: string; port: number }> = {
      "gateway-service": { entry: "dist/index.js", port: 8080 },
      "queue-service": { entry: "dist/server.js", port: 3030 },
      "hrms-service": { entry: "dist/index.js", port: 3012 },
      "identity-service": { entry: "dist/index.js", port: 3001 },
      "location-service": { entry: "dist/index.js", port: 4012 },
    };
    for (const [svc, want] of Object.entries(expectations)) {
      const row = matrix.find((r) => r.service === svc);
      expect(row, `${svc} missing from matrix`).toBeDefined();
      expect(row).toMatchObject(want);
    }
  });

  it("pm2AppName strips the -service suffix", () => {
    expect(pm2AppName("identity-service")).toBe("identity");
    expect(pm2AppName("queue-service")).toBe("queue");
  });
});

describe("ci.yml consumes the derived matrix, not a hand-written list", () => {
  const ci = readFileSync(CI_YML, "utf8");

  it("docker-build builds from the root Dockerfile, never services/<svc>/Dockerfile", () => {
    expect(ci).not.toMatch(
      /file:\s*services\/\$\{\{\s*matrix\.service\s*\}\}\/Dockerfile/,
    );
    expect(ci).toMatch(/\n\s+file:\s*Dockerfile\s*\n/);
  });

  it("docker-build's matrix comes from fromJSON(needs.docker-matrix.outputs.matrix)", () => {
    expect(ci).toMatch(
      /matrix:\s*\$\{\{\s*fromJSON\(needs\.docker-matrix\.outputs\.matrix\)\s*\}\}/,
    );
  });

  it("passes SERVICE / ENTRY / PORT build-args from the matrix", () => {
    expect(ci).toMatch(/SERVICE=\$\{\{\s*matrix\.service\s*\}\}/);
    expect(ci).toMatch(/ENTRY=\$\{\{\s*matrix\.entry\s*\}\}/);
    expect(ci).toMatch(/PORT=\$\{\{\s*matrix\.port\s*\}\}/);
  });

  it("the docker-matrix setup job runs scripts/ci/docker-matrix.mjs", () => {
    expect(ci).toMatch(/node scripts\/ci\/docker-matrix\.mjs --compact/);
  });

  it("keeps the push-to-main trigger and GHCR tags unchanged", () => {
    expect(ci).toMatch(
      /if:\s*github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/,
    );
    expect(ci).toMatch(
      /ghcr\.io\/\$\{\{\s*github\.repository\s*\}\}\/\$\{\{\s*matrix\.service\s*\}\}:latest/,
    );
  });
});
