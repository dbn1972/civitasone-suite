/**
 * SFTP Egress Adapter — transmits government payment files (NACH/NEFT/PFMS) to
 * the PFMS SFTP gateway. CAP-057: `ssh2-sftp-client` is now a real prod
 * dependency, so the egress path is compiled AND runnable in production. It
 * stays env-gated on SFTP_HOST and fail-closed: no host → skip (dev/test);
 * host but incomplete config → throw.
 *
 * Environment variables (all required together in production):
 *   SFTP_HOST        — hostname of the PFMS SFTP gateway (e.g. sftp.pfms.gov.in)
 *   SFTP_PORT        — port number (default: 22)
 *   SFTP_USER        — SSH username
 *   SFTP_KEY_PATH    — absolute path to PEM private key file
 *   SFTP_REMOTE_DIR  — base remote directory (e.g. /upload/agency/AG001)
 */

import { readFile } from "node:fs/promises";
import { pino } from "pino";

const log = pino({ name: "finance:sftp-egress" });

/** Options controlling a single SFTP upload. */
export interface SftpUploadOptions {
  localPath: string;
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
 * Minimal surface of `ssh2-sftp-client` we depend on. Declaring it here lets the
 * upload/ingest paths be unit-tested with an injected fake — no live SFTP server
 * and no real `ssh2-sftp-client` import required in tests.
 */
export interface SftpClientLike {
  connect(opts: { host: string; port: number; username: string; privateKey: Buffer }): Promise<unknown>;
  mkdir(remoteDir: string, recursive?: boolean): Promise<unknown>;
  put(localPath: string, remotePath: string): Promise<unknown>;
  list(remoteDir: string): Promise<Array<{ name: string; size: number; type: string }>>;
  get(remotePath: string, localPath: string): Promise<unknown>;
  delete(remotePath: string): Promise<unknown>;
  end(): Promise<unknown>;
}

export type SftpClientFactory = () => Promise<SftpClientLike>;

/** Default factory: lazily import the real ssh2-sftp-client (prod path). */
export const defaultSftpClientFactory: SftpClientFactory = async () => {
  try {
    const mod = (await import("ssh2-sftp-client")) as { default: new () => SftpClientLike };
    return new mod.default();
  } catch {
    throw new Error(
      "ssh2-sftp-client is not installed. It is a declared dependency; run the package install before enabling SFTP egress.",
    );
  }
};

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
 *  - `SFTP_HOST` not set → logs a warning and resolves immediately (dev/test no-op).
 *  - `SFTP_HOST` set → connects, mkdirs the date-prefixed path, puts the file.
 *
 * @param clientFactory  Injectable for tests; defaults to the real client.
 * @returns the remote path written, or null when skipped (no SFTP_HOST).
 */
export async function uploadBankFile(
  localPath: string,
  remoteFileName: string,
  clientFactory: SftpClientFactory = defaultSftpClientFactory,
): Promise<string | null> {
  const cfg = readSftpConfig();
  if (!cfg) {
    log.warn({ localPath, remoteFileName }, "SFTP_HOST not set — skipping SFTP upload (dev/test mode)");
    return null;
  }

  const remotePath = buildRemotePath(cfg.remoteBaseDir, remoteFileName);
  const privateKey = await readFile(cfg.privateKeyPath);
  const client = await clientFactory();

  try {
    log.info({ host: cfg.host, remotePath }, "Connecting to SFTP gateway");
    await client.connect({ host: cfg.host, port: cfg.port, username: cfg.username, privateKey });

    const remoteDir = remotePath.slice(0, remotePath.lastIndexOf("/"));
    await client.mkdir(remoteDir, true /* recursive */);

    log.info({ localPath, remotePath }, "Uploading bank file via SFTP");
    await client.put(localPath, remotePath);

    log.info({ remotePath }, "Bank file uploaded successfully");
    return remotePath;
  } finally {
    await client.end();
  }
}
