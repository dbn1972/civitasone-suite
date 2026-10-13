/**
 * Opt-in strict mode for entity adapters' search(): by default an adapter
 * degrades a non-ok response to [] (which EntityPicker renders as "No
 * matches"). A caller that passes `{ strict: true }` instead gets a thrown
 * error, which EntityPicker renders as a distinct "could not load" alert --
 * a failed fetch must never read as "nothing exists".
 */
export interface StrictOpt {
  strict?: boolean;
}

export function failStrict(res: Response, opts?: StrictOpt): void {
  if (opts?.strict && !res.ok) throw new Error(`entity lookup failed: HTTP ${res.status}`);
}
