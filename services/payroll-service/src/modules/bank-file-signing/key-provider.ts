/**
 * SigningKeyProvider -- resolves a plain-string `keyRef` to signing material.
 *
 *  - DevFileSigningKeyProvider (every environment except production): one JSON
 *    key file, mode 600, default `~/.civitasone-payroll-signing-key`
 *    (override: PAYROLL_SIGNING_KEY_FILE). Generated on first use ONLY if
 *    absent; never overwritten, never committed. It holds a dev OpenPGP key
 *    pair AND a dev RSA key + self-signed X.509 certificate (for xml_dsig /
 *    pkcs7_detached). Only keyRef "default" maps to it.
 *  - KeystoreSigningKeyProvider (production): HSM / keystore adapter STUB. It
 *    throws SigningKeyError("NOT_IMPLEMENTED") until UAT wires a real
 *    keystore, so production never signs with a dev key -- and, because
 *    unsigned files are refused in production, production bank-file
 *    generation fails closed until then.
 *
 * Key material never leaves this module's callers: routes only ever see
 * `status()` (present/missing + public fingerprint).
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as openpgp from "openpgp";
import forge from "node-forge";
import { isProductionProcess } from "./environment.js";
import { DEFAULT_KEY_REF } from "./types.js";

export type SigningKeyErrorCode =
  | "KEY_MISSING" | "KEY_INSECURE_PERMISSIONS" | "KEY_INVALID" | "NOT_IMPLEMENTED" | "RECIPIENT_KEY_MISSING";

export class SigningKeyError extends Error {
  constructor(public readonly code: SigningKeyErrorCode, message: string) {
    super(message);
    this.name = "SigningKeyError";
  }
}

export interface SigningMaterial {
  keyRef: string;
  /** Unencrypted armoured OpenPGP private key (pgp_detached). */
  pgpPrivateKeyArmored: string;
  /** Hex fingerprint of the OpenPGP key. */
  pgpFingerprint: string;
  /** RSA private key (PKCS#8 PEM) + certificate (PEM) for xml_dsig / pkcs7_detached. */
  rsaPrivateKeyPem: string;
  certPem: string;
  /** Hex sha256 fingerprint of the X.509 certificate. */
  certFingerprint: string;
}

export interface KeyStatus {
  provider: string;
  present: boolean;
  /** Public fingerprint only; null when the key is missing. */
  fingerprint: string | null;
  detail: string | null;
}

export interface SigningKeyProvider {
  readonly kind: string;
  status(keyRef: string): Promise<KeyStatus>;
  getSigningMaterial(keyRef: string): Promise<SigningMaterial>;
  /** The bank's OpenPGP PUBLIC key (armoured) for encrypt-to-bank. */
  getRecipientPublicKey(keyRef: string, bankCode: string | null): Promise<string>;
}

interface KeyFileV1 {
  version: 1;
  pgpPrivateKeyArmored: string;
  rsaPrivateKeyPem: string;
  certPem: string;
}

export function defaultKeyFilePath(): string {
  return process.env.PAYROLL_SIGNING_KEY_FILE ?? join(homedir(), ".civitasone-payroll-signing-key");
}

/** Generates a fresh dev key bundle (OpenPGP + RSA/X.509). Exported for tests. */
export async function generateKeyBundle(opts: { pgpType?: "ecc" | "rsa"; rsaBits?: number; pgpRsaBits?: number } = {}): Promise<KeyFileV1> {
  const pgp = await openpgp.generateKey({
    // RSA, not Curve25519: OpenPGP picks the signature hash from the signing
    // key's algorithm, and an Ed25519 key signs with SHA-512. The H2H default
    // is SHA-256 (RSA keys honour it), and signing self-checks for it.
    type: opts.pgpType ?? "rsa",
    ...(opts.pgpType === "ecc" ? {} : { rsaBits: opts.pgpRsaBits ?? 3072 }),
    userIDs: [{ name: "CivitasOne Payroll Dev Signing", email: "payroll-signing@dev.invalid" }],
    format: "armored",
  });
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: opts.rsaBits ?? 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
  cert.serialNumber = randomBytes(8).toString("hex");
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 5 * 365 * 24 * 3600 * 1000);
  const attrs = [{ name: "commonName", value: "CivitasOne Payroll Dev Signing (not for production)" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
  ]);
  cert.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create());
  return {
    version: 1,
    pgpPrivateKeyArmored: pgp.privateKey,
    rsaPrivateKeyPem: privateKey,
    certPem: forge.pki.certificateToPem(cert),
  };
}

async function materialFromBundle(keyRef: string, b: KeyFileV1): Promise<SigningMaterial> {
  try {
    const key = await openpgp.readPrivateKey({ armoredKey: b.pgpPrivateKeyArmored });
    const cert = forge.pki.certificateFromPem(b.certPem);
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const md = forge.md.sha256.create();
    md.update(der);
    return {
      keyRef,
      pgpPrivateKeyArmored: b.pgpPrivateKeyArmored,
      pgpFingerprint: key.getFingerprint(),
      rsaPrivateKeyPem: b.rsaPrivateKeyPem,
      certPem: b.certPem,
      certFingerprint: md.digest().toHex(),
    };
  } catch {
    // Never echo parser messages: they can quote key material.
    throw new SigningKeyError("KEY_INVALID", "signing key file is not a valid key bundle");
  }
}

