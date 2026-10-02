/**
 * P0 security — DSC keystore passphrase / P12 must never be plaintext on the
 * queue, in the read cache or in object storage; decrypted only at signing.
 *
 * Unit-level (infra mocked). The real-Postgres half (stored column value,
 * consumer, DB CHECK, backfill) is dsc-passphrase-encryption-real-db.test.ts.
 *
 * Uses a REAL self-signed PKCS#12 fixture (tests/fixtures/dsc-test-signer.p12,
 * generated with node-forge, passphrase below, valid until 2099) and the REAL
 * @civitasone/render signer, so "signing still works" is proven end to end.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { signToken } from "@civitasone/auth";

const FIXTURE_P12 = readFileSync(join(__dirname, "fixtures", "dsc-test-signer.p12"));
// Test-only: passphrase of the self-signed, throwaway PKCS#12 fixture above
// (generated with node-forge for these tests; signs nothing real).
const FIXTURE_PASS = "fixture-pass-not-a-real-secret"; // gitleaks:allow

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000d5";
const UUID = "aaaaaaaa-bbbb-4000-8000-0000000000d5";
const adminToken = () => signToken({ sub: UUID, tid: TENANT, roles: ["payroll_admin"], sid: "s1" }, SECRET);

const H = vi.hoisted(() => ({
  findByTenantId: vi.fn(),
  putObject: vi.fn(async (_k: string, _b: Buffer, _ct: string) => undefined),
  getObject: vi.fn(async (_k: string): Promise<Buffer> => Buffer.alloc(0)),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: vi.fn() },
  scopedRead: vi.fn(),
  sqlClient: { end: vi.fn() },
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: vi.fn(async (_k: string, fn: () => unknown) => fn()),
    makeKey: vi.fn((...a: string[]) => a.join(":")),
    invalidate: vi.fn(),
  },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(), markProcessed: vi.fn(() => true), outboxMessages: {}, processed: {}, outboxSchema: {},
}));
vi.mock("../src/modules/tax/config.js", () => ({ loadTaxConfig: vi.fn() }));
vi.mock("@civitasone/storage", () => ({
  putObject: (k: string, b: Buffer, ct: string) => H.putObject(k, b, ct),
  getObject: (k: string) => H.getObject(k),
  deleteObject: vi.fn(async () => undefined),
}));
vi.mock("../src/modules/dsc-config/repo.js", () => ({
  findByTenantId: (...a: unknown[]) => H.findByTenantId(...a),
  upsert: vi.fn(),
  remove: vi.fn(),
}));

import { signPdfWithDsc } from "@civitasone/render";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import {
  assertPiiKeyAtBoot, assertPiiKeyConfigured, PiiDecryptError, requiresPiiKeyAtBoot, resetPiiKeyCache,
} from "../src/shared/pii-crypto.js";
import {
  isSealed, isSealedP12, openDscPassphrase, openP12, sealDscPassphrase, sealP12,
} from "../src/modules/dsc-config/secret.js";
import { loadDsc } from "../src/modules/dsc-config/loader.js";

afterAll(async () => { await sqlClient.end(); });

function minimalPdf(): Buffer {
  return Buffer.from([
    "%PDF-1.7",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj",
    "xref", "0 4", "0000000000 65535 f ", "0000000009 00000 n ", "0000000058 00000 n ",
    "0000000115 00000 n ", "trailer<</Size 4/Root 1 0 R>>", "startxref", "190", "%%EOF",
  ].join("\n"), "utf-8");
}

beforeEach(() => {
  vi.clearAllMocks();
  H.findByTenantId.mockResolvedValue(null);
});

describe("secret.ts — reuses the pii-crypto AES-256-GCM envelope", () => {
  it("passphrase round-trips and the sealed form contains no plaintext", () => {
    const sealed = sealDscPassphrase(FIXTURE_PASS);
    expect(sealed.startsWith("enc:v2:k1:")).toBe(true);
    expect(sealed).not.toContain(FIXTURE_PASS);
    expect(isSealed(sealed)).toBe(true);
    expect(openDscPassphrase(sealed)).toBe(FIXTURE_PASS);
    // fresh IV per seal
    expect(sealDscPassphrase(FIXTURE_PASS)).not.toBe(sealed);
  });

  it("P12 keystore round-trips; sealed blob is not the raw DER", () => {
    const sealed = sealP12(FIXTURE_P12);
    expect(isSealedP12(sealed)).toBe(true);
    expect(isSealedP12(FIXTURE_P12)).toBe(false);
    expect(sealed.includes(FIXTURE_P12.subarray(0, 64))).toBe(false);
    expect(openP12(sealed).equals(FIXTURE_P12)).toBe(true);
  });

  it("legacy plaintext passphrase / raw P12 pass through (rollout compatibility)", () => {
    expect(openDscPassphrase("legacy-plain")).toBe("legacy-plain");
    expect(openP12(FIXTURE_P12).equals(FIXTURE_P12)).toBe(true);
  });

  it("a tampered envelope fails closed with PiiDecryptError that carries no secret", () => {
    const sealed = sealDscPassphrase(FIXTURE_PASS);
    const tampered = sealed.slice(0, -4) + (sealed.endsWith("AAAA") ? "BBBB" : "AAAA");
    let caught: unknown;
    try { openDscPassphrase(tampered); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(PiiDecryptError);
    expect(String((caught as Error).message)).not.toContain(FIXTURE_PASS);
  });
});

describe("PUT /v1/payroll/dsc-config — nothing secret leaves the route in plaintext", () => {
  it("the queue payload carries only the sealed passphrase; the stored P12 is sealed", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { p12Base64: FIXTURE_P12.toString("base64"), passphrase: FIXTURE_PASS },
    });
    await app.close();
    expect(res.statusCode).toBe(202);

    // Queue message: no plaintext anywhere in the whole envelope.
    expect(queue.publish).toHaveBeenCalledOnce();
    const published = vi.mocked(queue.publish).mock.calls[0]![1] as { payload: Record<string, unknown> };
    const wire = JSON.stringify(published);
    expect(wire).not.toContain(FIXTURE_PASS);
    expect(published.payload).not.toHaveProperty("passphrase");
    const sealed = published.payload.passphraseSealed as string;
    expect(isSealed(sealed)).toBe(true);
    expect(openDscPassphrase(sealed)).toBe(FIXTURE_PASS);

    // Object storage: sealed, never the raw keystore.
    expect(H.putObject).toHaveBeenCalledOnce();
    const [, body] = H.putObject.mock.calls[0]!;
    expect(isSealedP12(body)).toBe(true);
    expect(body.includes(FIXTURE_P12.subarray(0, 64))).toBe(false);
    expect(openP12(body).equals(FIXTURE_P12)).toBe(true);
  });
});

describe("fail closed when PII_ENC_KEY is missing", () => {
  const saved = process.env.PII_ENC_KEY;
  afterEach(() => {
    process.env.PII_ENC_KEY = saved;
    resetPiiKeyCache();
  });

  it("seal + boot assertion throw, and the route publishes/uploads nothing", async () => {
    delete process.env.PII_ENC_KEY;
    resetPiiKeyCache();

    expect(() => sealDscPassphrase("x")).toThrow(/PII_ENC_KEY is required/);
    expect(() => assertPiiKeyConfigured()).toThrow(/PII_ENC_KEY is required/);

    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { p12Base64: FIXTURE_P12.toString("base64"), passphrase: FIXTURE_PASS },
    });
    await app.close();
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(FIXTURE_PASS);
    expect(queue.publish).not.toHaveBeenCalled();
    expect(H.putObject).not.toHaveBeenCalled();
  });

  it("boot check follows ecosystem.config.js: only development/test may boot without the key", () => {
    expect(requiresPiiKeyAtBoot({ NODE_ENV: "development" })).toBe(false);
    expect(requiresPiiKeyAtBoot({ NODE_ENV: "test" })).toBe(false);
    for (const NODE_ENV of ["production", "staging", "uat", "preprod", ""]) {
      expect(requiresPiiKeyAtBoot({ NODE_ENV })).toBe(true);
    }
    expect(requiresPiiKeyAtBoot({})).toBe(true); // NODE_ENV unset
    delete process.env.PII_ENC_KEY;
    resetPiiKeyCache();
    expect(() => assertPiiKeyAtBoot({ NODE_ENV: "staging" })).toThrow(/PII_ENC_KEY is required/);
    expect(() => assertPiiKeyAtBoot({})).toThrow(/PII_ENC_KEY is required/);
    expect(() => assertPiiKeyAtBoot({ NODE_ENV: "test" })).not.toThrow();
  });

  it("opening a sealed passphrase without the key throws instead of returning ciphertext", () => {
    const sealed = sealDscPassphrase(FIXTURE_PASS);
    delete process.env.PII_ENC_KEY;
    resetPiiKeyCache();
    expect(() => openDscPassphrase(sealed)).toThrow(/PII_ENC_KEY is required/);
  });
});

describe("loader decrypts only at the moment of use — signing still works", () => {
  function row(passphraseSealed: string) {
    return {
      tenantId: TENANT, storageRef: `dsc/${TENANT}/signing.p12`, passphraseSealed,
      subjectCn: "DSC Test Fixture Signer", serialNumber: "0d5c",
      notBefore: new Date("2025-01-01"), notAfter: new Date("2099-12-31"), sha256Fingerprint: "x",
      createdAt: new Date(), updatedAt: new Date(), createdBy: UUID, updatedBy: UUID,
    };
  }

  it("sealed row + sealed P12 -> real PDF signature", async () => {
    H.findByTenantId.mockResolvedValue(row(sealDscPassphrase(FIXTURE_PASS)));
    H.getObject.mockResolvedValue(sealP12(FIXTURE_P12));

    const material = await loadDsc(TENANT);
    expect(material).not.toBeNull();
    expect(material!.passphrase).toBe(FIXTURE_PASS);
    expect(material!.p12Buffer.equals(FIXTURE_P12)).toBe(true);
    expect(material!.certInfo.subjectCN).toBe("DSC Test Fixture Signer");

    const signed = await signPdfWithDsc(minimalPdf(), {
      p12Buffer: material!.p12Buffer, passphrase: material!.passphrase,
    });
    expect(signed.buffer.length).toBeGreaterThan(minimalPdf().length);
    expect(signed.buffer.toString("latin1")).toContain("/ByteRange");
  });

  it("DSC_ALLOW_LEGACY_UNSEALED=false refuses a legacy plaintext secret but still loads sealed ones", async () => {
    process.env.DSC_ALLOW_LEGACY_UNSEALED = "false";
    try {
      H.findByTenantId.mockResolvedValue(row(FIXTURE_PASS));
      H.getObject.mockResolvedValue(FIXTURE_P12);
      await expect(loadDsc(TENANT)).rejects.toThrow(/DSC_ALLOW_LEGACY_UNSEALED=false/);

      H.findByTenantId.mockResolvedValue(row(sealDscPassphrase(FIXTURE_PASS)));
      H.getObject.mockResolvedValue(sealP12(FIXTURE_P12));
      expect((await loadDsc(TENANT))!.passphrase).toBe(FIXTURE_PASS);
    } finally {
      delete process.env.DSC_ALLOW_LEGACY_UNSEALED;
    }
  });

  it("legacy plaintext row + raw P12 (pre-backfill) still signs", async () => {
    H.findByTenantId.mockResolvedValue(row(FIXTURE_PASS));
    H.getObject.mockResolvedValue(FIXTURE_P12);
    const material = await loadDsc(TENANT);
    expect(material!.passphrase).toBe(FIXTURE_PASS);
    const signed = await signPdfWithDsc(minimalPdf(), {
      p12Buffer: material!.p12Buffer, passphrase: material!.passphrase,
    });
    expect(signed.buffer.toString("latin1")).toContain("/ByteRange");
  });
});
