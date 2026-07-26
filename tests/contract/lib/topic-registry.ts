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
/**
 * Export names that mean "topics in ANOTHER service's namespace that we publish
 * into" — cross-service command dispatch. workflow-service's `DISPATCH` sends
 * approval decisions to hrms/procurement/estab/asset command topics; a target
 * that does not handle the command silently drops the approval.
 */
const DISPATCH_EXPORTS = new Set(["DISPATCH", "INTEGRATION", "OUTBOUND"]);

export type TopicRef = {
  /** Property key inside the object literal, e.g. `sanctionApproved`. */
  key: string;
  /** Literal topic string, e.g. `finance.sanction.approved`. */
  topic: string;
  /**
   * Export name this ref came from. Carried per-ref (not per-service) because a
   * service can declare several consumed maps — asset-service has both
   * `CONSUMED` and `CONSUMED_EVENTS`, and a single per-service `mapName` meant
   * one of them could never resolve its wiring lookup.
   */
  mapName: string;
};

export type ServiceContract = {
  service: string;
  produced: TopicRef[];
  commands: TopicRef[];
  consumed: TopicRef[];
  /** Topics in another service's namespace that this service publishes into. */
  dispatched: TopicRef[];
  /**
   * Local aliases the service uses when importing its own topic maps, e.g.
   * `import { COMMANDS as IDENTITY_COMMANDS }`. Needed so wiring lookups
   * resolve without falling back to bare keys.
   */
  importAliases: Set<string>;
  /** Exported topic-shaped maps whose export name the gate does not classify. */
  unclassifiedMaps: string[];
  /** Recognised exports whose initializer was not an object literal. */
  unresolvedMaps: string[];
  /** Topic-ish values the parser could not read (spread/template/computed). */
  skippedEntries: { exportName: string; key: string }[];
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

/**
 * True when a declared topic is wired into the service's code at all.
 *
 * The bare-key fallback was deliberately REMOVED: `scanSymbolReferences` records
 * the bare name of every property access in the service (`id`, `status`,
 * `payload`, every Drizzle column), so matching on it made the check
 * near-vacuous. Measured across the fleet, 0 of 788 declared refs resolved via
 * bare key alone — it bought nothing and risked everything. Aliased imports are
 * handled by `ref.mapName` plus the alias index instead.
 */
export function isWired(
  c: ServiceContract,
  ref: TopicRef,
  directSet: Set<string>,
): boolean {
  if (directSet.has(ref.topic)) return true;
  if (c.referencedSymbols.has(`${ref.mapName}.${ref.key}`)) return true;
  for (const alias of c.importAliases) {
    if (c.referencedSymbols.has(`${alias}.${ref.key}`)) return true;
  }
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

/**
 * Parse a TS file, failing LOUDLY on syntax errors.
 *
 * `ts.createSourceFile` never throws — a malformed topics.ts silently yields an
 * empty/partial AST, which would erase a service's whole contract and turn this
 * gate green. Reading `parseDiagnostics` is what makes that impossible.
 */
function parse(file: string): ts.SourceFile {
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ES2022,
    true,
  );
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] })
    .parseDiagnostics;
  if (diags && diags.length > 0) {
    const first = ts.flattenDiagnosticMessageText(diags[0]!.messageText, " ");
    throw new Error(
      `Cannot parse ${file}: ${first}. The contract gate refuses to run on an ` +
        `unparseable source file — a partial AST would silently erase this ` +
        `service's event contract and report a false pass.`,
    );
  }
  return sf;
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
  unresolved: string[];
} {
  const maps = new Map<string, TopicRef[]>();
  const skipped: { exportName: string; key: string }[] = [];
  /** Recognised export names whose initializer was not an object literal. */
  const unresolved: string[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const isExported = stmt.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!isExported) continue;

    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const exportName = decl.name.text;

      // Unwrap `as const`, `satisfies X`, and parentheses — repeatedly, because
      // they compose (`({...} satisfies T) as const`). Handling only
      // `as const` made a `satisfies` map invisible, erasing the contract.
      let init: ts.Expression = decl.initializer;
      for (;;) {
        if (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) {
          init = init.expression;
        } else if (ts.isParenthesizedExpression(init)) {
          init = init.expression;
        } else break;
      }
      if (!ts.isObjectLiteralExpression(init)) {
        // Only a RECOGNISED contract export failing to resolve is a blind spot.
        // Plain string exports (`SERVICE = "audit"`, `RESOURCE = "call"`) are
        // not contracts and must not be reported.
        if (
          PRODUCED_EXPORTS.has(exportName) ||
          COMMAND_EXPORTS.has(exportName) ||
          CONSUMED_EXPORTS.has(exportName) ||
          DISPATCH_EXPORTS.has(exportName)
        ) {
          unresolved.push(exportName);
        }
        continue;
      }

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
          refs.push({ key, topic: prop.initializer.text, mapName: exportName });
        } else {
          skipped.push({ exportName, key });
        }
      }
      if (refs.length > 0) maps.set(exportName, refs);
    }
  }
  return { maps, skipped, unresolved };
}

