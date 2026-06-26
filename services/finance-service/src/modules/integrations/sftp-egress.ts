/**
 * SFTP Egress Adapter — transmits government payment files (NACH/NEFT/PFMS)
 * to the PFMS SFTP gateway.
 *
 * Environment variables (all required in production):
 *   SFTP_HOST        — hostname of the PFMS SFTP gateway (e.g. sftp.pfms.gov.in)
 *   SFTP_PORT        — port number (default: 22)
 *   SFTP_USER        — SSH username
 *   SFTP_KEY_PATH    — absolute path to PEM private key file
 *   SFTP_REMOTE_DIR  — base remote directory (e.g. /upload/agency/AG001)
 *
 * When SFTP_HOST is not set the upload is skipped with a warning — safe for
 * local dev/test environments.
 *
 * // SFTP_STUB — real ssh2-sftp-client upload is compiled-in but only executed
 * when SFTP_HOST is present. Add ssh2-sftp-client to dependencies and run
 * `npm install` to enable production egress.
 */

import { readFile } from "node:fs/promises";
import { pino } from "pino";

const log = pino({ name: "finance:sftp-egress" });

/** Options controlling a single SFTP upload. */
export interface SftpUploadOptions {
  /** Absolute local path to the file to upload. */
  localPath: string;
  /** Destination filename on the remote host (basename only, no directory). */
  remoteFileName: string;
}

/** Resolved SFTP connection parameters from environment variables. */
export interface SftpConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  remoteBaseDir: string;
}

/**
 * Build the remote path: `<SFTP_REMOTE_DIR>/<YYYY-MM-DD>/<remoteFileName>`.
 * Exported for unit-testing without an SFTP connection.
 */
export function buildRemotePath(baseDir: string, remoteFileName: string, date: Date = new Date()): string {
  const iso = date.toISOString().slice(0, 10); // YYYY-MM-DD
  return `${baseDir.replace(/\/$/, "")}/${iso}/${remoteFileName}`;
}

/** Read SFTP config from environment; returns null if SFTP_HOST is absent. */
export function readSftpConfig(): SftpConfig | null {
  const host = process.env["SFTP_HOST"];
  if (!host) return null;
  const user = process.env["SFTP_USER"];
  const keyPath = process.env["SFTP_KEY_PATH"];
  const remoteDir = process.env["SFTP_REMOTE_DIR"];
  if (!user || !keyPath || !remoteDir) {
    throw new Error(
      "SFTP_HOST is set but SFTP_USER / SFTP_KEY_PATH / SFTP_REMOTE_DIR are missing — " +
        "all four must be configured together.",
    );
  }
  return {
    host,
    port: Number(process.env["SFTP_PORT"] ?? "22"),
    username: user,
    privateKeyPath: keyPath,
    remoteBaseDir: remoteDir,
  };
}

/**
 * Upload a local file to the PFMS SFTP gateway.
 *
 * Path on remote: `<SFTP_REMOTE_DIR>/<YYYY-MM-DD>/<remoteFileName>`
 *
 * Behaviour:
 *  - If `SFTP_HOST` is not set: logs a warning and resolves immediately
 *    (safe no-op for dev/test).
 *  - If `SFTP_HOST` is set but `ssh2-sftp-client` is absent from node_modules:
 *    throws a clear `MODULE_NOT_FOUND` error so CI catches the missing dep.
 *  - Otherwise: connects, mkdirs the date-prefixed path, puts the file, closes.
 *
 * @param localPath     Absolute path to the file on the local filesystem.
 * @param remoteFileName  Basename for the remote file (e.g. `NACH_20240701.txt`).
 */
export async function uploadBankFile(localPath: string, remoteFileName: string): Promise<void> {
  const cfg = readSftpConfig();
  if (!cfg) {
    log.warn({ localPath, remoteFileName }, "SFTP_HOST not set — skipping SFTP upload (dev/test mode)");
    return;
  }

  // Dynamic import so the stub compiles even when ssh2-sftp-client is absent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let SftpClient: new () => any;
  try {
    // SFTP_STUB: replace the dynamic import below with a real ssh2-sftp-client
    // once it is added to dependencies and installed.
    const mod = await import("ssh2-sftp-client" as string);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    SftpClient = (mod as { default: new () => unknown }).default;
  } catch {
    throw new Error(
      "ssh2-sftp-client is not installed. " +
        "Add it to dependencies (`npm add ssh2-sftp-client`) and reinstall before enabling SFTP egress.",
    );
  }

  const remotePath = buildRemotePath(cfg.remoteBaseDir, remoteFileName);
  const privateKey = await readFile(cfg.privateKeyPath);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const client = new SftpClient();
  try {
    log.info({ host: cfg.host, remotePath }, "Connecting to SFTP gateway");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await client.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      privateKey,
    });

    // Ensure the date-prefixed remote directory exists.
    const remoteDir = remotePath.slice(0, remotePath.lastIndexOf("/"));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await client.mkdir(remoteDir, true /* recursive */);

    log.info({ localPath, remotePath }, "Uploading bank file via SFTP");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await client.put(localPath, remotePath);

    log.info({ remotePath }, "Bank file uploaded successfully");
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await client.end();
  }
}
