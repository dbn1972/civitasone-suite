import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient } from "@civitasone/db";
import { schema as employeeModule }    from "../modules/employee/schema.js";
import { schema as recruitmentModule } from "../modules/recruitment/schema.js";
import { schema as attendanceModule }  from "../modules/attendance/schema.js";
import { schema as leaveModule }       from "../modules/leave/schema.js";
import { schema as trainingModule }    from "../modules/training/schema.js";
import { schema as lifecycleModule }   from "../modules/lifecycle/schema.js";
import { outboxSchema }                from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://hrms_svc:***@host/civitas_hrms)");

export const sqlClient = createSqlClient(url);

export const db = drizzle(sqlClient, {
  schema: { ...employeeModule, ...recruitmentModule, ...attendanceModule, ...leaveModule, ...trainingModule, ...lifecycleModule, ...outboxSchema },
});

export type Db = typeof db;
