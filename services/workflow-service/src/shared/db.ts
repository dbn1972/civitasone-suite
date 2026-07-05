import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as instancesModule } from "../modules/instances/schema.js";
import { schema as tasksModule } from "../modules/tasks/schema.js";
import { schema as definitionsModule } from "../modules/definitions/schema.js";
import { schema as historyModule } from "../modules/history/schema.js";
import { schema as delegationsModule } from "../modules/delegations/schema.js";
import { roleMembers, assignmentCursors } from "../modules/assignment/resolver.js";
import { schema as assignmentModule } from "../modules/assignment/schema.js";
import { consumerAttempts, deadLetters } from "../modules/dlq/repo.js";
import { outboxSchema } from "./outbox.js";
import { schema as messagesModule } from "../modules/messages/schema.js";
import { schema as decisionsModule } from "../modules/decisions/schema.js";
import { schema as forwardingModule } from "../modules/forwarding/schema.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://workflow_svc:***@host/civitas_workflow)");

export const sqlClient = createSqlClient(url);
export const db = drizzle(sqlClient, {
  schema: { ...instancesModule, ...tasksModule, ...definitionsModule, ...historyModule, ...delegationsModule, roleMembers, assignmentCursors, ...assignmentModule, consumerAttempts, deadLetters, ...outboxSchema, ...messagesModule, ...decisionsModule, ...forwardingModule },
});
export type Db = typeof db;
