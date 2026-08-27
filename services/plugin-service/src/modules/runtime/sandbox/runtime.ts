/**
 * Plugin hook sandbox (SEC-P0-03).
 *
 * Untrusted plugin handler code MUST NOT reach host capabilities. The previous
 * implementation used `new Function(handler)`, which runs the handler in the
 * module's own scope with full access to `require`, `process`, `fs`, network,
 * and every closed-over binding — i.e. arbitrary remote code execution the
 * moment PLUGIN_RUNTIME_ENABLED=true.
 *
 * This runs the handler with `node:vm` in a FRESH context whose global object
 * contains only the explicit sandbox API. `require`, `process`, `module`,
 * `globalThis.Buffer`, `fs`, timers, and dynamic `import()` are all absent, so
 * a handler that references them throws `ReferenceError` instead of escaping.
 * A wall-clock timeout bounds runaway/`while(true)` handlers. The classic realm
 * escape (`this.constructor.constructor("return process")()`) resolves against
 * the fresh context's own `Function`, whose realm has no `process` binding, so
 * it yields `undefined` rather than the host process.
 *
 * This is the isolation boundary the engine's own header always claimed
 * ("no fs, no net, no process"). It is intentionally dependency-free (no vm2,
 * which is deprecated and has known escapes).
 *
 * Hardening applied:
 *   - null-prototype sandbox global, so `this.constructor` is undefined and the
 *     classic `this.constructor.constructor("…")()` reach-back to the host
 *     `Function` (which would bypass the context's codegen policy) throws.
 *   - codeGeneration disabled: direct `eval` / `new Function` in-context throw.
 *   - the `ctx` object handed to the handler (tenantId/eventType/payload/
 *     correlationId/log/emit) is rebuilt with a null prototype, and every
 *     function on it is wrapped with a null prototype too, before it crosses
 *     into the sandbox — see the sealedApi construction and sealHostFunction()
 *     below. Both are needed: a null-prototype object has no inherited
 *     `.constructor` of its own (closes `ctx.constructor.constructor(...)`),
 *     and a null-prototype wrapper function likewise has no `.constructor`
 *     (closes `ctx.log.constructor.constructor(...)`).
 *   - every OBJECT-valued property on `ctx` (payload, and any future
 *     object/array addition) is JSON-serialized on the host side and
 *     reconstructed INSIDE the vm context via that context's OWN JSON.parse
 *     — see the rehydrate step in runInSandbox(). A null prototype only
 *     protects the object it's applied to; a plain object VALUE nested
 *     inside `ctx` (e.g. `ctx.payload`) is unaffected by sealing `ctx`
 *     itself, and still carries the host's `Object.prototype` — so
 *     `ctx.payload.constructor.constructor("...")()` reached the real host
 *     Function constructor exactly like the two escapes above, independent
 *     of them and not closed by sealing functions alone. `vm.createContext`
 *     supplies each context its OWN full set of built-ins (JSON, Object,
 *     Array, ...) regardless of the sandbox object's prototype, so
 *     JSON.parse run BY THE CONTEXT produces objects rooted in that
 *     context's own Object/Array.prototype, whose `.constructor` chain IS
 *     bound by this context's codeGeneration policy — closing the same
 *     reach-back for object values the way sealHostFunction() closes it for
 *     functions. Primitive properties (tenantId, eventType, correlationId)
 *     need none of this: autoboxing a primitive always uses the CURRENTLY
 *     EXECUTING realm, never the primitive's realm of origin, so e.g.
 *     `ctx.tenantId.constructor` already resolves in-context.
 *   - wall-clock + vm timeout bound runaway handlers.
 *
 * Residual limitation (defense-in-depth, not a hard multi-tenant boundary):
 * `node:vm` is explicitly documented by Node.js as not a security mechanism
 * for untrusted code, and the mitigations above are a best-effort narrowing
 * of its known-reachable escapes, not a hard boundary equivalent to process
 * isolation. A hard guarantee requires running the handler in a
 * worker_thread with the callbacks marshalled over postMessage (structured-
 * clone data only, no live function/object references crossing the boundary
 * at all); that remains tracked as the follow-up.
 */
