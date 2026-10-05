import { createHash } from "node:crypto";

/**
 * INTENTIONALLY WEAK, TEST-ONLY. This fixture deliberately builds an RC4 40-bit, MD5-keyed (PDF standard security
 * handler V1/R2) encrypted PDF so the tests can prove that the code under test DETECTS and REFUSES encrypted PDFs.
 * It is never used to protect data, never shipped, and every password below is a throwaway test constant.
 * (CodeQL weak-crypto / insufficient-password-hash alerts on this file are expected and accepted.)
 *
 * Builds a minimal but REAL standard-security-handler (RC4 40-bit, V1/R2) encrypted PDF, so tests exercise
 * pdfjs' own password check. pdf-lib cannot encrypt. node:crypto has no RC4 (OpenSSL 3), hence the tiny RC4.
 * userPassword "" => owner-password-only PDF: it opens without a password (pdfjs authenticates the empty user pw).
 */
const PAD = Buffer.from("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A", "hex");
const padPw = (pw: string): Buffer => Buffer.concat([Buffer.from(pw, "latin1"), PAD]).subarray(0, 32);
const md5 = (...parts: Buffer[]): Buffer => createHash("md5").update(Buffer.concat(parts)).digest();

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + (s[i] as number) + (key[i % key.length] as number)) & 255;
    [s[i], s[j]] = [s[j] as number, s[i] as number];
  }
  const out = Buffer.alloc(data.length);
  let a = 0;
  let b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 255;
    b = (b + (s[a] as number)) & 255;
    [s[a], s[b]] = [s[b] as number, s[a] as number];
    out[k] = (data[k] as number) ^ (s[(((s[a] as number) + (s[b] as number)) & 255)] as number);
  }
  return out;
}

/** Obviously fake, test-only owner password material. */
export const TEST_ONLY_OWNER_PASSWORD_NOT_A_SECRET = "TEST-ONLY-NOT-A-SECRET";

export function encryptedPdf(userPassword: string, ownerPassword = TEST_ONLY_OWNER_PASSWORD_NOT_A_SECRET): Buffer {
  const id = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const P = Buffer.alloc(4);
  P.writeInt32LE(-44);
  const O = rc4(md5(padPw(ownerPassword)).subarray(0, 5), padPw(userPassword));
  const key = md5(padPw(userPassword), O, P, id).subarray(0, 5);
  const U = rc4(key, PAD);
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>",
    `<</Filter/Standard/V 1/R 2/O <${O.toString("hex")}>/U <${U.toString("hex")}>/P -44>>`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R/Encrypt 4 0 R/ID[<${id.toString("hex")}><${id.toString("hex")}>]>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
