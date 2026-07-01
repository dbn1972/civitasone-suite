#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// dead-event-detector.mjs — Unused event topic finder
//
// Reads all topics.ts files across services and builds an event topology:
//   - EVENTS objects: topics that a service PUBLISHES
//   - CONSUMED_EVENTS objects: topics that a service SUBSCRIBES to
//   - DISPATCH objects (workflow-service): cross-service command routing
//
// Reports "dead" events: published topics that no service consumes.
// Dead events aren't bugs — they're waste. Exit 0 (informational).
//
// Usage: node scripts/ci/dead-event-detector.mjs
// Exit:  always 0 (informational)
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");

// ANSI colors
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

// ── 1. Discover topics.ts files ──────────────────────────────────────────────
function discoverTopicsFiles() {
  const files = [];
  if (!existsSync(SERVICES_DIR)) return files;

  const services = readdirSync(SERVICES_DIR).filter((d) => {
    try { return d.endsWith("-service") && statSync(join(SERVICES_DIR, d)).isDirectory(); }
    catch { return false; }
  });

  for (const svc of services) {
    const topicsFile = join(SERVICES_DIR, svc, "src", "topics.ts");
    if (existsSync(topicsFile)) {
      files.push({ file: topicsFile, service: svc.replace("-service", "") });
    }
  }
  return files;
}

// ── 2. Extract topic strings from an object literal ──────────────────────────

function extractTopicStrings(source, objectName) {
  const topics = [];

  // Match: export const OBJECT_NAME = { ... } as const;
  // We look for the object and then extract all string literals
  const regex = new RegExp(
    `export\\s+const\\s+${objectName}\\s*(?::\\s*[^=]+)?=\\s*\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\}`,
    "s"
  );
  const match = source.match(regex);
  if (!match) return topics;

  const body = match[1];
  // Extract all string literal values (the topic strings)
  const stringRe = /:\s*["']([^"']+)["']/g;
  let m;
  while ((m = stringRe.exec(body)) !== null) {
    topics.push(m[1]);
  }

  return topics;
}

// Also handle Record<string, string> patterns like MODULE_CALLBACK_TOPICS
function extractRecordStrings(source) {
  const topics = [];
  // Match any object with string values that looks like a topics map
  const recordRe = /(?:CALLBACK_TOPICS|DISPATCH)\s*(?::\s*[^=]+)?\s*=\s*\{([^}]+)\}/gs;
  let match;
  while ((match = recordRe.exec(source)) !== null) {
    const body = match[1];
    const stringRe = /:\s*["']([^"']+)["']/g;
    let m;
    while ((m = stringRe.exec(body)) !== null) {
      topics.push(m[1]);
    }
  }
  return topics;
}

// ── 3. Build topology ─────────────────────────────────────────────────────────
function main() {
  const topicsFiles = discoverTopicsFiles();

  // Maps: topic -> source service(s)
  const published = new Map();   // topic -> [service, ...]
  const consumed = new Map();    // topic -> [service, ...]

  for (const { file, service } of topicsFiles) {
    const source = readFileSync(file, "utf8");

    // Published events
    const events = extractTopicStrings(source, "EVENTS");
    for (const topic of events) {
      if (!published.has(topic)) published.set(topic, []);
      published.get(topic).push(service);
    }

    // Consumed events
    const consumedEvents = extractTopicStrings(source, "CONSUMED_EVENTS");
    for (const topic of consumedEvents) {
      if (!consumed.has(topic)) consumed.set(topic, []);
      consumed.get(topic).push(service);
    }

    // DISPATCH (workflow-service dispatches commands to other services)
    const dispatched = extractTopicStrings(source, "DISPATCH");
    for (const topic of dispatched) {
      if (!consumed.has(topic)) consumed.set(topic, []);
      consumed.get(topic).push(service + " (dispatch)");
    }

    // Also pick up any CALLBACK or SDK topics
    const extras = extractRecordStrings(source);
    for (const topic of extras) {
      if (!consumed.has(topic)) consumed.set(topic, []);
      consumed.get(topic).push(service + " (callback)");
    }
  }

  // Also scan COMMANDS as consumed targets (commands are always consumed by the owning service)
  for (const { file, service } of topicsFiles) {
    const source = readFileSync(file, "utf8");
    const commands = extractTopicStrings(source, "COMMANDS");
    for (const topic of commands) {
      if (!consumed.has(topic)) consumed.set(topic, []);
      consumed.get(topic).push(service + " (self-command)");
    }
  }

  // ── 4. Compute dead events ──────────────────────────────────────────────────
  const deadEvents = [];
  for (const [topic, sources] of published) {
    // A published event is "dead" if no service consumes it AND it's not
    // referenced as a command target by any other service
    if (!consumed.has(topic)) {
      deadEvents.push({ topic, sources });
    }
  }

  // ── 5. Report ─────────────────────────────────────────────────────────────
  const totalPublished = published.size;
  const totalConsumed = consumed.size;
  const totalDead = deadEvents.length;

  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Dead Event Detector — Unused event topic finder");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  Services scanned: ${topicsFiles.length}`);
  console.log("");

  if (deadEvents.length === 0) {
    console.log(`  ${GREEN}✅ All published events have at least one consumer.${RESET}`);
  } else {
    console.log(`  ${YELLOW}⚠️  Dead events (published but never consumed):${RESET}`);
    console.log("");
    for (const { topic, sources } of deadEvents.sort((a, b) => a.topic.localeCompare(b.topic))) {
      console.log(`  ${YELLOW}●${RESET} ${topic}`);
      console.log(`    ${DIM}published by: ${sources.join(", ")}${RESET}`);
    }
    console.log("");
  }

  console.log("  ────────────────────────────────────────────────────────────");
  console.log(`  ${CYAN}Summary:${RESET} ${totalPublished} events published, ${totalConsumed} topics consumed, ${BOLD}${totalDead} dead (unused)${RESET}`);
  console.log("──────────────────────────────────────────────────────────────");

  // Always exit 0 — dead events are informational, not blocking
  process.exit(0);
}

main();
