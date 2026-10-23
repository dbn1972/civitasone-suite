/**
 * project_manager can READ the DPR / escalation / beneficiary / WBS / delay
 * registers it is required to act on (DPR review + escalation actions require
 * project_manager). Previously READER_ROLES omitted it, so a PM got 403 on every
 * list before they could act. Unrelated roles stay blocked.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aa110002-1111-4000-8000-000000a10002";
const ACTOR = "aa11aaaa-1111-4000-8000-000000a1000b";
const jwt = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-pm" }, SECRET, 3600);

const PATHS = ["dprs", "escalations", "beneficiaries", "wbs", "delay-analysis"];

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/projects/<register> reader roles", () => {
  for (const p of PATHS) {
    it(`${p}: project_manager is allowed (not 403)`, async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: `/v1/projects/${p}`, headers: { authorization: `Bearer ${jwt(["project_manager"])}` } });
      await app.close();
      expect(res.statusCode).toBe(200);
    });

    it(`${p}: an unrelated role is still 403`, async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: `/v1/projects/${p}`, headers: { authorization: `Bearer ${jwt(["employee"])}` } });
      await app.close();
      expect(res.statusCode).toBe(403);
    });
  }
});
