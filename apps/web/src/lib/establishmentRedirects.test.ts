import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../../next.config.mjs";

// GAP-ESTABLISHMENT-HOME-03 / GAP-ESTABLISHMENT-FILES-02: /establishment and
// /establishment/files were permanent aliases implemented as page-level runtime
// redirect() calls (307 temporary) that also flashed a Tailwind loading.tsx
// skeleton before resolving. They are now config-level permanent (308) redirects
// that run before any page/loading boundary. These assertions fail on the old
// tree (where the config redirects were absent and the page/loading files existed).
describe("establishment dead-route redirects (next.config.mjs)", () => {
  it("permanently redirects /establishment to /estab", async () => {
    const cfg = nextConfig as unknown as { redirects: () => Promise<unknown> };
    const rules = (await cfg.redirects()) as Array<{ source: string; destination: string; permanent: boolean }>;
    expect(rules).toContainEqual({ source: "/establishment", destination: "/estab", permanent: true });
  });

  it("permanently redirects /establishment/files to /estab/list", async () => {
    const cfg = nextConfig as unknown as { redirects: () => Promise<unknown> };
    const rules = (await cfg.redirects()) as Array<{ source: string; destination: string; permanent: boolean }>;
    expect(rules).toContainEqual({ source: "/establishment/files", destination: "/estab/list", permanent: true });
  });

  it("the page-level redirect() files that caused the skeleton flash are gone", () => {
    // vitest runs with apps/web as cwd (see vitest.config.ts root).
    const base = join(process.cwd(), "src/app/(app)/establishment");
    expect(existsSync(join(base, "page.tsx"))).toBe(false);
    expect(existsSync(join(base, "loading.tsx"))).toBe(false);
    expect(existsSync(join(base, "files/page.tsx"))).toBe(false);
    expect(existsSync(join(base, "files/loading.tsx"))).toBe(false);
  });
});
