/**
 * CAP-057 — batch/SFTP egress + inbound ingestion tests.
 *
 * Exercises the prod egress path and the new inbound ingestion path with an
 * injected fake SFTP client — no live SFTP server, no real ssh2-sftp-client.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  uploadBankFile,
  buildRemotePath,
  readSftpConfig,
  type SftpClientLike,
} from "../src/modules/integrations/sftp-egress.js";
import { fetchInboundFiles, readInboundSftpConfig } from "../src/modules/integrations/sftp-ingest.js";

// ── A recording fake SFTP client ────────────────────────────────────────────
class FakeSftp implements SftpClientLike {
  calls: string[] = [];
  puts: Array<{ local: string; remote: string }> = [];
  gets: Array<{ remote: string; local: string }> = [];
  mkdirs: string[] = [];
  listing: Array<{ name: string; size: number; type: string }>;
  constructor(listing: Array<{ name: string; size: number; type: string }> = []) {
    this.listing = listing;
  }
  async connect() { this.calls.push("connect"); return {}; }
  async mkdir(dir: string) { this.mkdirs.push(dir); return {}; }
  async put(local: string, remote: string) { this.puts.push({ local, remote }); return {}; }
  async list() { this.calls.push("list"); return this.listing; }
  async get(remote: string, local: string) { this.gets.push({ remote, local }); return {}; }
  async delete() { return {}; }
  async end() { this.calls.push("end"); return {}; }
}

let keyPath: string;
const SAVED = { ...process.env };

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "sftp-test-"));
  keyPath = join(dir, "key.pem");
  await writeFile(keyPath, "FAKE-PEM-KEY");
});

afterEach(() => {
  for (const k of ["SFTP_HOST", "SFTP_PORT", "SFTP_USER", "SFTP_KEY_PATH", "SFTP_REMOTE_DIR", "SFTP_INBOUND_DIR"]) {
    delete process.env[k];
  }
});

afterAll(() => {
  process.env = { ...SAVED };
});

function setEgressEnv() {
  process.env.SFTP_HOST = "sftp.pfms.gov.in";
  process.env.SFTP_USER = "agency";
  process.env.SFTP_KEY_PATH = keyPath;
  process.env.SFTP_REMOTE_DIR = "/upload/agency/AG001";
}
function setInboundEnv() {
  process.env.SFTP_HOST = "sftp.pfms.gov.in";
  process.env.SFTP_USER = "agency";
  process.env.SFTP_KEY_PATH = keyPath;
  process.env.SFTP_INBOUND_DIR = "/download/agency/AG001";
}

describe("CAP-057 SFTP egress", () => {
  it("builds a date-prefixed remote path", () => {
    const p = buildRemotePath("/upload/x/", "NACH_20260701.txt", new Date("2026-07-01T10:00:00Z"));
    expect(p).toBe("/upload/x/2026-07-01/NACH_20260701.txt");
  });

  it("readSftpConfig: null without SFTP_HOST, throws when incomplete", () => {
    expect(readSftpConfig()).toBeNull();
    process.env.SFTP_HOST = "h";
    expect(() => readSftpConfig()).toThrow();
  });

  it("skips upload (returns null) when SFTP_HOST is not set", async () => {
    const fake = new FakeSftp();
    const result = await uploadBankFile("/tmp/f.txt", "f.txt", async () => fake);
    expect(result).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it("uploads via the prod path when configured (mocked client)", async () => {
    setEgressEnv();
    const fake = new FakeSftp();
    const remote = await uploadBankFile("/tmp/NACH.txt", "NACH_20260701.txt", async () => fake);
    expect(remote).toMatch(/\/upload\/agency\/AG001\/\d{4}-\d{2}-\d{2}\/NACH_20260701\.txt/);
    expect(fake.calls).toContain("connect");
    expect(fake.calls).toContain("end");
    expect(fake.mkdirs).toHaveLength(1);
    expect(fake.puts[0]?.local).toBe("/tmp/NACH.txt");
  });
});

describe("CAP-057 SFTP inbound ingestion", () => {
  it("readInboundSftpConfig: null without SFTP_HOST, throws when incomplete", () => {
    expect(readInboundSftpConfig()).toBeNull();
    process.env.SFTP_HOST = "h";
    expect(() => readInboundSftpConfig()).toThrow();
  });

  it("no-ops (returns []) when SFTP_HOST is not set", async () => {
    const files = await fetchInboundFiles({ clientFactory: async () => new FakeSftp() });
    expect(files).toEqual([]);
  });

  it("downloads matching inbound files and skips directories", async () => {
    setInboundEnv();
    const fake = new FakeSftp([
      { name: "PFMS_ACK_20260701.txt", size: 120, type: "-" },
      { name: "PFMS_ACK_20260702.txt", size: 130, type: "-" },
      { name: "RETURN_20260701.csv", size: 90, type: "-" },
      { name: "archive", size: 0, type: "d" },
    ]);
    const files = await fetchInboundFiles({ pattern: /^PFMS_ACK_/, clientFactory: async () => fake });
    expect(files.map((f) => f.remoteName)).toEqual(["PFMS_ACK_20260701.txt", "PFMS_ACK_20260702.txt"]);
    expect(files[0]?.size).toBe(120);
    expect(fake.gets).toHaveLength(2);
    expect(fake.calls).toContain("end");
  });

  it("skips path-traversal listing entries — nothing escapes localDir (SEC)", async () => {
    setInboundEnv();
    const localDir = await mkdtemp(join(tmpdir(), "sftp-inbound-"));
    const fake = new FakeSftp([
      { name: "../../etc/passwd", size: 10, type: "-" },
      { name: "../escape.txt", size: 10, type: "-" },
      { name: "sub/dir/file.txt", size: 10, type: "-" },
      { name: "..", size: 0, type: "-" },
      { name: "GOOD_ACK_20260701.txt", size: 42, type: "-" },
    ]);
    const files = await fetchInboundFiles({ localDir, clientFactory: async () => fake });
    // Only the benign flat filename is fetched; every traversal entry is skipped.
    expect(files.map((f) => f.remoteName)).toEqual(["GOOD_ACK_20260701.txt"]);
    expect(fake.gets).toHaveLength(1);
    // No download target resolves outside the sandboxed localDir.
    const root = resolve(localDir);
    for (const g of fake.gets) {
      const dest = resolve(g.local);
      expect(dest === root || dest.startsWith(root + sep)).toBe(true);
    }
  });
});
