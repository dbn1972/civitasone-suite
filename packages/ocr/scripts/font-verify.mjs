/**
 * Pinned-digest verification + atomic install for downloaded fonts (used by fetch-fonts.mjs, unit-tested offline).
 *
 * FONT_SHA256 maps the on-disk file name to the SHA-256 (lowercase hex) of the exact bytes the pinned mirror serves.
 * A file whose name has no pinned digest (null) is REFUSED, so an unpinned font can never be installed. The digests
 * apply whether the bytes came from the default GitHub mirror or from $OCR_FONT_MIRROR.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/** @type {Record<string, string | null>} file name -> pinned SHA-256 (pinned 2026-10-05 from notofonts.github.io main; null = not recorded => refuse) */
export const FONT_SHA256 = {
  "NotoSansLatin-Regular.ttf": "478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823",
  "NotoSansDevanagari-Regular.ttf": "4e3c66638958c3e2ab5d37f47a8deb89fffeb7be9985c665a519bbc7ba762313",
  "NotoSansBengali-Regular.ttf": "b55c62ee531e3214da6c0701daecea89a52ba42db7d8206b92e6b51f397a3193",
  "NotoSansTamil-Regular.ttf": "3c0a186feb3c63c7f6d63e1511dcdc144e745ae09b98e217c83f3e317974f6f9",
  "NotoSansTelugu-Regular.ttf": "b274780b69d1d23fe84b55e809a152cb2ac5306d33864b1f87622f6971871aae",
  "NotoSansGujarati-Regular.ttf": "9b5a7aaeeb649a2e75a49d8b006a1f87db1b61c0df3b001609f4e0725d88dbf6",
  "NotoSansKannada-Regular.ttf": "9ad74dc64838c6855b96f671fc08e425a58921b9d0c71712ea79c328a27e6e38",
  "NotoSansMalayalam-Regular.ttf": "c08de7fa8d032a5d6a4d120fb82c78cec60b362a4e73fa26360d89759ff2a7f9",
  "NotoSansGurmukhi-Regular.ttf": "658d0207da305a1411c539a8b0bbeda64d4146e54fb4827facddb890b6b90d74",
  "NotoSansOdia-Regular.ttf": "a16645d056017927406546aa78e4ce15e782fd8783467267b75450453d007415",
  "NotoNaskhArabic-Regular.ttf": "6f0a92031367b2f5a2078fe9d24f3433122b61a0bad57c423aad8f3c39aa2e6e",
};

export const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

export class FontDigestError extends Error {}

/**
 * Verify `bytes` against the pinned digest for `name` and, only on a match, install them at `<dir>/<name>`.
 * The bytes are first written (flag wx, mode 0600) into a private mkdtemp staging directory, hashed from what is
 * actually on disk, and moved with an atomic rename. On any mismatch / missing pin the staging dir is deleted and
 * a FontDigestError is thrown; the final path is never touched. `pins` is injectable for tests.
 * @returns {Promise<string>} the final path
 */
export async function verifyAndInstall(dir, name, bytes, pins = FONT_SHA256) {
  if (name !== basename(name)) throw new FontDigestError(`refusing unsafe font name ${JSON.stringify(name)}`);
  const staging = await mkdtemp(join(tmpdir(), "bulk-scan-01-font-"));
  try {
    const tmp = join(staging, `${randomBytes(6).toString("hex")}.part`);
    await writeFile(tmp, bytes, { flag: "wx", mode: 0o600 });
    const want = pins[name];
    if (typeof want !== "string" || !/^[0-9a-f]{64}$/.test(want)) throw new FontDigestError(`no pinned SHA-256 for ${name}: refusing to install`);
    const got = sha256Hex(bytes);
    if (got !== want) throw new FontDigestError(`SHA-256 mismatch for ${name}: expected ${want}, got ${got}: refusing to install`);
    await mkdir(dir, { recursive: true, mode: 0o755 });
    const finalPath = join(dir, name);
    await chmod(tmp, 0o644);
    await rename(tmp, finalPath);
    return finalPath;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
