/**
 * UX-005: `prefers-reduced-motion` support for JS-driven motion.
 *
 * The CSS side of this (globals-animations.css's
 * `@media (prefers-reduced-motion: reduce)` block) neutralizes every
 * CSS `animation`/`transition` in the app, including ones set via inline
 * `style` (VoiceNav.tsx's pulse, Skeleton.tsx's shimmer) -- a stylesheet
 * `!important` rule beats an inline style that isn't itself `!important`.
 * It cannot help with an explicit `behavior: "smooth"` passed to a JS API
 * like `Element.scrollIntoView()`: that is a JS-level animation choice, not
 * a CSS property, so nothing in a stylesheet can intercept it. This module
 * is the equivalent check for that case.
 */

/**
 * Whether the user has asked the OS/browser for reduced motion. Safe to
 * call during server-side rendering: `window` is undefined there, and this
 * returns `false` (there is no motion to reduce yet -- the real check only
 * matters once code actually runs in a browser, e.g. inside an event
 * handler or effect).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** `"auto"` (instant) when the user prefers reduced motion, else `"smooth"`.
 * Pass straight through as `Element.scrollIntoView({ behavior: scrollBehavior() })`. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
