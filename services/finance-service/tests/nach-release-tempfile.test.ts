/**
 * CodeQL js/insecure-temporary-file: the NACH payment file (beneficiary account data) is written inside a private 0700
 * directory with mode 0600 and the whole directory is removed afterwards, success or failure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dirname } from "node:path";
import { stat, access } from "node:fs/promises";
import { tmpdir } from "node:os";

const seen = vi.hoisted(() => ({ local: "", remote: "", fileMode: 0, dirMode: 0, fail: false }));
vi.mock("../src/modules/integrations/sftp-egress.js", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return {
    uploadBankFile: async (local: string, remote: string) => {
      seen.local = local; seen.remote = remote;
      seen.fileMode = (await fs.stat(local)).mode & 0o777;
      seen.dirMode = (await fs.stat(path.dirname(local))).mode & 0o777;
      if (seen.fail) throw new Error("gateway down");
      return `/remote/${remote}`;
    },
  };
});

import { releaseFileName, sendNachFile } from "../src/modules/integrations/nach-release.js";

const rows = [{ ifsc: "SBIN0001234", accountNo: "123456789012", accountName: "Asha", amountMinor: 100n, narration: "n", paymentDate: "2026-10-04" }];
const exists = (p: string) => access(p).then(() => true, () => false);

describe("sendNachFile temp file handling", () => {
  beforeEach(() => { seen.fail = false; seen.local = ""; });

  it("writes mode 0600 inside a private 0700 directory under the temp dir, keeps the remote name, and removes the directory", async () => {
    const out = await sendNachFile({ pfmsBatchId: "b1", agencyCode: "AG", rows, fileName: releaseFileName("b1") });
    expect(out).toBe("/remote/NACH_b1.txt");
    expect(seen.remote).toBe("NACH_b1.txt");
    expect(seen.fileMode).toBe(0o600);
    expect(seen.dirMode).toBe(0o700);
    expect(dirname(dirname(seen.local))).toBe(tmpdir().replace(/\/$/, ""));
    expect(dirname(seen.local)).not.toBe(tmpdir());
    expect(await exists(dirname(seen.local))).toBe(false);
  });

  it("removes the directory when the upload fails, and each call gets its own directory", async () => {
    seen.fail = true;
    await expect(sendNachFile({ pfmsBatchId: "b2", agencyCode: "AG", rows })).rejects.toThrow("gateway down");
    const first = dirname(seen.local);
    expect(await exists(first)).toBe(false);
    seen.fail = false;
    await sendNachFile({ pfmsBatchId: "b2", agencyCode: "AG", rows });
    expect(dirname(seen.local)).not.toBe(first);
    expect(await exists(dirname(seen.local))).toBe(false);
  });
});
