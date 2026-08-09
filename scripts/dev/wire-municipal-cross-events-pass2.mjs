#!/usr/bin/env node
/** Second-pass patch: insert fee challan + submit notification where imports exist but emits missing. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SERVICES = [
  "trade", "building", "fire", "advertisement", "vendor", "roadcut", "event",
];

function patchApplications(filePath) {
  if (!existsSync(filePath)) return false;
  let c = readFileSync(filePath, "utf8");
  if (!c.includes("cross-events.js") || c.includes("await emitMunicipalFeeChallan")) return false;

  const feeVar = c.includes("feeAmountMinor") ? "feeAmountMinor" : "feeMinor";
  let depositor = "msg.actorId";
  if (c.includes("businessName")) depositor = "p.businessName";
  else if (c.includes("buildingName")) depositor = "p.buildingName";
  else if (c.includes("vendorName")) depositor = "p.vendorName";
  else if (c.includes("establishmentName")) depositor = "p.establishmentName";

  const idRef = c.includes("applicationId: p.applicationId") ? "p.applicationId" : "p.id";

  c = c.replace(
    /await enqueue\(tx, \{ topic: EVENTS\.applicationCreated[\s\S]*?\}\);\n(\s*)await writeAudit\(tx, ctxOf\(msg\), \{ action: "application\.create"/,
    (m, indent) => m.replace(
      `await writeAudit(tx, ctxOf(msg), { action: "application.create"`,
      `await emitMunicipalFeeChallan(tx, ctxOf(msg), {
${indent}  sourceRef: ${idRef === "p.applicationId" ? "p.id" : idRef},
${indent}  depositor: ${depositor},
${indent}  amountMinor: ${feeVar},
${indent}  currency: "INR",
${indent}});
${indent}await writeAudit(tx, ctxOf(msg), { action: "application.create"`,
    ),
  );

  c = c.replace(
    /await enqueue\(tx, \{ topic: EVENTS\.applicationSubmitted[\s\S]*?\}\);\n(\s*)await writeAudit\(tx, ctxOf\(msg\), \{ action: "application\.submit"/,
    (m, indent) => m.replace(
      `await writeAudit(tx, ctxOf(msg), { action: "application.submit"`,
      `await emitMunicipalNotification(tx, ctxOf(msg), {
${indent}  eventType: EVENTS.applicationSubmitted,
${indent}  recipient: msg.actorId,
${indent}  recipientId: msg.actorId,
${indent}  variables: { applicationId: ${idRef} },
${indent}});
${indent}await writeAudit(tx, ctxOf(msg), { action: "application.submit"`,
    ),
  );

  // vendor registration.create
  c = c.replace(
    /await enqueue\(tx, \{ topic: EVENTS\.registrationCreated[\s\S]*?\}\);\n(\s*)await writeAudit\(tx, ctxOf\(msg\), \{ action: "registration\.create"/,
    (m, indent) => m.replace(
      `await writeAudit(tx, ctxOf(msg), { action: "registration.create"`,
      `await emitMunicipalFeeChallan(tx, ctxOf(msg), {
${indent}  sourceRef: p.id,
${indent}  depositor: p.vendorName,
${indent}  amountMinor: feeMinor,
${indent}  currency: "INR",
${indent}});
${indent}await writeAudit(tx, ctxOf(msg), { action: "registration.create"`,
    ),
  );

  writeFileSync(filePath, c);
  return true;
}

function patchDecide(filePath) {
  if (!existsSync(filePath)) return false;
  let c = readFileSync(filePath, "utf8");
  if (!c.includes("cross-events.js") || c.includes("municipalDecisionNotificationEventType(EVENTS")) return false;

  c = c.replace(
    /await enqueue\(tx, \{ topic: EVENTS\.applicationDecided[\s\S]*?\}\);\n(\s*)await writeAudit\(tx, ctxOf\(msg\), \{ action: `application\.\$\{p\.decision\}`/,
    (m, indent) => m.replace(
      `await writeAudit(tx, ctxOf(msg), { action: \`application.\${p.decision}\``,
      `if (p.decision === "approved" || p.decision === "rejected") {
${indent}  await emitMunicipalNotification(tx, ctxOf(msg), {
${indent}    eventType: municipalDecisionNotificationEventType(EVENTS.applicationDecided, p.decision),
${indent}    recipient: msg.actorId,
${indent}    recipientId: msg.actorId,
${indent}    variables: { applicationId: p.applicationId, decision: p.decision },
${indent}  });
${indent}}
${indent}await writeAudit(tx, ctxOf(msg), { action: \`application.\${p.decision}\``,
    ),
  );
  writeFileSync(filePath, c);
  return true;
}

let n = 0;
for (const svc of SERVICES) {
  for (const [sub, fn] of [
    ["applications/consumer.ts", patchApplications],
    ["registrations/consumer.ts", patchApplications],
    ["approvals/consumer.ts", patchDecide],
    ["scrutiny/consumer.ts", patchDecide],
  ]) {
    const fp = path.join(ROOT, `services/${svc}-service/src/modules/${sub}`);
    if (fn(fp)) {
      console.log(`fixed ${svc}-service/${sub}`);
      n++;
    }
  }
}
console.log(`Second pass: ${n} files fixed.`);