/**
 * Any exported map whose values are dotted topic strings but whose export name
 * is not in one of the recognised sets. These are contracts the gate would
 * otherwise ignore entirely (audit-service's `CONSUME_TOPICS` was exactly this
 * — two live subscriptions invisible to the gate, one of them dead).
 */
function unclassifiedTopicMaps(maps: Map<string, TopicRef[]>): string[] {
  const known = new Set([
    ...PRODUCED_EXPORTS,
    ...COMMAND_EXPORTS,
    ...CONSUMED_EXPORTS,
    ...DISPATCH_EXPORTS,
  ]);
  const out: string[] = [];
  for (const [exportName, refs] of maps) {
    if (known.has(exportName)) continue;
    // A map is "topic-shaped" if most of its values look like a.b or a.b.c
    const dotted = refs.filter((r) => /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/.test(r.topic));
    if (dotted.length > 0 && dotted.length === refs.length) out.push(exportName);
  }
  return out;
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

const SUBSCRIBE_FNS = new Set(["subscribe", "subscribeWithDlq"]);
/**
 * Publish/emit call sites. The repo's route pattern is
 * `queue.publish("admin.vapt.scan", { type: ... })` — arg 0 is the topic — while
 * consumers use `enqueue(tx, { topic, eventType })`. Scanning only `enqueue`
 * missed every route-published topic, which is why the orphan count was
 * fleet-wide noise.
 */
const PUBLISH_FNS = new Set(["publish", "enqueue", "emit", "send"]);

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

/**
 * Collect local aliases used when importing this service's own topic maps.
 * `import { COMMANDS as IDENTITY_COMMANDS } from "../../topics.js"` is live in
 * identity-service, so wiring lookups must know about `IDENTITY_COMMANDS`.
 */
function scanImportAliases(serviceDir: string): Set<string> {
  const aliases = new Set<string>();
  for (const file of collectTsFiles(join(serviceDir, "src"))) {
    const sf = parse(file);
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt)) continue;
      const spec = stmt.moduleSpecifier;
      if (!ts.isStringLiteral(spec) || !spec.text.includes("topics")) continue;
      const bindings = stmt.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const el of bindings.elements) {
        // `{ EVENTS as E }` → propertyName=EVENTS, name=E
        if (el.propertyName) aliases.add(el.name.text);
      }
    }
  }
  return aliases;
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
        // queue.publish(TOPIC, envelope) — topic is arg 0
        if (PUBLISH_FNS.has(fnName)) {
          for (const arg of node.arguments) {
            const topic = resolveTopicArg(arg, alias);
            if (topic && topic.includes(".")) {
              emitted.add(topic);
              break;
            }
          }
        }
      }
      // enqueue(tx, { topic: X }) / publish(t, { type: X }) — property forms
      if (ts.isPropertyAssignment(node)) {
        const name = ts.isIdentifier(node.name) ? node.name.text : null;
        if (name === "topic" || name === "eventType" || name === "type") {
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
    const { maps, skipped, unresolved } = extractTopicMaps(sf);
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
    const importAliases = scanImportAliases(serviceDir);

    contracts.push({
      service,
      produced: pick(PRODUCED_EXPORTS),
      commands: pick(COMMAND_EXPORTS),
      consumed: pick(CONSUMED_EXPORTS),
      dispatched: pick(DISPATCH_EXPORTS),
      importAliases,
      unclassifiedMaps: unclassifiedTopicMaps(maps),
      unresolvedMaps: unresolved,
      skippedEntries: skipped,
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
