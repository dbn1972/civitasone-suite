// EVT-2 (04-T2): the transactional outbox/inbox is now a single shared package.
// This file re-exports @civitasone/outbox so existing imports
// (`../shared/outbox.js`) keep working without touching every call site.
export * from "@civitasone/outbox";
