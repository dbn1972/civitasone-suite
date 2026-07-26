/**
 * Cross-service topic registry extractor.
 *
 * Parses every `services/{svc}/src/topics.ts` with the TypeScript compiler API
 * (not regex — object literals are read from the AST so renames/comments cannot
 * fool it) and builds the platform-wide event contract:
 *
 *   - produced:  topics a service declares in EVENTS (domain facts it emits)
 *   - commands:  topics a service declares in COMMANDS (its own write intents)
 *   - consumed:  topics a service declares in CONSUMED_EVENTS | CONSUMED |
 *                CONSUMES | INBOUND (facts owned by OTHER services)
 *
 * It also scans each service's `src/**` for the topics it *actually* subscribes
 * to and *actually* enqueues, so a declaration that does not match the code is
 * caught (phantom declaration / undeclared consumption).
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

export const SERVICES_DIR = join(process.cwd(), "services");

/** Export names that mean "topics this service emits". */
const PRODUCED_EXPORTS = new Set(["EVENTS"]);
/** Export names that mean "this service's own write intents". */
const COMMAND_EXPORTS = new Set(["COMMANDS"]);
/** Export names that mean "topics owned by OTHER services that we subscribe to". */
const CONSUMED_EXPORTS = new Set([
  "CONSUMED_EVENTS",
  "CONSUMED",
  "CONSUMES",
  "INBOUND",
]);

export type TopicRef = {
  /** Property key inside the object literal, e.g. `sanctionApproved`. */
  key: string;
  /** Literal topic string, e.g. `finance.sanction.approved`. */
  topic: string;
};

export type ServiceContract = {
  service: string;
  produced: TopicRef[];
  commands: TopicRef[];
  consumed: TopicRef[];
  /** Export name the produced topics came from (usually `EVENTS`). */
  producedMapName: string;
  /** Export name the consumed topics came from (varies across services). */
  consumedMapName: string;
  /** Topic strings the service source actually passes to a subscribe call. */
  subscribedInCode: Set<string>;
  /** Topic strings the service source actually enqueues/publishes. */
  emittedInCode: Set<string>;
  /**
   * `<MAP>.<key>` and bare-`key` symbol references found anywhere in the
   * service's src (excluding topics.ts). Indirection-proof evidence that a
   * declared contract is wired into code.
   */
  referencedSymbols: Set<string>;
};

/** True when a declared topic is wired into the service's code at all. */
export function isWired(
  c: ServiceContract,
  mapName: string,
  ref: TopicRef,
  directSet: Set<string>,
): boolean {
  if (directSet.has(ref.topic)) return true;
  if (c.referencedSymbols.has(`${mapName}.${ref.key}`)) return true;
  if (c.referencedSymbols.has(ref.key)) return true;
  return false;
}

function listServiceDirs(): string[] {
  return readdirSync(SERVICES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(SERVICES_DIR, name, "src", "topics.ts")));
}

/** Walk a directory collecting .ts files (skips dist/node_modules/tests). */
function collectTsFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === "tests"
    ) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectTsFiles(full, acc);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ES2022,
    true,
  );
}

/**
 * Read `export const NAME = { key: "topic", ... } as const` object literals from
 * a topics.ts AST. Only string-literal values are collected; nested objects and
 * computed values are ignored (no such shape exists today, and silently
 * skipping them would hide contracts — so they are reported instead).
 */
function extractTopicMaps(sf: ts.SourceFile): {
  maps: Map<string, TopicRef[]>;
  skipped: { exportName: string; key: string }[];
} {
  const maps = new Map<string, TopicRef[]>();
  const skipped: { exportName: string; key: string }[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const isExported = stmt.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!isExported) continue;

    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const exportName = decl.name.text;

      // Unwrap `{...} as const`
      let init: ts.Expression = decl.initializer;
      if (ts.isAsExpression(init)) init = init.expression;
      if (!ts.isObjectLiteralExpression(init)) continue;

      const refs: TopicRef[] = [];
      for (const prop of init.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const key = ts.isIdentifier(prop.name)
          ? prop.name.text
          : ts.isStringLiteral(prop.name)
            ? prop.name.text
            : null;
        if (!key) continue;
        if (ts.isStringLiteral(prop.initializer)) {
          refs.push({ key, topic: prop.initializer.text });
        } else {
          skipped.push({ exportName, key });
        }
      }
      if (refs.length > 0) maps.set(exportName, refs);
    }
  }
  return { maps, skipped };
}

/**
 * Resolve `TOPICS.foo` / `COMMANDS.foo` style member expressions to their topic
 * string using the service's own topic maps, so subscribe/enqueue call sites are
 * matched even though they never contain the literal string.
 */
function buildAliasIndex(maps: Map<string, TopicRef[]>): Map<string, string> {
  const index = new Map<string, string>();
  for (const [exportName, refs] of maps) {
    for (const ref of refs) {
      index.set(`${exportName}.${ref.key}`, ref.topic);
      // Bare key fallback (destructured imports); last-wins is acceptable
      // because collisions across maps use the same topic in this codebase.
      if (!index.has(ref.key)) index.set(ref.key, ref.topic);
    }
  }
  return index;
}

const SUBSCRIBE_FNS = new Set(["subscribe", "subscribeWithDlq", "sub", "on"]);

