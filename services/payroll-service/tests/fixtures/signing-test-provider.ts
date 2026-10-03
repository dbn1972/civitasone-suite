/**
 * Test double for the SigningKeyProvider: one in-memory key bundle (generated
 * at test runtime -- no key material is committed) plus an optional "bank"
 * OpenPGP key pair for the encrypt-to-bank path.
 */
import * as openpgp from "openpgp";
import {
  generateKeyBundle, type KeyStatus, type SigningKeyProvider, type SigningMaterial, SigningKeyError,
} from "../../src/modules/bank-file-signing/key-provider.js";
import forge from "node-forge";

export interface TestProvider extends SigningKeyProvider {
  material: SigningMaterial;
  bank: { publicKey: string; privateKey: string } | null;
}

export async function makeTestProvider(opts: { withBankKey?: boolean } = {}): Promise<TestProvider> {
  const b = await generateKeyBundle({ pgpRsaBits: 2048 });
  const key = await openpgp.readPrivateKey({ armoredKey: b.pgpPrivateKeyArmored });
  const cert = forge.pki.certificateFromPem(b.certPem);
  const md = forge.md.sha256.create();
  md.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
  const material: SigningMaterial = {
    keyRef: "default",
    pgpPrivateKeyArmored: b.pgpPrivateKeyArmored,
    pgpFingerprint: key.getFingerprint(),
    rsaPrivateKeyPem: b.rsaPrivateKeyPem,
    certPem: b.certPem,
    certFingerprint: md.digest().toHex(),
  };
  const bank = opts.withBankKey
    ? await openpgp.generateKey({ type: "rsa", rsaBits: 2048, userIDs: [{ name: "Test Bank H2H", email: "h2h@bank.invalid" }], format: "armored" })
    : null;
  return {
    kind: "test",
    material,
    bank: bank ? { publicKey: bank.publicKey, privateKey: bank.privateKey } : null,
    async status(): Promise<KeyStatus> {
      return { provider: "test", present: true, fingerprint: material.pgpFingerprint, detail: null };
    },
    async getSigningMaterial() { return material; },
    async getRecipientPublicKey() {
      if (!bank) throw new SigningKeyError("RECIPIENT_KEY_MISSING", "no bank public key");
      return bank.publicKey;
    },
  };
}
