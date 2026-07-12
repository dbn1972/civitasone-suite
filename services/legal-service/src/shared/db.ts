import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { schema as casesModule } from "../modules/cases/schema.js";
import { schema as hearingsModule } from "../modules/hearings/schema.js";
import { schema as noticesModule } from "../modules/notices/schema.js";
import { schema as contractsModule } from "../modules/contracts/schema.js";
import { schema as settlementsModule } from "../modules/settlements/schema.js";
import { schema as opinionsModule } from "../modules/opinions/schema.js";
import { schema as counselModule } from "../modules/counsel/schema.js";
import { schema as filingsModule } from "../modules/filings/schema.js";
import { schema as remindersModule } from "../modules/reminders/schema.js";
import { syncSchema } from "../modules/ecourts/sync-schema.js";
import { schema as documentsModule } from "../modules/documents/schema.js";
import { schema as limitationsModule } from "../modules/limitations/schema.js";
import { schema as boardIntakeModule } from "../modules/board-intake/schema.js";
import { outboxSchema } from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://legal_svc:***@host/civitas_legal)");

export const sqlClient = createSqlClient(url);
const _rawDb = drizzle(sqlClient, {
  schema: { ...casesModule, ...hearingsModule, ...noticesModule, ...contractsModule, ...settlementsModule, ...opinionsModule, ...counselModule, ...filingsModule, ...remindersModule, ...syncSchema, ...documentsModule, ...limitationsModule, ...boardIntakeModule, ...outboxSchema },
});
export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;
