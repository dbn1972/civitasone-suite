/**
 * Helm values-rendering test for the pgbouncer (Connection_Proxy) deployment
 * (task 9.3).
 *
 * Shells out to the real `helm template` binary (already used by
 * `infra/DEPLOY.md`'s documented workflow) against the on-prem chart and
 * asserts on the rendered manifest text — no YAML parser dependency is added;
 * plain string/regex checks are sufficient for the specific assertions this
 * task calls for (resource kind/name/port presence, env var names/values).
 *
 * Release name fixed at "civitasone" (matching `infra/DEPLOY.md`'s documented
 * install name): `values.yaml`'s shared `config.DATABASE_HOST` /
 * `REDIS_URL` / `KEYCLOAK_URL` are hardcoded literals (`"civitasone-pgbouncer"`,
 * `"civitasone-redis"`, `"civitasone-keycloak"`) rather than templated via
 * `{{ .Release.Name }}` — a pre-existing, chart-wide convention this test
 * exercises as-is rather than papering over. Deploying under any OTHER
 * release name would point every service's `DATABASE_HOST` at a
 * non-existent Service; that is a real, separate defect worth flagging to
 * the chart's maintainers, out of scope for this test-writing task to fix.
 *
 * PERF-012: the pgbouncer CONTAINER's own upstream-connection env vars are a
 * separate namespace from the app-facing `DATABASE_HOST`/`DATABASE_PORT`/
 * `DATABASE_USER`/`DATABASE_PASSWORD` names every OTHER service reads from
 * the shared ConfigMap/Secret (asserted below, and unchanged by that fix).
 * The `edoburu/pgbouncer` image's entrypoint only recognizes `DB_HOST`/
 * `DB_PORT`/`DB_USER`/`DB_PASSWORD` (or `DATABASE_URL`) — a prior version of
 * this chart set `DATABASE_HOST`/`DATABASE_PORT`/`DATABASE_USER`/
 * `DATABASE_PASSWORD` on the container itself too, which the entrypoint does
 * not recognize at all, so `DB_HOST` stayed unset and the container failed
 * its own `${DB_HOST:?...}` startup check — see
 * docs/architecture/CONNECTION-BUDGET.md §7 (PERF-012). The tests below
 * assert the container's OWN env block by the image's real names
 * (`DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`) and explicitly assert the
 * old, wrong names are gone from that block, so a regression back to
 * `DATABASE_*` fails loudly instead of silently passing — which is exactly
 * how PERF-012 slipped through originally: this file asserted the wrong
 * names as if they were correct.
 *
 * Validates: Requirements 5.2, 5.6
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";

const CHART_DIR = "infra/onprem/helm/civitasone";
const RELEASE_NAME = "civitasone";

function helmTemplate(extraArgs: string[] = []): string {
  return execFileSync(
    "helm",
    ["template", RELEASE_NAME, CHART_DIR, ...extraArgs],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
}

/**
 * Split a `helm template` multi-document stream into individual manifests,
 * paired with their `# Source:` comment. A single template file (e.g.
 * `pgbouncer.yaml`) commonly renders MULTIPLE `---`-separated documents
 * (Deployment + Service), so this returns an array of pairs rather than a
 * Map — a Map keyed by source path would silently drop all but the last
 * document per source file.
 */
