/**
 * Actor id the platform itself uses for events published by schedulers, workers and webhooks.
 * Mirrors SYSTEM_ACTOR_ID in packages/outbox (@civitasone/outbox), which is a server-side package
 * the browser bundle does not import -- keep the two values identical.
 */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-0000000000c9";
