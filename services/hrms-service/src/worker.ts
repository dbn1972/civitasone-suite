import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerEmployeeConsumers }   from "./modules/employee/consumer.js";
import { registerLeaveConsumers }      from "./modules/leave/consumer.js";
import { registerAttendanceConsumers } from "./modules/attendance/consumer.js";
import { registerRecruitmentConsumers } from "./modules/recruitment/consumer.js";
import { registerTrainingConsumers }   from "./modules/training/consumer.js";

const log = pino({ name: "hrms-worker" });

registerEmployeeConsumers(queue);
registerLeaveConsumers(queue);
registerAttendanceConsumers(queue);
registerRecruitmentConsumers(queue);
registerTrainingConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
log.info("hrms-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
