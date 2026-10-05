import { afterEach, describe, expect, it } from "vitest";
import { sandboxPermitted } from "../src/providers/cloud.js";
import { AwsTextractProvider, AzureDocIntProvider, BhashiniProvider, GoogleDocAiProvider, createCloudProvider, createProvider } from "../src/providers/index.js";
import { OcrNotImplementedError } from "../src/types.js";
import { fakePage } from "./helpers.js";

const classes = [
  ["google_docai", GoogleDocAiProvider],
  ["aws_textract", AwsTextractProvider],
  ["azure_docint", AzureDocIntProvider],
  ["bhashini", BhashiniProvider],
] as const;

describe.each(classes)("cloud provider %s", (id, Cls) => {
  it("sandbox returns deterministic, flagged results derived from the input", async () => {
    const p = new Cls({ mode: "sandbox" });
    expect(p.id).toBe(id);
    expect(await p.isAvailable()).toBe(true);
    const a = await p.recognize([fakePage(1), fakePage(2)], { langs: ["eng", "hin"] });
    const b = await p.recognize([fakePage(1), fakePage(2)], { langs: ["eng", "hin"] });
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    expect(a[0]?.metadata).toMatchObject({ sandbox: true, mock: true, provider: id });
    expect(a[0]?.providerId).toBe(id);
    expect(a[0]?.text).toContain("SANDBOX MOCK");
    expect(a[0]?.text).not.toEqual(a[1]?.text); // derived from the input (page number / bytes)
    expect(a[0]?.meanConfidence).toBeGreaterThan(0.79);
    expect(a[0]?.meanConfidence).toBeLessThanOrEqual(0.97);
    const w = a[0]?.blocks[0]?.lines[0]?.words[0];
    expect(w && w.bbox.x1 > w.bbox.x0).toBe(true);
  });

  it("production mode throws OcrNotImplementedError naming the provider and reports unavailable", async () => {
    const p = new Cls({ mode: "production", endpoint: "https://example.invalid" });
    expect(await p.isAvailable()).toBe(false);
    const err = await p.recognize([fakePage(1)], { langs: ["eng"] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrNotImplementedError);
    expect((err as Error).message).toContain(id);
  });
});

describe("provider factories", () => {
  it("createCloudProvider/createProvider build the right classes", () => {
    expect(createCloudProvider("bhashini", { mode: "sandbox" })).toBeInstanceOf(BhashiniProvider);
    expect(createProvider({ id: "aws_textract", cloud: { mode: "sandbox" } })).toBeInstanceOf(AwsTextractProvider);
    expect(createProvider({ id: "tesseract" }).id).toBe("tesseract");
  });
});

describe("cloud sandbox mode is refused outside an explicit dev/test allowlist", () => {
  const prev = process.env.NODE_ENV;
  afterEach(() => { if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev; });

  it.each(["production", "staging", "prod", "Production", "", undefined])("NODE_ENV=%s: sandbox config behaves as production (unavailable + NotImplemented)", async (env) => {
    if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
    const p = new GoogleDocAiProvider({ mode: "sandbox" });
    expect(await p.isAvailable()).toBe(false);
    const err = await p.recognize([fakePage(1)], { langs: ["eng"] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrNotImplementedError);
  });

  it.each(["development", "test"])("NODE_ENV=%s allows the sandbox", async (env) => {
    process.env.NODE_ENV = env;
    const p = new GoogleDocAiProvider({ mode: "sandbox" });
    expect(await p.isAvailable()).toBe(true);
    expect(sandboxPermitted({})).toBe(true);
  });

  it("the explicit allowSandbox flag overrides the env check both ways (tests only)", async () => {
    process.env.NODE_ENV = "production";
    expect(await new BhashiniProvider({ mode: "sandbox", allowSandbox: true }).isAvailable()).toBe(true);
    process.env.NODE_ENV = "test";
    expect(await new BhashiniProvider({ mode: "sandbox", allowSandbox: false }).isAvailable()).toBe(false);
  });
});
