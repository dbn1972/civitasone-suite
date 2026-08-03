import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const src = (rel: string) => readFileSync(resolve(root, rel), "utf8");

describe("F3 P0 tenant MSME/quotas CQRS", () => {
  it("msme-onboard returns 202 without repo.update", () => {
    const routes = src("src/modules/tenant/routes.ts");
    expect(routes).toMatch(/msme-onboard/);
    expect(routes).toMatch(/code\(202\)/);
    expect(routes).not.toMatch(/repo\.update/);
    expect(routes).not.toMatch(/code\(201\)/);
  });

  it("tenant quotas PATCH is queue-first", () => {
    const routes = src("src/modules/tenant/routes.ts");
    expect(routes).toMatch(/upsertTenantQuotas/);
    expect(src("src/modules/tenant/commands.ts")).toMatch(/tenantQuotaUpsert/);
    expect(src("src/modules/tenant/consumer.ts")).toMatch(/markProcessed/);
  });
});
