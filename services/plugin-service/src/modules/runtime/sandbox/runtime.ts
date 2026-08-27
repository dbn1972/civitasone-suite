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
 *     (closes `ctx.log.constructor.constructor(...)`). Without this, any
 *     object or function value passed into the context — regardless of
 *     codeGeneration settings, which only govern the context's OWN realm —
 *     still carries a live reference to the HOST realm's `Function`/`Object`
 *     constructors via the normal prototype chain.
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
  // Build a null-prototype copy of `api` (the object the handler sees as
  // `ctx`), sealing every function-valued property along the way.
  //
  // Two DISTINCT escapes both reach-back to the host Function realm via a
  // plain `.constructor` lookup, and both are closed by the same technique:
  //   - `ctx.constructor.constructor("...")()` — `ctx` itself, being an
  //     ordinary object created in the host realm, inherits `.constructor`
  //     from `Object.prototype` → host `Object` → `.constructor` again →
  //     host `Function`. This works even if `ctx` held no functions at all.
  //   - `ctx.log.constructor.constructor("...")()` — same reach-back, one
  //     hop further, via any individual callback (sealHostFunction() covers
  //     this one; see its own comment).
  // `codeGeneration: { strings: false }` on the vm context (below) does NOT
  // help here: it only restricts the context's OWN eval/Function, and every
  // object/function reached this way belongs to a DIFFERENT (host) realm
  // with no such restriction. Setting each object's prototype to `null`
  // removes `Function`/`Object`.prototype — and therefore `.constructor` —
  // from its lookup chain entirely, so both reach-backs resolve to
  // `undefined` instead of the host constructor.
  const sealedApi = Object.assign(
    Object.create(null),
    Object.fromEntries(
      Object.entries(api).map(([key, value]) => [
        key,
        typeof value === "function" ? sealHostFunction(value as (...args: never[]) => unknown) : value,
      ]),
    ),
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

  // Wrap the handler body in an async IIFE. `eval`/`new Function` inside the
  // handler are blocked by codeGeneration.strings:false above.
  const source = `"use strict"; (async () => { ${handler} })();`;

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
