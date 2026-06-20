#!/usr/bin/env node
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

let count = 0;
for (const file of walk(ROOT)) {
  let s = readFileSync(file, "utf8");
  if (!s.includes("reply.code(202)") || s.includes("sendAccepted")) continue;

  if (!s.includes("sendAccepted")) {
    const importBlock = `import { sendAccepted } from "@civitasone/schemas/validate";\nimport { acceptedResponseSchema } from "@civitasone/schemas/common";\n`;
    if (!s.includes("@civitasone/schemas/validate")) {
      s = importBlock + s;
    }
    const next = s.replace(
      /return reply\.code\(202\)\.send\(([^;]+)\);/g,
      "return sendAccepted(reply, acceptedResponseSchema, $1);",
    );
    if (next !== s) {
      writeFileSync(file, next);
      count += 1;
      console.log(file.replace(ROOT + "/", ""));
    }
  }
}
console.log(`sendAccepted: ${count} files`);
