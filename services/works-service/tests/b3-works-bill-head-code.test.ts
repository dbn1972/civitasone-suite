/** B3: works holds no chart logic; with no configured code it sends none and finance resolves the tenant template default. */
import { describe, it, expect, afterEach } from "vitest";
import { worksBillHeadCode } from "../src/modules/billing/consumer.js";

const KEY = "WORKS_FINANCE_BILL_HEAD_CODE";
const prev = process.env[KEY];
afterEach(() => { if (prev === undefined) delete process.env[KEY]; else process.env[KEY] = prev; });

describe("worksBillHeadCode", () => {
  it("is undefined when not configured (finance picks the template default), and the configured code when set", () => {
    delete process.env[KEY];
    expect(worksBillHeadCode()).toBeUndefined();
    process.env[KEY] = " 5400 ";
    expect(worksBillHeadCode()).toBe("5400");
  });
});