import vm from "node:vm";

export interface SandboxApi {
  tenantId: string;
  eventType: string;
  payload: unknown;
  correlationId: string;
  log: (level: string, msg: string) => void;
  emit: (eventType: string, payload: unknown) => void;
  [k: string]: unknown;
}

export interface SandboxResult {
  output: unknown;
  error?: string;
}

/** Sentinel thrown by the vm timeout so the caller can classify it. */
export const SANDBOX_TIMEOUT = "TIMEOUT";

/**
 * Strip a host-realm function's prototype chain before it crosses into the
 * sandboxed vm context.
 *
 * `vm.createContext` only contextifies the sandbox object's OWN structure —
 * any function VALUE placed on it (ctx.log, ctx.emit, ...) is still the
 * original host-realm Function object. `codeGeneration: { strings: false }`
 * on the context only blocks the context's OWN eval/Function from compiling
 * strings; it does nothing to a Function object that belongs to a different
 * realm. So `ctx.log.constructor` resolves via the normal prototype chain to
 * the HOST realm's `Function` constructor — a realm with no codegen
 * restriction at all — and `ctx.log.constructor.constructor("return
 * process")()` compiles and runs that string as host code, fully bypassing
 * the sandbox. (Confirmed exploitable before this fix; see the regression
 * test "blocks the constructor realm-escape via a host callback".)
 *
 * Setting the wrapper's prototype to `null` removes `Function.prototype`
 * (and therefore `.constructor`) from its lookup chain entirely: `wrapped
 * .constructor` is `undefined`, so the reach-back has nothing to call. The
 * wrapper still forwards calls/arguments/return value normally — only
 * property lookups on the function object itself are affected, and none of
 * the sandbox callbacks rely on `this` or on being distinguishable from a
 * plain function.
 */
function sealHostFunction<T extends (...args: never[]) => unknown>(fn: T): T {
  const wrapped = ((...args: Parameters<T>) => fn(...args)) as T;
  Object.setPrototypeOf(wrapped, null);
  return wrapped;
}

/**
 * Serialize a host-realm object/array value so it can be reconstructed
 * INSIDE the vm context (see the rehydrate step in runInSandbox()) instead
 * of crossing the boundary as a live reference to a host-realm object.
 *
 * A value that can't be represented as JSON (e.g. contains a function,
 * BigInt, or a circular reference — none of which JSON.stringify supports,
 * unlike structuredClone) is replaced with `null` rather than thrown: failing
 * closed (the handler sees nothing for that field) is the safe choice here,
 * not surfacing the host's structured data by falling back to a live
 * reference, and not aborting the whole hook execution over one
 * unrepresentable field.
 */
function toRehydratableJson(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? "null" : json; // JSON.stringify(undefined) returns undefined, not a string
  } catch {
    return "null";
  }
}

/**
 * Execute an untrusted handler body in an isolated vm context.
 * @param handler   plugin-supplied JS (the async function body)
 * @param api       the ONLY capabilities exposed to the handler (as `ctx`)
 * @param timeoutMs wall-clock budget; a handler exceeding it is aborted
 */