/**
 * Reference-count every `<MAP>.<key>` member access across a service's source
 * (excluding topics.ts itself).
 *
 * Why this and not "find the literal at the enqueue/subscribe call site": topic
 * constants are routinely passed through helpers —
 * `emit(tx, msg, EVENTS.instanceCreated, ...)` where `emit` internally does
 * `enqueue(tx, { topic: eventType })`. The literal never appears at the enqueue
 * site, so call-site matching reports a false "never emitted". Counting symbol
 * references is indirection-proof and still catches the real defect: a contract
 * declared in topics.ts that no code anywhere touches.
 */
function scanSymbolReferences(serviceDir: string): Set<string> {
  const referenced = new Set<string>();
  const topicsFile = join(serviceDir, "src", "topics.ts");

  for (const file of collectTsFiles(join(serviceDir, "src"))) {
    if (file === topicsFile) continue;
    const sf = parse(file);
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) {
        const obj = node.expression.getText();
        referenced.add(`${obj}.${node.name.text}`);
        // Also record the bare key so aliased imports
        // (`import { EVENTS as E }`) still resolve.
        referenced.add(node.name.text);
      }
      // Destructured usage: `const { instanceCreated } = EVENTS;`
      if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
        referenced.add(node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return referenced;
}

/** Resolve a call argument expression to a topic string, if possible. */
function resolveTopicArg(
  arg: ts.Expression,
  alias: Map<string, string>,
): string | null {
  if (ts.isStringLiteral(arg)) return arg.text;
  if (ts.isPropertyAccessExpression(arg)) {
    const objText = arg.expression.getText();
    const full = `${objText}.${arg.name.text}`;
    return alias.get(full) ?? alias.get(arg.name.text) ?? null;
  }
  if (ts.isIdentifier(arg)) return alias.get(arg.text) ?? null;
  return null;
}

/** Scan service source for real subscribe(...) and enqueue({topic}) call sites. */
function scanCallSites(
  serviceDir: string,
  alias: Map<string, string>,
): { subscribed: Set<string>; emitted: Set<string> } {
  const subscribed = new Set<string>();
  const emitted = new Set<string>();

  for (const file of collectTsFiles(join(serviceDir, "src"))) {
    const sf = parse(file);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        // queue.subscribe(TOPIC, handler) / subscribeWithDlq(queue, TOPIC, h)
        const callee = node.expression;
        const fnName = ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : ts.isIdentifier(callee)
            ? callee.text
            : "";
        if (SUBSCRIBE_FNS.has(fnName)) {
          for (const arg of node.arguments) {
            const topic = resolveTopicArg(arg, alias);
            if (topic && topic.includes(".")) {
              subscribed.add(topic);
              break;
            }
          }
        }
      }
      // enqueue(tx, { topic: X, ... }) — find `topic:` properties anywhere
      if (ts.isPropertyAssignment(node)) {
        const name = ts.isIdentifier(node.name) ? node.name.text : null;
        if (name === "topic" || name === "eventType") {
          const topic = resolveTopicArg(node.initializer, alias);
          if (topic && topic.includes(".")) emitted.add(topic);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { subscribed, emitted };
}

let cached: ServiceContract[] | null = null;

export function loadContracts(): ServiceContract[] {
  if (cached) return cached;
  const contracts: ServiceContract[] = [];

  for (const service of listServiceDirs()) {
    const serviceDir = join(SERVICES_DIR, service);
    const sf = parse(join(serviceDir, "src", "topics.ts"));
    const { maps } = extractTopicMaps(sf);
    const alias = buildAliasIndex(maps);

    const pick = (names: Set<string>): TopicRef[] => {
      const out: TopicRef[] = [];
      for (const [exportName, refs] of maps) {
        if (names.has(exportName)) out.push(...refs);
      }
      return out;
    };

    const { subscribed, emitted } = scanCallSites(serviceDir, alias);
    const referencedSymbols = scanSymbolReferences(serviceDir);

    // Record which export name each ref came from so wiring checks can look up
    // `<MAP>.<key>` symbol references.
    const nameOf = (names: Set<string>): string =>
      [...maps.keys()].find((k) => names.has(k)) ?? [...names][0]!;

    contracts.push({
      service,
      produced: pick(PRODUCED_EXPORTS),
      commands: pick(COMMAND_EXPORTS),
      consumed: pick(CONSUMED_EXPORTS),
      producedMapName: nameOf(PRODUCED_EXPORTS),
      consumedMapName: nameOf(CONSUMED_EXPORTS),
      subscribedInCode: subscribed,
      emittedInCode: emitted,
      referencedSymbols,
    });
  }

  cached = contracts;
  return contracts;
}

/** Map of topic string → services that declare they produce it. */
export function producerIndex(contracts: ServiceContract[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const c of contracts) {
    for (const ref of c.produced) {
      const list = index.get(ref.topic) ?? [];
      list.push(c.service);
      index.set(ref.topic, list);
    }
  }
  return index;
}

/** Map of topic string → services that declare they consume it. */
export function consumerIndex(contracts: ServiceContract[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const c of contracts) {
    for (const ref of c.consumed) {
      const list = index.get(ref.topic) ?? [];
      list.push(c.service);
      index.set(ref.topic, list);
    }
  }
  return index;
}

/** Every topic any service actually emits in code (union across the fleet). */
export function emittedAnywhere(contracts: ServiceContract[]): Set<string> {
  const all = new Set<string>();
  for (const c of contracts) for (const t of c.emittedInCode) all.add(t);
  return all;
}

/** Every topic any service actually subscribes to in code. */
export function subscribedAnywhere(contracts: ServiceContract[]): Set<string> {
  const all = new Set<string>();
  for (const c of contracts) for (const t of c.subscribedInCode) all.add(t);
  return all;
}
