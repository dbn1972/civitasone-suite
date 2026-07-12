import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { schema as projectModule }     from "../modules/project/schema.js";
import { schema as schemeModule }      from "../modules/scheme/schema.js";
import { schema as progressModule }    from "../modules/progress/schema.js";
import { schema as utilisationModule } from "../modules/utilisation/schema.js";
import { schema as geoModule }         from "../modules/geo/schema.js";
import { schema as schedulingModule }  from "../modules/scheduling/schema.js";
import { baselinesSchema }             from "../modules/scheduling/baselines.js";
import { schema as boardIntakeModule } from "../modules/board-intake/schema.js";
import { outboxSchema }                from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://project_svc:***@host/civitas_project)");

export const sqlClient = createSqlClient(url);

const _rawDb = drizzle(sqlClient, {
  schema: {
    ...projectModule,
    ...schemeModule,
    ...progressModule,
    ...utilisationModule,
    ...geoModule,
    ...schedulingModule,
    ...baselinesSchema,
    ...boardIntakeModule,
    ...outboxSchema,
  },
});

export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;
