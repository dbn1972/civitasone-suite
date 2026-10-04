import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { generateNACHFile, type BankFileRow } from "./bank-file-generator.js";
import { uploadBankFile } from "./sftp-egress.js";

const log = pino({ name: "finance:nach-release" });

/**
 * The ONE path that turns a PFMS batch into a NACH file and hands it to the PFMS SFTP gateway. Used by the EFT-initiate
 * consumer and by the signed-batch release (GAP-FINANCE-PFMS-01). Runs OUTSIDE any DB transaction.
 *
 * Resolves to the remote path written, or null when SFTP is not configured (dev/test: the upload is skipped, nothing
 * was sent). Rejects when the upload fails. The temp file is always removed.
 */
export async function sendNachFile(p: { pfmsBatchId: string; agencyCode: string; rows: BankFileRow[] }): Promise<string | null> {
  const content = generateNACHFile(p.rows, { originatorCode: p.agencyCode, fileSequenceNo: 1 });
  const fileName = `NACH_${p.pfmsBatchId}_${Date.now()}.txt`;
  const localPath = join(tmpdir(), fileName);
  await writeFile(localPath, content, "utf-8");
  log.info({ pfmsBatchId: p.pfmsBatchId, fileName }, "NACH file generated");
  try {
    return await uploadBankFile(localPath, fileName);
  } finally {
    await unlink(localPath).catch(() => undefined);
  }
}
