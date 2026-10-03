/**
 * Dev ops CLI: create the dev payroll bank-file signing key IF (AND ONLY IF)
 * it does not exist yet. See docs/BANK-FILE-SIGNING.md.
 *
 * Run in the payroll-service package directory:
 *
 *   pnpm signing:init-dev-key
 *
 * Writes ~/.civitasone-payroll-signing-key (override: PAYROLL_SIGNING_KEY_FILE)
 * with mode 600. Never overwrites an existing file and never prints key
 * material. Refuses to run when NODE_ENV=production (production keys come
 * from the keystore/HSM adapter, not a file).
 */
import { DevFileSigningKeyProvider, defaultKeyFilePath } from "../modules/bank-file-signing/key-provider.js";

async function main(): Promise<void> {
  if ((process.env.NODE_ENV ?? "") === "production") {
    process.stderr.write("refusing to create a dev signing key file when NODE_ENV=production\n");
    process.exit(2);
  }
  const path = defaultKeyFilePath();
  const { created } = await new DevFileSigningKeyProvider(path).ensure();
  process.stdout.write(created ? `created ${path} (mode 600)\n` : `already exists, left untouched: ${path}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`failed: ${err instanceof Error ? err.message : "unknown error"}\n`);
  process.exit(1);
});
