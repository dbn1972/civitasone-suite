import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { generateNACHFile, type BankFileRow } from "./bank-file-generator.js";
import { uploadBankFile } from "./sftp-egress.js";

const log = pino({ name: "finance:nach-release" });

/** Deterministic remote file name for a batch's release: a re-release overwrites the same remote file, never a second one. */
export const releaseFileName = (pfmsBatchId: string): string => `NACH_${pfmsBatchId}.txt`;

/**
 * The ONE path that turns a PFMS batch into a NACH file and hands it to the PFMS SFTP gateway. Used by the EFT-initiate
 * consumer and by the signed-batch release (GAP-FINANCE-PFMS-01). Runs OUTSIDE any DB transaction.
 *
 * `fileName` is the REMOTE name. Release passes a deterministic one (releaseFileName) so that re-sending after an
 * ambiguous acknowledgement overwrites the same remote file instead of creating a second, differently named file with
 * the same payments.
 *
 * The file carries beneficiary account data, so it never touches the shared temp directory directly: it is written (mode
 * 0600) inside a freshly created private directory (mkdtemp, mode 0700) that is unique per call, so concurrent calls
 * never clobber each other and no other local user can read or pre-create it.
 *
 * Resolves to the remote path written, or null when SFTP is not configured (nothing was sent). Rejects when the upload
 * fails. The whole private directory is always removed.
 */
export async function sendNachFile(p: { pfmsBatchId: string; agencyCode: string; rows: BankFileRow[]; fileName?: string }): Promise<string | null> {
  const content = generateNACHFile(p.rows, { originatorCode: p.agencyCode, fileSequenceNo: 1 });
  const remoteName = p.fileName ?? `NACH_${p.pfmsBatchId}_${Date.now()}.txt`;
  const dir = await mkdtemp(join(tmpdir(), "nach-"));
  try {
    const localPath = join(dir, remoteName);
    await writeFile(localPath, content, { encoding: "utf-8", mode: 0o600 });
    log.info({ pfmsBatchId: p.pfmsBatchId, fileName: remoteName }, "NACH file generated");
    return await uploadBankFile(localPath, remoteName);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
