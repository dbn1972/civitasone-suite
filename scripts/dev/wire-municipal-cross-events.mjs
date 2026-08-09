#!/usr/bin/env node
/**
 * Copy shared/cross-events.ts to all municipal Sec5 services and wire
 * fee challan + notification emissions into application/registration consumers
 * and status-change handlers (approvals, permits, licences).
 *
 * Usage: node scripts/dev/wire-municipal-cross-events.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SERVICES = [
  "shop", "trade", "building", "fire", "advertisement", "vendor", "roadcut", "event",
  "refund", "sewerage", "swm", "drainage", "parks", "animal", "crematorium", "parking", "market",
];

const CROSS_EVENTS_SRC = path.join(ROOT, "services/shop-service/src/shared/cross-events.ts");
const CROSS_IMPORT =
  'import { emitMunicipalFeeChallan, emitMunicipalNotification, municipalDecisionNotificationEventType } from "../../shared/cross-events.js";';

function copyCrossEvents(service) {
  const dest = path.join(ROOT, `services/${service}-service/src/shared/cross-events.ts`);
  copyFileSync(CROSS_EVENTS_SRC, dest);
}

function ensureImport(content) {
  if (content.includes("shared/cross-events.js")) return content;
  const anchor = content.includes('from "../../shared/audit.js"')
    ? 'from "../../shared/audit.js";'
    : 'from "../../shared/outbox.js";';
  return content.replace(anchor, `${anchor}\n${CROSS_IMPORT}`);
}

function patchCreateFee(content, feeVar, depositorExpr, refExpr) {
  if (content.includes("emitMunicipalFeeChallan")) return content;
  const marker = "await writeAudit(tx, ctxOf(msg), { action: \"application.create\"";
  const altMarker = "await writeAudit(tx, ctxOf(msg), { action: \"registration.create\"";
  const insert = `
      await emitMunicipalFeeChallan(tx, ctxOf(msg), {
        sourceRef: ${refExpr},
        depositor: ${depositorExpr},
        amountMinor: ${feeVar},
        currency: "INR",
      });`;
  if (content.includes(marker)) {
    return content.replace(marker, `${insert}\n      ${marker}`);
  }
  if (content.includes(altMarker)) {
    return content.replace(altMarker, `${insert}\n      ${altMarker}`);
  }
  return content;
}

function patchSubmitNotification(content, refExpr) {
  if (content.includes('action: "application.submit"') && content.includes("emitMunicipalNotification")) {
    return content;
  }
  const patterns = [
    ['action: "application.submit"', "applicationSubmitted"],
    ['action: "registration.submit"', "registrationSubmitted"],
  ];
  for (const [auditAction] of patterns) {
    const idx = content.indexOf(`await writeAudit(tx, ctxOf(msg), { ${auditAction}`);
    if (idx === -1) continue;
    const insert = `
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: EVENTS.applicationSubmitted ?? EVENTS.registrationSubmitted,
        recipient: msg.actorId,
        recipientId: msg.actorId,
        variables: { applicationId: ${refExpr} },
      });`;
    return content.slice(0, idx) + insert + "\n      " + content.slice(idx);
  }
  return content;
}

function patchDecideNotification(content) {
  if (content.includes("municipalDecisionNotificationEventType")) return content;
  const marker = 'action: `application.${p.decision}`';
  if (!content.includes(marker)) return content;
  const insert = `
      if (p.decision === "approved" || p.decision === "rejected") {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: municipalDecisionNotificationEventType(EVENTS.applicationDecided, p.decision),
          recipient: msg.actorId,
          recipientId: msg.actorId,
          variables: { applicationId: p.applicationId, decision: p.decision },
        });
      }`;
  return content.replace(`await writeAudit(tx, ctxOf(msg), {\n        ${marker}`, `${insert}\n      await writeAudit(tx, ctxOf(msg), {\n        ${marker}`);
}

function patchPermitIssued(content, refField = "applicationId") {
  if (content.includes("emitMunicipalNotification") && content.includes("permitIssued")) return content;
  const markers = ["EVENTS.permitIssued", "EVENTS.licenceIssued", "EVENTS.nocIssued"];
  for (const m of markers) {
    if (!content.includes(m)) continue;
    const auditPatterns = [
      'action: "permit.issue"',
      'action: "licence.issue"',
      'action: "noc.issue"',
    ];
    for (const auditAction of auditPatterns) {
      const idx = content.indexOf(`await writeAudit(tx, ctxOf(msg), { ${auditAction}`);
      if (idx === -1) continue;
      const insert = `
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: ${m},
        recipient: msg.actorId,
        recipientId: msg.actorId,
        variables: { ${refField}: p.${refField} },
      });`;
      return content.slice(0, idx) + insert + "\n      " + content.slice(idx);
    }
  }
  return content;
}

function patchNoticeIssued(content) {
  if (content.includes("EVENTS.noticeIssued") && content.includes("emitMunicipalNotification")) return content;
  const idx = content.indexOf('action: "permit.notice"');
  const idx2 = content.indexOf('action: "licence.notice"');
  const pos = idx !== -1 ? idx : idx2;
  if (pos === -1) return content;
  const insert = `
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: EVENTS.noticeIssued,
        recipient: msg.actorId,
        recipientId: msg.actorId,
        variables: { noticeId: p.id },
      });`;
  return content.slice(0, pos) + insert + "\n      " + content.slice(pos);
}

function patchFile(filePath) {
  if (!existsSync(filePath)) return false;
  let content = readFileSync(filePath, "utf8");
  const before = content;
  content = ensureImport(content);

  if (filePath.includes("/applications/consumer") || filePath.includes("/registrations/consumer")) {
    if (content.includes("feeAmountMinor")) {
      content = patchCreateFee(content, "feeAmountMinor", "p.establishmentName", "p.id");
    } else if (content.includes("feeMinor")) {
      const depositor = content.includes("businessName")
        ? "p.businessName"
        : content.includes("buildingName")
          ? "p.buildingName"
          : content.includes("vendorName")
            ? "p.vendorName"
            : "msg.actorId";
      content = patchCreateFee(content, "feeMinor", depositor, "p.id");
    }
    content = patchSubmitNotification(content, "p.id");
  }

  if (filePath.includes("/approvals/consumer") || filePath.includes("/scrutiny/consumer")) {
    content = patchDecideNotification(content);
  }

  if (
    filePath.includes("/permits/consumer") ||
    filePath.includes("/licences/consumer") ||
    filePath.includes("/nocs/consumer")
  ) {
    content = patchPermitIssued(content);
    content = patchNoticeIssued(content);
  }

  if (content !== before) {
    writeFileSync(filePath, content);
    return true;
  }
  return false;
}

let copied = 0;
let patched = 0;
for (const svc of SERVICES) {
  copyCrossEvents(svc);
  copied++;
  const base = path.join(ROOT, `services/${svc}-service/src/modules`);
  for (const sub of [
    "applications/consumer.ts",
    "registrations/consumer.ts",
    "approvals/consumer.ts",
    "scrutiny/consumer.ts",
    "permits/consumer.ts",
    "licences/consumer.ts",
    "nocs/consumer.ts",
  ]) {
    const fp = path.join(base, sub);
    if (patchFile(fp)) {
      patched++;
      console.log(`patched ${svc}-service/${sub}`);
    }
  }
}
console.log(`Done: ${copied} cross-events copies, ${patched} consumer patches.`);
