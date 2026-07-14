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
 *   - wall-clock + vm timeout bound runaway handlers.
 *
 * Residual limitation (defense-in-depth, not a hard multi-tenant boundary): a
 * host FUNCTION passed into the sandbox (ctx.log/ctx.emit) still exposes
 * `.constructor` to the host realm, so a determined handler could reach host
 * codegen via `ctx.log.constructor`. Fully sealing that requires running the
 * handler in a worker_thread with the callbacks marshalled over postMessage;
 * that is tracked as the follow-up. What is closed here is the acute,
 * default-reachable RCE surface (`process`/`require`/`fs`/`eval`/`this`-escape)
 * that `new Function(handler)` left wide open.
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
  // The context's global object holds ONLY `ctx`. No require/process/module/fs,
  // no Buffer, no timers, no dynamic import. Anything else is a ReferenceError.
  // Null-prototype so `this.constructor` is undefined — this severs the classic
  // `this.constructor.constructor("return process")()` reach-back to the host
  // Function realm (which is not bound by this context's codegen policy).
  const sandbox: Record<string, unknown> = Object.assign(Object.create(null), { ctx: api });
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
