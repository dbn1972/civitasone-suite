// One-shot: add @civitasone/outbox as a workspace dependency to every service
// whose shared/outbox.ts now re-exports it (EVT-2 / 04-T2).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const servicesDir = "services";
let changed = 0;
for (const svc of readdirSync(servicesDir)) {
  const pkgPath = join(servicesDir, svc, "package.json");
  const outboxPath = join(servicesDir, svc, "src/shared/outbox.ts");
  if (!existsSync(pkgPath) || !existsSync(outboxPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
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
