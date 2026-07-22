// scripts/governance/reconcile-services.ts
//
// Service/Port Reconciler — see design.md's
// "3. Service/Port Reconciler (scripts/governance/reconcile-services.ts)"
// component.
//
// This file implements tasks 6.1 (listServiceRegistry, discoverPort) and 6.2
// (reconcileServiceList, reconcilePortMap). All four functions are pure with
// respect to their inputs — the only I/O is the deliberate, isolated file
// reads inside `discoverPort` (reading a service's own `src/index.ts` /
// `src/app.ts` and the repo's `infra/docker-compose.yml`); the reconciliation
// functions themselves take already-collected data and a `discover` callback,
// which is what makes them property-testable (design Properties 6 and 7).

import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const SERVICE_DIR_SUFFIX = "-service";

/**
 * The outcome of searching for a service's port across the 4-source fallback
 * chain described in design.md: `src/index.ts` -> `src/app.ts` ->
 * `infra/docker-compose.yml` -> the gateway registry
 * (`services/gateway-service/src/registry.ts`).
 *
 * `port: null` / `discoveredFrom: null` means none of the four sources
 * yielded a port — this is the `metadata-service` case (no HTTP entrypoint,
 * no docker-compose entry, no gateway registry entry).
 */
export interface PortDiscoveryResult {
  service: string;
  port: number | null;
  discoveredFrom: "index.ts" | "app.ts" | "docker-compose.yml" | "gateway-registry.ts" | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// listServiceRegistry() — task 6.1
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads `services/*\/` directory names and strips the `-service` suffix,
 * returning the Service_Registry as a sorted list of short names (e.g.
 * `"meeting-service"` -> `"meeting"`).
 *
 * Only directories whose name ends in `-service` are considered — this
 * excludes any non-service tooling/config directories that might live
 * alongside the services (there are none today, but the filter keeps the
 * function honest about what it's listing rather than assuming every entry
 * under `services/` is itself a service).
 *
 * Sorted alphabetically for determinism: `readdirSync` order is not
 * guaranteed to be stable across platforms/filesystems, and reconciliation
 * output (Governance_Report, `added` lists) should not depend on directory
 * traversal order.
 */
export function listServiceRegistry(servicesDir: string): string[] {
  const entries = readdirSync(servicesDir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(SERVICE_DIR_SUFFIX))
    .map((entry) => entry.name.slice(0, -SERVICE_DIR_SUFFIX.length));
  return names.sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// discoverPort() — task 6.1
// ─────────────────────────────────────────────────────────────────────────────

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// Matches the `process.env.PORT ?? <default>` pattern used by every real
// service entrypoint (`src/index.ts`, or `src/app.ts` if a service binds
// there instead).
const PORT_ENV_DEFAULT_RE = /PORT\s*\?\?\s*(\d+)/;

function matchPortEnvDefault(source: string): number | null {
  const match = PORT_ENV_DEFAULT_RE.exec(source);
  if (match === null || match[1] === undefined) return null;
  return Number(match[1]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches `upstream("<serviceName>", <port>)` in the gateway registry
 * source (`services/gateway-service/src/registry.ts`), e.g.
 * `upstream("meeting", 3033)`. The registry may define multiple route
 * entries that resolve to the same service (e.g. `"project"` and
 * `"projects"` both call `upstream("project", 3014)`); matching on the exact
 * quoted service name (not a route/prefix name) is what the design's
 * `upstream("<service>", <port>)` pattern targets, and the first occurrence
 * is authoritative since the registry never assigns two different ports to
 * the same service name.
 */
function matchGatewayRegistryPort(source: string, serviceName: string): number | null {
  const re = new RegExp(`upstream\\(\\s*["']${escapeRegExp(serviceName)}["']\\s*,\\s*(\\d+)\\s*\\)`);
  const match = re.exec(source);
  if (match === null || match[1] === undefined) return null;
  return Number(match[1]);
}

/**
 * Looks for a service's container block in `infra/docker-compose.yml`
 * (a top-level, 2-space-indented key under `services:` named `<serviceName>`
 * or `<serviceName>-service`) and, within that block, a `PORT` env var or a
 * published host port mapping (`"<port>:<containerPort>"`).
 *
 * None of the 5 newly-added services (`court`, `meeting`, `metadata`, `ml`,
 * `visitor`) currently have an entry in `docker-compose.yml` (verified by
 * reading the file), so this always returns `null` for them today — this
 * source exists in the fallback chain for services that *do* define their
 * port there instead of via `process.env.PORT ?? <default>`.
 */
function matchDockerComposePort(source: string, serviceName: string): number | null {
  const lines = source.split(/\r?\n/);
  const blockNameRe = new RegExp(`^\\s{2}(${escapeRegExp(serviceName)}(-service)?):\\s*$`);

  let blockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (blockNameRe.test(lines[i] ?? "")) {
      blockStart = i;
      break;
    }
  }
  if (blockStart === -1) return null;

  // The block runs until the next 2-space-indented key (the next service),
  // or EOF.
  let blockEnd = lines.length;
  for (let i = blockStart + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s{2}\S/.test(line)) {
      blockEnd = i;
      break;
    }
  }

  const blockText = lines.slice(blockStart, blockEnd).join("\n");

  const envPortMatch = /PORT[:=]\s*["']?(\d+)/.exec(blockText);
  if (envPortMatch !== null && envPortMatch[1] !== undefined) {
    return Number(envPortMatch[1]);
  }

  const publishedPortMatch = /["'](\d+):\d+["']/.exec(blockText);
  if (publishedPortMatch !== null && publishedPortMatch[1] !== undefined) {
    return Number(publishedPortMatch[1]);
  }

  return null;
}

/**
 * Discovers a service's port via the 4-source fallback chain: `src/index.ts`
 * -> `src/app.ts` -> `infra/docker-compose.yml` -> the gateway registry.
 *
 * `serviceDir` is the service's directory (e.g.
 * `.../services/meeting-service`); `gatewayRegistrySource` is the raw text
 * of `services/gateway-service/src/registry.ts`, passed in by the caller
 * (task 16's orchestration script) rather than read from a hardcoded path
 * here, keeping this function's only implicit path assumption to
 * `infra/docker-compose.yml`'s location relative to `serviceDir`
 * (`<repoRoot>/services/<service-dir>` -> `<repoRoot>/infra/docker-compose.yml`).
 *
 * Resolution order and disagreement handling (per design.md's Error Handling
 * note — "Port discovery ambiguity"):
 *   - The three file-based sources (`index.ts`, `app.ts`, `docker-compose.yml`)
 *     are checked in that order; the first one that yields a port is the
 *     "file match".
 *   - The gateway registry is checked independently.
 *   - If only one of {file match, registry match} exists, that value wins.
 *   - If both exist and agree, either is reported (`discoveredFrom` reflects
 *     the file source, since the values are identical).
 *   - If both exist and *disagree*, the gateway registry value wins — it is
 *     the operationally authoritative source-of-truth for routing — and
 *     `discoveredFrom` is reported as `"gateway-registry.ts"`.
 *   - If neither yields a port, the result is `{ port: null, discoveredFrom: null }`.
 */
export function discoverPort(serviceDir: string, gatewayRegistrySource: string): PortDiscoveryResult {
  const dirName = basename(serviceDir);
  const serviceName = dirName.endsWith(SERVICE_DIR_SUFFIX) ? dirName.slice(0, -SERVICE_DIR_SUFFIX.length) : dirName;

  const indexSource = readFileSafe(join(serviceDir, "src", "index.ts"));
  const indexPort = indexSource !== null ? matchPortEnvDefault(indexSource) : null;

  const appSource = readFileSafe(join(serviceDir, "src", "app.ts"));
  const appPort = appSource !== null ? matchPortEnvDefault(appSource) : null;

  const dockerComposePath = join(dirname(dirname(serviceDir)), "infra", "docker-compose.yml");
  const dockerComposeSource = readFileSafe(dockerComposePath);
  const dockerComposePort = dockerComposeSource !== null ? matchDockerComposePort(dockerComposeSource, serviceName) : null;

  const registryPort = matchGatewayRegistryPort(gatewayRegistrySource, serviceName);

  let fileMatch: { port: number; discoveredFrom: "index.ts" | "app.ts" | "docker-compose.yml" } | null = null;
  if (indexPort !== null) {
    fileMatch = { port: indexPort, discoveredFrom: "index.ts" };
  } else if (appPort !== null) {
    fileMatch = { port: appPort, discoveredFrom: "app.ts" };
  } else if (dockerComposePort !== null) {
    fileMatch = { port: dockerComposePort, discoveredFrom: "docker-compose.yml" };
  }

  if (fileMatch === null && registryPort === null) {
    return { service: serviceName, port: null, discoveredFrom: null };
  }
  if (fileMatch === null) {
    return { service: serviceName, port: registryPort as number, discoveredFrom: "gateway-registry.ts" };
  }
  if (registryPort === null) {
    return { service: serviceName, port: fileMatch.port, discoveredFrom: fileMatch.discoveredFrom };
  }
  if (fileMatch.port === registryPort) {
    return { service: serviceName, port: fileMatch.port, discoveredFrom: fileMatch.discoveredFrom };
  }
  // Disagreement: prefer the gateway registry value (see doc comment above).
  return { service: serviceName, port: registryPort, discoveredFrom: "gateway-registry.ts" };
}

// ─────────────────────────────────────────────────────────────────────────────
// reconcileServiceList() / reconcilePortMap() — task 6.2
//
// Both functions are pure, additive-only merges: neither ever removes a key
// already present in `documented`/`documentedPorts` (design Property 7 /
// Requirement 3.4). `reconcilePortMap` only adds a port for a service when
// `discover(service)` returns a non-null port (design Property 6 /
// Requirements 3.1-3.3); services for which `discover` returns `null` are
// recorded in `needsManualAssignment` instead of being assigned an invented
// port.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merges the Service_Registry into the documented service list, additive
 * only: every registry entry missing from `documented` is appended (in
 * registry order) to produce `merged`; `documented`'s existing order and
 * entries are preserved unchanged. `added` is `registry \ documented`.
 */
export function reconcileServiceList(
  documented: string[],
  registry: string[]
): { merged: string[]; added: string[] } {
  const documentedSet = new Set(documented);
  const added = registry.filter((service) => !documentedSet.has(service));
  const merged = [...documented, ...added];
  return { merged, added };
}

/**
 * Merges the Service_Registry into the documented port map, additive only:
 * every registry entry missing from `documentedPorts` gets a `discover()`
 * call; if `discover` returns a non-null port, that entry is added to
 * `merged`/`added`. If `discover` returns `null`, the service is recorded in
 * `needsManualAssignment` and no port is invented for it. Services already
 * present in `documentedPorts` are never re-discovered or overwritten,
 * regardless of what `discover` would return for them.
 */
export function reconcilePortMap(
  documentedPorts: Record<string, number>,
  registry: string[],
  discover: (service: string) => PortDiscoveryResult
): {
  merged: Record<string, number>;
  added: { service: string; port: number }[];
  needsManualAssignment: string[];
} {
  const merged: Record<string, number> = { ...documentedPorts };
  const added: { service: string; port: number }[] = [];
  const needsManualAssignment: string[] = [];

  for (const service of registry) {
    if (Object.prototype.hasOwnProperty.call(documentedPorts, service)) continue;

    const result = discover(service);
    if (result.port === null) {
      needsManualAssignment.push(service);
    } else {
      merged[service] = result.port;
      added.push({ service, port: result.port });
    }
  }

  return { merged, added, needsManualAssignment };
}
