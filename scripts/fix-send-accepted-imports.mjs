#!/usr/bin/env node
/** Add missing sendAccepted imports to routes.ts files */
import { readFileSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(new URL("..", import.meta.url).pathname, "services");

function walk(dir, acc = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist") continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name === "routes.ts") acc.push(p);
  }
  return acc;
}

let fixed = 0;
for (const file of walk(ROOT)) {
  let s = readFileSync(file, "utf8");
  if (!s.includes("sendAccepted")) continue;
  if (s.includes('from "@civitasone/schemas/validate"') && s.includes("sendAccepted")) {
    if (!s.includes("sendAccepted }") && !s.includes("sendAccepted,")) {
      s = s.replace(
        /import \{([^}]*)\} from "@civitasone\/schemas\/validate";/,
        (m, inner) => inner.includes("sendAccepted") ? m : `import {${inner.trim()}, sendAccepted } from "@civitasone/schemas/validate";`,
      );
    }
  } else if (!s.includes("@civitasone/schemas/validate")) {
    s = `import { sendAccepted } from "@civitasone/schemas/validate";\nimport { acceptedResponseSchema } from "@civitasone/schemas/common";\n` + s;
  }
  if (!s.includes("acceptedResponseSchema")) {
    s = s.replace(
      /import \{ sendAccepted \} from "@civitasone\/schemas\/validate";\n/,
      `import { sendAccepted } from "@civitasone/schemas/validate";\nimport { acceptedResponseSchema } from "@civitasone/schemas/common";\n`,
    );
  }
  writeFileSync(file, s);
  fixed++;
}
console.log(`import fix: ${fixed} files`);
