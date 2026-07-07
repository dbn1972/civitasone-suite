// Transactional outbox/inbox via shared package.
// This file re-exports @civitasone/outbox so existing imports
// (`../shared/outbox.js`) keep working without touching every call site.
export * from "@civitasone/outbox";
