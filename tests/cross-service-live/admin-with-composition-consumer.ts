/**
 * Test-only entrypoint for the cross-service-live module-gating test: boots the
 * real admin-service HTTP app (src/index.ts) in a process that ALSO runs the
 * composition consumers on the same in-memory queue the routes publish to. In
 * production the consumers run in src/worker.ts; the live test spawns only the
 * HTTP process, so without this the 202 enforcement-mode command is never
 * consumed. No behaviour of the service itself is changed.
 */
void (async () => {
  const { queue } = await import("../../services/admin-service/src/shared/infra.js");
  const { registerCompositionConsumers } = await import("../../services/admin-service/src/modules/composition/consumer.js");
  registerCompositionConsumers(queue);
  await queue.start();
  await import("../../services/admin-service/src/index.js");
})();