function splitBySource(rendered: string): Array<[string, string]> {
  const docs = rendered.split(/^---$/m);
  const pairs: Array<[string, string]> = [];
  for (const doc of docs) {
    const match = doc.match(/^# Source: (\S+)/m);
    if (match) pairs.push([match[1]!, doc]);
  }
  return pairs;
}

describe("Helm chart: pgbouncer (Connection_Proxy) deployment renders correctly (task 9.3)", () => {
  let rendered: string;
  let bySource: Array<[string, string]>;

  beforeAll(() => {
    rendered = helmTemplate();
    bySource = splitBySource(rendered);
  }, 30_000);

  it("renders a pgbouncer Deployment listening on containerPort 6432", () => {
    const doc = bySource.find(([src, body]) => src.includes("pgbouncer.yaml") && /kind:\s*Deployment/.test(body));
    expect(doc).toBeDefined();
    const [, body] = doc!;
    expect(body).toMatch(/name:\s*civitasone-pgbouncer/);
    expect(body).toMatch(/containerPort:\s*6432/);
  });

  it("pins the pgbouncer image to a real, published edoburu/pgbouncer tag (PERF-012)", () => {
    // "edoburu/pgbouncer:1.21.0" (bare, no "-pN" suffix) does not exist on
    // Docker Hub -- confirmed live against the registry during PERF-012 --
    // so `helm install`/`kubectl` could never even pull the image
    // (ImagePullBackOff), independent of the env var bug this file's other
    // tests guard. Pinned to the same tag infra/docker-compose.yml's
    // already-fixed, currently-running pgbouncer uses (PERF-001), so both
    // deployment paths run identical, known-good proxy behavior.
    const doc = bySource.find(([src, body]) => src.includes("pgbouncer.yaml") && /kind:\s*Deployment/.test(body));
    const [, body] = doc!;
    expect(body).toMatch(/image:\s*"edoburu\/pgbouncer:v1\.23\.1-p2"/);
    expect(body).not.toMatch(/image:\s*"edoburu\/pgbouncer:1\.21\.0"/);
  });

  it("renders a pgbouncer Service exposing port 6432", () => {
    const doc = bySource.find(([src, body]) => src.includes("pgbouncer.yaml") && /kind:\s*Service/.test(body));
    expect(doc).toBeDefined();
    const [, body] = doc!;
    expect(body).toMatch(/name:\s*civitasone-pgbouncer/);
    expect(body).toMatch(/port:\s*6432/);
    expect(body).toMatch(/targetPort:\s*pgbouncer/);
  });

  it("every service's DATABASE_HOST/PORT (shared ConfigMap) points at the pgbouncer Service, not raw Postgres", () => {
    const configMapDoc = bySource.find(([src]) => src.includes("configmap.yaml"));
    expect(configMapDoc).toBeDefined();
    const [, body] = configMapDoc!;
    expect(body).toMatch(/DATABASE_HOST:\s*"civitasone-pgbouncer"/);
    expect(body).toMatch(/DATABASE_PORT:\s*"6432"/);
    expect(body).toMatch(/DB_VIA_PGBOUNCER:\s*"true"/);
  });

  it("does not render the pgbouncer Deployment/Service when pgbouncer.enabled=false", () => {
    const disabled = helmTemplate(["--set", "pgbouncer.enabled=false"]);
    expect(disabled).not.toMatch(/name:\s*civitasone-pgbouncer/);
  });

  it("bundled-sub-chart-enabled case: pgbouncer's own upstream DB_HOST targets the release's postgresql sub-chart service name by default", () => {
    // pgbouncer.databaseHost is left empty (the default) -> targets
    // "<release>-postgresql" via Helm release-name templating (Req 5.6).
    const doc = bySource.find(([src, body]) => src.includes("pgbouncer.yaml") && /kind:\s*Deployment/.test(body));
    const [, body] = doc!;
    // The Deployment's OWN upstream connection env var (distinct from the
    // shared ConfigMap's DATABASE_HOST, which every OTHER service reads).
    // Named DB_HOST, not DATABASE_HOST -- that is the actual edoburu/pgbouncer
    // image contract (PERF-012); see the file header comment.
    const envBlockMatch = body.match(/env:\n([\s\S]*?)\n\s*readinessProbe:/);
    expect(envBlockMatch).toBeDefined();
    expect(envBlockMatch![1]).toMatch(/name:\s*DB_HOST\s*\n\s*value:\s*"civitasone-postgresql"/);
  });

  it("respects an explicit pgbouncer.databaseHost override instead of the bundled sub-chart default", () => {
    const overridden = helmTemplate(["--set", "pgbouncer.databaseHost=external-pg.example.internal"]);
    const overriddenBySource = splitBySource(overridden);
    const doc = overriddenBySource.find(([src, body]) => src.includes("pgbouncer.yaml") && /kind:\s*Deployment/.test(body));
    const [, body] = doc!;
    const envBlockMatch = body.match(/env:\n([\s\S]*?)\n\s*readinessProbe:/);
    expect(envBlockMatch![1]).toMatch(/name:\s*DB_HOST\s*\n\s*value:\s*"external-pg\.example\.internal"/);
  });

  it("pgbouncer container's DB connection env vars use the edoburu/pgbouncer image's real contract (DB_*), sourced from the same shared-role ConfigMap/Secret keys every other service uses", () => {
    const doc = bySource.find(([src, body]) => src.includes("pgbouncer.yaml") && /kind:\s*Deployment/.test(body));
    const [, body] = doc!;
    const envBlockMatch = body.match(/env:\n([\s\S]*?)\n\s*readinessProbe:/);
    expect(envBlockMatch).toBeDefined();
    const envBlock = envBlockMatch![1]!;

    // Correct image-recognized names, each still wired to the chart's single
    // shared `civitasone` role (the same ConfigMap/Secret keys the app-facing
    // DATABASE_USER/DATABASE_PASSWORD env vars use elsewhere -- only the
    // container's own env var *name* changes, not where the value comes from).
    expect(envBlock).toMatch(/name:\s*DB_HOST\s*\n\s*value:\s*"civitasone-postgresql"/);
    expect(envBlock).toMatch(/name:\s*DB_PORT\s*\n\s*value:\s*"5432"/);
    expect(envBlock).toMatch(
      /name:\s*DB_USER\s*\n\s*valueFrom:\s*\n\s*configMapKeyRef:\s*\n\s*name:\s*\S+\s*\n\s*key:\s*DATABASE_USER/,
    );
    expect(envBlock).toMatch(
      /name:\s*DB_PASSWORD\s*\n\s*valueFrom:\s*\n\s*secretKeyRef:\s*\n\s*name:\s*\S+\s*\n\s*key:\s*DATABASE_PASSWORD/,
    );

    // DB_NAME is deliberately left unset (not asserted present) so the
    // entrypoint defaults it to the wildcard `*` database entry -- this
    // single shared role must reach every per-service database name
    // (civitas_identity, civitas_hrms, ...), and an explicit DB_NAME would
    // only route the one database it names (same failure mode as PERF-001's
    // docker-compose bug 3a, CONNECTION-BUDGET.md §3a).
    expect(envBlock).not.toMatch(/name:\s*DB_NAME\b/);

    // The actual PERF-012 bug: these env var *names* must never come back.
    // (Note this checks the env-var `name:` field specifically, not the
    // ConfigMap/Secret `key:` fields above, which correctly still say
    // DATABASE_USER/DATABASE_PASSWORD -- that's the data source, not the
    // container's env var name.)
    expect(envBlock).not.toMatch(/name:\s*DATABASE_HOST\b/);
    expect(envBlock).not.toMatch(/name:\s*DATABASE_PORT\b/);
    expect(envBlock).not.toMatch(/name:\s*DATABASE_USER\b/);
    expect(envBlock).not.toMatch(/name:\s*DATABASE_PASSWORD\b/);
  });

  it("AUTH_TYPE is scram-sha-256, not md5 (PERF-012)", () => {
    // "md5" cannot authenticate to a Postgres whose pg_hba.conf requires
    // scram-sha-256 (Postgres 14+'s own modern default, including the
    // bundled `postgresql` sub-chart -- confirmed live: the server-side
    // login fails with "wrong password type" even with the env var names
    // otherwise correct). Verified end-to-end against a real scram-sha-256
    // Postgres that "scram-sha-256" (no AUTH_USER/AUTH_QUERY needed for this
    // chart's single shared role) fixes it -- see PR description.
    const doc = bySource.find(([src, body]) => src.includes("pgbouncer.yaml") && /kind:\s*Deployment/.test(body));
    const [, body] = doc!;
    const envBlockMatch = body.match(/env:\n([\s\S]*?)\n\s*readinessProbe:/);
    const envBlock = envBlockMatch![1]!;
    expect(envBlock).toMatch(/name:\s*AUTH_TYPE\s*\n\s*value:\s*"scram-sha-256"/);
    expect(envBlock).not.toMatch(/name:\s*AUTH_TYPE\s*\n\s*value:\s*"md5"/);
  });

  it("LISTEN_PORT is set to 6432, matching containerPort/Service/probes (PERF-012)", () => {
    // edoburu/pgbouncer's entrypoint defaults its actual listening socket to
    // 5432 unless LISTEN_PORT overrides it -- confirmed live, a container
    // booted with this chart's exact rendered env (pre-fix) only accepted
    // connections on 5432, while containerPort/Service targetPort/both
    // probes above all declare 6432, so the pod's liveness probe would fail
    // forever and the Service would never route to it in a real cluster.
    const doc = bySource.find(([src, body]) => src.includes("pgbouncer.yaml") && /kind:\s*Deployment/.test(body));
    const [, body] = doc!;
    const envBlockMatch = body.match(/env:\n([\s\S]*?)\n\s*readinessProbe:/);
    const envBlock = envBlockMatch![1]!;
    expect(envBlock).toMatch(/name:\s*LISTEN_PORT\s*\n\s*value:\s*"6432"/);
  });
});
