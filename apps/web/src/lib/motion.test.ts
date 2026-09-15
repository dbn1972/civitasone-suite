import { describe, it, expect, vi, afterEach } from "vitest";
import { prefersReducedMotion, scrollBehavior } from "./motion";

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// prefersReducedMotion -- reads window.matchMedia("(prefers-reduced-motion: reduce)")
// ---------------------------------------------------------------------------
describe("prefersReducedMotion", () => {
  it("returns true when the user's OS/browser requests reduced motion", () => {
    mockMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it("returns false when the user has no reduced-motion preference", () => {
    mockMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("does not throw when window.matchMedia is unavailable (SSR)", () => {
    const original = window.matchMedia;
    // @ts-expect-error -- simulating an environment with no matchMedia
    delete window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
    window.matchMedia = original;
  });
});

// ---------------------------------------------------------------------------
// scrollBehavior -- the "auto" | "smooth" value to pass to scrollIntoView()
// ---------------------------------------------------------------------------
describe("scrollBehavior", () => {
  it("returns 'auto' (instant) when reduced motion is preferred", () => {
    mockMatchMedia(true);
    expect(scrollBehavior()).toBe("auto");
  });

  it("returns 'smooth' when reduced motion is not preferred", () => {
    mockMatchMedia(false);
    expect(scrollBehavior()).toBe("smooth");
  });
});