function parseBundle(text: string): KeyFileV1 {
  try {
    const parsed = JSON.parse(text) as KeyFileV1;
    if (parsed.version !== 1 || !parsed.pgpPrivateKeyArmored || !parsed.rsaPrivateKeyPem || !parsed.certPem) throw new Error("shape");
    return parsed;
  } catch {
    throw new SigningKeyError("KEY_INVALID", "signing key file is not a valid key bundle");
  }
}

export class DevFileSigningKeyProvider implements SigningKeyProvider {
  readonly kind = "dev-file";
  constructor(private readonly path: string = defaultKeyFilePath()) {}

  private assertRef(keyRef: string): void {
    if (keyRef !== DEFAULT_KEY_REF) {
      throw new SigningKeyError("KEY_MISSING", `key reference "${keyRef}" is not available from the dev key file (only "${DEFAULT_KEY_REF}")`);
    }
  }

  private async read(): Promise<KeyFileV1 | null> {
    // One handle for every check and the read: no path-based stat/readFile
    // gap (TOCTOU). O_NOFOLLOW makes the open itself refuse a symlink.
    let handle;
    try {
      handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      if (code === "ELOOP") throw new SigningKeyError("KEY_INSECURE_PERMISSIONS", "signing key file must be a regular file (symlinks are refused)");
      throw err;
    }
    try {
      const st = await handle.stat();
      if (!st.isFile()) {
        throw new SigningKeyError("KEY_INSECURE_PERMISSIONS", "signing key file must be a regular file (symlinks are refused)");
      }
      if (typeof process.getuid === "function" && st.uid !== process.getuid()) {
        throw new SigningKeyError("KEY_INSECURE_PERMISSIONS", "signing key file must be owned by the current user");
      }
      if ((st.mode & 0o077) !== 0) {
        throw new SigningKeyError("KEY_INSECURE_PERMISSIONS", "signing key file must be mode 600 (not readable by group/others)");
      }
      const text = await handle.readFile("utf8");
      return parseBundle(text);
    } finally {
      await handle.close();
    }
  }

  /** Create the key file if (and only if) it does not exist. Mode 600. */
  async ensure(): Promise<{ created: boolean }> {
    if (await this.read()) return { created: false };
    const bundle = await generateKeyBundle();
    await mkdir(dirname(this.path), { recursive: true });
    try {
      // "wx": never overwrite a key another process created in the meantime.
      await writeFile(this.path, JSON.stringify(bundle), { mode: 0o600, flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL });
      return { created: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return { created: false };
      throw err;
    }
  }

  async status(keyRef: string): Promise<KeyStatus> {
    try {
      this.assertRef(keyRef);
      const b = await this.read();
      if (!b) return { provider: this.kind, present: false, fingerprint: null, detail: "dev key file not created yet (it is generated on the first signed bank file)" };
      const m = await materialFromBundle(keyRef, b);
      return { provider: this.kind, present: true, fingerprint: m.pgpFingerprint, detail: null };
    } catch (err) {
      if (err instanceof SigningKeyError) return { provider: this.kind, present: false, fingerprint: null, detail: err.message };
      throw err;
    }
  }

  async getSigningMaterial(keyRef: string): Promise<SigningMaterial> {
    this.assertRef(keyRef);
    await this.ensure();
    const b = await this.read();
    if (!b) throw new SigningKeyError("KEY_MISSING", "signing key could not be created");
    return materialFromBundle(keyRef, b);
  }

  async getRecipientPublicKey(_keyRef: string, bankCode: string | null): Promise<string> {
    // Dev: the bank's public key is a file <dir>/<BANKCODE>.asc.
    const dir = process.env.PAYROLL_BANK_PGP_KEYS_DIR;
    if (!dir || !bankCode || !/^[A-Z]{4}$/.test(bankCode)) {
      throw new SigningKeyError("RECIPIENT_KEY_MISSING", "no bank public key is configured for encrypt-to-bank");
    }
    try {
      return await readFile(join(dir, `${bankCode}.asc`), "utf8");
    } catch {
      throw new SigningKeyError("RECIPIENT_KEY_MISSING", `no bank public key found for ${bankCode}`);
    }
  }
}

/** Production keystore / HSM adapter -- not built until UAT. */
export class KeystoreSigningKeyProvider implements SigningKeyProvider {
  readonly kind = "keystore";
  private notImplemented(): never {
    throw new SigningKeyError("NOT_IMPLEMENTED",
      "production signing keystore/HSM adapter is not implemented yet (planned for UAT); bank files cannot be issued in production until it is wired");
  }
  async status(_keyRef: string): Promise<KeyStatus> {
    return { provider: this.kind, present: false, fingerprint: null, detail: "production keystore/HSM adapter not implemented until UAT" };
  }
  async getSigningMaterial(_keyRef: string): Promise<SigningMaterial> { return this.notImplemented(); }
  async getRecipientPublicKey(_keyRef: string, _bankCode: string | null): Promise<string> { return this.notImplemented(); }
}

let override: SigningKeyProvider | null = null;

/** Test seam. */
export function setSigningKeyProviderForTests(p: SigningKeyProvider | null): void {
  override = p;
}

export function getSigningKeyProvider(): SigningKeyProvider {
  if (override) return override;
  // Production by NODE_ENV or by the integration environment: never a dev key file.
  return isProductionProcess() ? new KeystoreSigningKeyProvider() : new DevFileSigningKeyProvider();
}