export async function runInSandbox(
  handler: string,
  api: SandboxApi,
  timeoutMs: number,
): Promise<SandboxResult> {
  // Partition api's own properties by kind — each kind needs a DIFFERENT
  // treatment to keep the host's Function/Object constructors unreachable
  // from inside the sandbox:
  //   - functions (ctx.log, ctx.emit, ...)  -> sealHostFunction() (null
  //     prototype; see that function's comment)
  //   - objects/arrays (ctx.payload, ...)   -> serialize now, reconstructed
  //     INSIDE the context below (see rehydrateSource; see
  //     toRehydratableJson()'s comment)
  //   - primitives (tenantId, eventType...) -> pass through unchanged;
  //     autoboxing always uses the CURRENTLY EXECUTING realm, not the
  //     primitive's realm of origin, so these carry no escape risk.
  const primitiveEntries: [string, unknown][] = [];
  const functionEntries: [string, (...args: never[]) => unknown][] = [];
  const objectEntries: [string, unknown][] = [];
  for (const [key, value] of Object.entries(api)) {
    if (typeof value === "function") functionEntries.push([key, value as (...args: never[]) => unknown]);
    else if (value !== null && typeof value === "object") objectEntries.push([key, value]);
    else primitiveEntries.push([key, value]);
  }

  // `ctx` itself is rebuilt with a null prototype so `ctx.constructor` is
  // undefined too — closing the same reach-back one level up (`ctx` is an
  // ordinary object created in the host realm, so without this it inherits
  // `.constructor` from `Object.prototype` -> host `Object` -> `.constructor`
  // again -> host `Function`, independent of whether `ctx` holds any
  // functions at all).
  const sealedApi = Object.assign(
    Object.create(null),
    Object.fromEntries(primitiveEntries),
    Object.fromEntries(functionEntries.map(([key, fn]) => [key, sealHostFunction(fn)])),
  ) as SandboxApi;

  // The context's global object holds ONLY `ctx`. No require/process/module/fs,
  // no Buffer, no timers, no dynamic import. Anything else is a ReferenceError.
  // Null-prototype so `this.constructor` is undefined — this severs the classic
  // `this.constructor.constructor("return process")()` reach-back to the host
  // Function realm (which is not bound by this context's codegen policy).
  const sandbox: Record<string, unknown> = Object.assign(Object.create(null), { ctx: sealedApi });
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });

  // Reconstruct each object-valued ctx property BY CALLING THIS CONTEXT'S
  // OWN JSON.parse (a contextified global vm.createContext supplies
  // regardless of the sandbox object's prototype) before the untrusted
  // handler body runs. The resulting objects are rooted in THIS context's
  // Object/Array.prototype, not the host's — `codeGeneration: {strings:
  // false}` binds their `.constructor` chain the same way it already binds
  // `ctx`/`ctx.log`'s. This is JSON.parse, not eval/Function, so it is not
  // itself subject to the codeGeneration restriction. The JSON text is
  // embedded directly as a string LITERAL (via the outer JSON.stringify) so
  // no auxiliary object needs to sit on the sandbox global at all — anything
  // placed there would need this same null-prototype treatment, since the
  // untrusted handler shares that same global scope and could reference it
  // directly, same as `ctx`.
  const rehydrateSource = objectEntries
    .map(([key, value]) => `ctx[${JSON.stringify(key)}] = JSON.parse(${JSON.stringify(toRehydratableJson(value))});`)
    .join(" ");

  // Wrap the handler body in an async IIFE. `eval`/`new Function` inside the
  // handler are blocked by codeGeneration.strings:false above.
  const source = `"use strict"; (async () => { ${rehydrateSource} ${handler} })();`;

  let script: vm.Script;
  try {
    script = new vm.Script(source, { filename: "plugin-hook.vm.js" });
  } catch (err) {
    return { output: undefined, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    // vm's own `timeout` interrupts synchronous spins; the Promise.race guards
    // the async tail (awaited microtasks the vm timeout cannot see).
    const runPromise = script.runInContext(context, { timeout: timeoutMs }) as Promise<unknown>;
    let timer: NodeJS.Timeout | undefined;
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(SANDBOX_TIMEOUT)), timeoutMs);
    });
    try {
      const result = await Promise.race([runPromise, guard]);
      return { output: result };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // vm surfaces its synchronous timeout as "Script execution timed out".
    if (message === SANDBOX_TIMEOUT || message.includes("timed out")) {
      return { output: undefined, error: SANDBOX_TIMEOUT };
    }
    return { output: undefined, error: message };
  }
}
