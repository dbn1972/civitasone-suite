import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const src = (rel: string) => readFileSync(resolve(root, rel), "utf8");

describe("F3 P0 metadata composition CQRS", () => {
  it("composition/layouts/formula/numbering mutations return 202", () => {
    for (const f of [
      "src/modules/composition/routes.ts",
      "src/modules/layouts/routes.ts",
      "src/modules/formula/routes.ts",
      "src/modules/numbering/routes.ts",
    ]) {
      const t = src(f);
      expect(t).toMatch(/code\(202\)/);
      expect(t).toMatch(/publishCommand|queue\.publish/);
    }
  });

  it("public form submit returns 202", () => {
    const t = src("src/modules/forms/public-routes.ts");
    expect(t).toMatch(/PUBLIC_FORM_SUBMIT/);
    expect(t).toMatch(/code\(202\)/);
    expect(t).not.toMatch(/code\(201\)/);
  });

  it("worker registers new consumers with markProcessed", () => {
    const w = src("src/worker.ts");
    for (const name of ["Composition", "Layout", "Numbering", "Formula"]) {
      expect(w).toMatch(new RegExp(`register${name}Consumers`));
    }
    expect(src("src/modules/composition/consumer.ts")).toMatch(/markProcessed/);
  });
});
