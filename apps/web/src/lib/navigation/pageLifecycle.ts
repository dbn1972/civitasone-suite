/**
 * F132 (UAT-P2-D2): background session work (the silent refresh timer, the
 * session-identity read behind the offline request queue) used to start the
 * moment the app shell hydrated. On a page that immediately redirects
 * (e.g. /estab/files -> /estab/list) the browser then navigated away mid-call
 * and the sweep logged aborted GET /api/auth/session and /api/auth/refresh
 * requests -- wasted round trips to the auth endpoints on every redirect.
 *
 * Next.js emits an in-stream redirect as `<meta id="__next-page-redirect"
 * http-equiv="refresh">`, which the browser only follows after the document
 * has finished loading. So "wait for load, then check" is enough to know
 * whether this page is about to be replaced; `pagehide` covers every other
 * way of actually leaving. Nothing here touches the network.
 *
 * `beforeunload` is deliberately NOT a leaving signal: it is cancellable (the
 * dirty-form "Leave site?" prompt, download / mailto navigations), and a page
 * whose unload was cancelled is still live -- treating it as leaving would
 * stop the session-timeout warning for good (A11Y-01, WCAG 2.2.1). The flag is
 * also cleared whenever the page shows again (`pageshow`, incl. bfcache) or
 * becomes visible again (`visibilitychange`), so it can never stick.
 */

/** id of the <meta http-equiv="refresh"> Next.js inserts for redirect()/permanentRedirect() after streaming began. */
export const NEXT_PAGE_REDIRECT_META_ID = "__next-page-redirect";

let leaving = false;
let installed = false;

function install(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const markLeaving = () => {
    leaving = true;
  };
  const markLive = () => {
    leaving = false;
  };
  window.addEventListener("pagehide", markLeaving);
  // Shown again (first show, or restored from the back/forward cache): live.
  window.addEventListener("pageshow", markLive);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") markLive();
  });
}

/**
 * True while this document is being navigated away from (pagehide) or is about
 * to be replaced (Next.js redirect meta). Without a window (server render)
 * there is no live page to do client-side session work for, so it reports
 * true -- callers then simply skip that work.
 */
export function isLeavingPage(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return true;
  install();
  return leaving || document.getElementById(NEXT_PAGE_REDIRECT_META_ID) !== null;
}

/**
 * Run `fn` once the document has finished loading, unless the page is being
 * left by then. Returns a cancel function (call it from an effect cleanup so
 * an unmounted component never starts the work).
 */
export function runWhenPageSettled(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  install();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    // A macrotask after load: a redirect meta parsed in the final chunk is in the DOM by now.
    timer = setTimeout(() => {
      timer = null;
      if (!cancelled && !isLeavingPage()) fn();
    }, 0);
  };
  const onLoad = () => fire();
  if (document.readyState === "complete") fire();
  else window.addEventListener("load", onLoad, { once: true });
  return () => {
    cancelled = true;
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener("load", onLoad);
  };
}

/** Test seam only. */
export function __resetPageLifecycleForTests(): void {
  leaving = false;
}
