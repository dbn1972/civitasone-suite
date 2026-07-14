/**
 * Helm values-rendering test for the pgbouncer (Connection_Proxy) deployment
 * (task 9.3).
 *
 * Shells out to the real `helm template` binary (already used by
 * `infra/DEPLOY.md`'s documented workflow) against the on-prem chart and
 * asserts on the rendered manifest text — no YAML parser dependency is added;
 * plain string/regex checks are sufficient for the specific assertions this
 * task calls for (resource kind/name/port presence, `DATABASE_HOST` value).
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

  it("bundled-sub-chart-enabled case: pgbouncer's own upstream DATABASE_HOST targets the release's postgresql sub-chart service name by default", () => {
    // pgbouncer.databaseHost is left empty (the default) -> targets
    // "<release>-postgresql" via Helm release-name templating (Req 5.6).
    const doc = bySource.find(([src, body]) => src.includes("pgbouncer.yaml") && /kind:\s*Deployment/.test(body));
    const [, body] = doc!;
    // The Deployment's OWN upstream connection env var (distinct from the
    // shared ConfigMap's DATABASE_HOST, which every OTHER service reads).
    const envBlockMatch = body.match(/env:\n([\s\S]*?)\n\s*readinessProbe:/);
    expect(envBlockMatch).toBeDefined();
    expect(envBlockMatch![1]).toMatch(/name:\s*DATABASE_HOST\s*\n\s*value:\s*"civitasone-postgresql"/);
  });

  it("respects an explicit pgbouncer.databaseHost override instead of the bundled sub-chart default", () => {
    const overridden = helmTemplate(["--set", "pgbouncer.databaseHost=external-pg.example.internal"]);
    const overriddenBySource = splitBySource(overridden);
    const doc = overriddenBySource.find(([src, body]) => src.includes("pgbouncer.yaml") && /kind:\s*Deployment/.test(body));
    const [, body] = doc!;
    const envBlockMatch = body.match(/env:\n([\s\S]*?)\n\s*readinessProbe:/);
    expect(envBlockMatch![1]).toMatch(/name:\s*DATABASE_HOST\s*\n\s*value:\s*"external-pg\.example\.internal"/);
  });
});
