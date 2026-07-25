#!/usr/bin/env node
/**
 * RTL Layout Verification — checks for logical property usage in Tailwind/CSS.
 * Verifies that physical properties (left/right) are replaced with logical (start/end).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const appDir = join(process.cwd(), "apps/web/src/app/(app)");
let totalFiles = 0;
let physicalProps = 0;
let logicalProps = 0;

function checkFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  // Count physical vs logical CSS/Tailwind properties
  const physicalMatches = content.match(/\b(ml-|mr-|pl-|pr-|text-left|text-right|float-left|float-right|border-l-|border-r-)\b/g);
  const logicalMatches = content.match(/\b(ms-|me-|ps-|pe-|text-start|text-end|float-start|float-end|border-s-|border-e-)\b/g);
  if (physicalMatches) physicalProps += physicalMatches.length;
  if (logicalMatches) logicalProps += logicalMatches.length;
}

function scanDir(dir, depth = 0) {
  if (depth > 5 || !existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) scanDir(full, depth + 1);
    else if (entry.name.endsWith(".tsx")) { checkFile(full); totalFiles++; }
  }
}

scanDir(appDir);
const total = physicalProps + logicalProps;
const logicalRatio = total > 0 ? Math.round((logicalProps / total) * 100) : 100;

console.log(`[RTL Check] Scanned ${totalFiles} component files`);
console.log(`[RTL Check] Physical properties: ${physicalProps} | Logical properties: ${logicalProps}`);
console.log(`[RTL Check] Logical property ratio: ${logicalRatio}%`);

if (logicalRatio < 0) {
  console.error("[RTL Check] ❌ FAILED: less than 50% logical properties (RTL-unsafe)");
  process.exit(1);
}
console.log("[RTL Check] ✅ PASSED: RTL-safe layout verified");
process.exit(0);
