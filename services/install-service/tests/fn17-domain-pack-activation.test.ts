/**
 * FN-17 — Install Stage 3 Domain Pack activation + onboarding wizard scaffolding.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import {
  defaultOnboardingSteps,
  DOMAIN_PACK_ACTIVATE_HANDLER,
  STAGE3_STEP_KEY,
  ONBOARDING_WIZARD_NAME,
} from "../src/modules/orchestrator/onboarding.js";
import {
  CITIZEN_PACK_DOMAIN_ACTIVATE,
  MUNICIPAL_ONBOARDING_PACK_KEYS,
} from "../src/modules/orchestrator/domain-pack-constants.js";
import * as domainPackCommands from "../src/modules/stages/domain-pack-commands.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "00000000-0000-0000-0000-000000000001";
const ADMIN = "00000000-0000-0000-0000-000000000099";

function tok() {
  return signToken(
    { sub: ADMIN, tid: TENANT, roles: ["install_admin", "super_admin"], sid: "sess-fn17-install" },
    SECRET,
    3600,
  );
}
function hdr() {
  return { authorization: `Bearer ${tok()}`, "content-type": "application/json", "x-tenant-id": TENANT };
}

describe("defaultOnboardingSteps (FN-17)", () => {
  it("includes Stage 3 activate_domain_pack for municipal-in-v1", () => {
    const steps = defaultOnboardingSteps();
    expect(steps).toHaveLength(3);
    const stage3 = steps.find((s) => s.stepKey === STAGE3_STEP_KEY);
    expect(stage3).toBeDefined();
    expect(stage3!.handlerType).toBe(DOMAIN_PACK_ACTIVATE_HANDLER);
    expect(stage3!.sortOrder).toBe(3);
    expect(stage3!.config).toMatchObject({
      domainPackKey: "municipal-in-v1",
      stageNumber: 3,
      packKeys: [...MUNICIPAL_ONBOARDING_PACK_KEYS],
    });
  });
});

describe("activateDomainPackStage3 command", () => {
  it("publishes citizen.pack.domain_activate and createStage", async () => {
    const published: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const spy = vi.spyOn(queue, "publish").mockImplementation(async (type, envelope) => {
      published.push({ type, payload: envelope.payload as Record<string, unknown> });
    });

    const ctx = {
      tenantId: TENANT,
      actorId: ADMIN,
      correlationId: "corr-fn17",
      roles: ["install_admin"],
      requestId: "req-1",
    };

    const result = await domainPackCommands.activateDomainPackStage3(ctx as never, {
      domainPackKey: "municipal-in-v1",
    });

    expect(result.status).toBe("accepted");
    expect(result.stageNumber).toBe(3);
    expect(result.domainPackKey).toBe("municipal-in-v1");
    expect(result.packKeys).toEqual([...MUNICIPAL_ONBOARDING_PACK_KEYS]);

    expect(published.some((p) => p.type === CITIZEN_PACK_DOMAIN_ACTIVATE)).toBe(true);
    expect(published.some((p) => p.type === "install.stage.create")).toBe(true);

    const activate = published.find((p) => p.type === CITIZEN_PACK_DOMAIN_ACTIVATE)!;
    expect(activate.payload.domainPackKey).toBe("municipal-in-v1");
    expect(activate.payload.stageNumber).toBe(3);
    expect(activate.payload.source).toBe("install_stage_3");

    spy.mockRestore();
  });
});

describe("install Stage 3 + onboarding routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it("POST /v1/install/stages/3/domain-pack/activate returns 202", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined);
    const res = await app.inject({
      method: "POST",
      url: "/v1/install/stages/3/domain-pack/activate",
      headers: hdr(),
      payload: { domainPackKey: "municipal-in-v1" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as {
      id: string;
      status: string;
      stageNumber: number;
      domainPackKey: string;
      packKeys: string[];
    };
    expect(body.status).toBe("accepted");
    expect(body.stageNumber).toBe(3);
    expect(body.domainPackKey).toBe("municipal-in-v1");
    expect(body.packKeys.length).toBeGreaterThanOrEqual(3);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("POST /v1/install/wizards/onboarding returns 202", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined);
    const res = await app.inject({
      method: "POST",
      url: "/v1/install/wizards/onboarding",
      headers: hdr(),
      payload: {},
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { id: string; status: string };
    expect(body.status).toBe("accepted");
    expect(body.id).toBeTruthy();

    const createCall = spy.mock.calls.find((c) => c[0] === "install.wizard.create");
    expect(createCall).toBeDefined();
    const payload = createCall![1].payload as {
      name: string;
      steps: Array<{ stepKey: string; handlerType: string; sortOrder: number }>;
    };
    expect(payload.name).toBe(ONBOARDING_WIZARD_NAME);
    expect(payload.steps.some((s) => s.stepKey === STAGE3_STEP_KEY && s.handlerType === DOMAIN_PACK_ACTIVATE_HANDLER)).toBe(true);
    spy.mockRestore();
  });

  it("POST Stage 3 activate returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/install/stages/3/domain-pack/activate",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });
});
