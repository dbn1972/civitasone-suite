import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as projectModule }     from "../modules/project/schema.js";
import { schema as schemeModule }      from "../modules/scheme/schema.js";
import { schema as progressModule }    from "../modules/progress/schema.js";
import { schema as utilisationModule } from "../modules/utilisation/schema.js";
import { schema as geoModule }         from "../modules/geo/schema.js";
import { outboxSchema }                from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://project_svc:***@host/civitas_project)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: {
    ...projectModule,
    ...schemeModule,
    ...progressModule,
    ...utilisationModule,
    ...geoModule,
    ...outboxSchema,
  },
});

export type Db = typeof db;
