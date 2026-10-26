// One-shot: add @civitasone/outbox as a workspace dependency to every service
// whose shared/outbox.ts now re-exports it (EVT-2 / 04-T2).
import { readFileSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Read a file, returning undefined if it does not exist (no check-then-use race). */
function readIfExists(p) {
  try {
    return readFileSync(p, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return undefined;
    throw err;
  }
}

const servicesDir = "services";
let changed = 0;
for (const svc of readdirSync(servicesDir)) {
  const pkgPath = join(servicesDir, svc, "package.json");
  const outboxPath = join(servicesDir, svc, "src/shared/outbox.ts");
  const rawPkg = readIfExists(pkgPath);
  if (rawPkg === undefined || readIfExists(outboxPath) === undefined) continue;
  const pkg = JSON.parse(rawPkg);
  pkg.dependencies ??= {};
  if (pkg.dependencies["@civitasone/outbox"]) continue;
  if (pkg.name === "@civitasone/outbox") continue;
  pkg.dependencies["@civitasone/outbox"] = "workspace:*";
  // Keep dependencies sorted for a stable diff.
  pkg.dependencies = Object.fromEntries(
    Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  changed++;
}
console.log(`added @civitasone/outbox to ${changed} service package.json files`);
