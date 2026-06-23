import { buildApp } from "./app.js";
import { startHearingReminderCron } from "./cron/hearing-reminders.js";

const app = await buildApp();
startHearingReminderCron();
const port = Number(process.env.PORT ?? 3021);
await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info({ port }, "legal-service listening");
