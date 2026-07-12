import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { schema as employeeModule }    from "../modules/employee/schema.js";
import { schema as recruitmentModule } from "../modules/recruitment/schema.js";
import { schema as attendanceModule }  from "../modules/attendance/schema.js";
import { schema as leaveModule }       from "../modules/leave/schema.js";
import { schema as trainingModule }    from "../modules/training/schema.js";
import { schema as lifecycleModule }   from "../modules/lifecycle/schema.js";
import { schema as serviceBookModule } from "../modules/service-book/schema.js";
import { schema as appraisalModule }   from "../modules/appraisals/schema.js";
import { aparSchema as aparModule }            from "../modules/apar/schema.js";
import { gpfModuleSchema as gpfModule }        from "../modules/gpf/schema.js";
import { schema as deputationModule }  from "../modules/deputation/schema.js";
import { schema as claimsModule }      from "../modules/claims/schema.js";
import { schema as schedulerModule }   from "../modules/scheduler/schema.js";
import { schema as disciplinaryModule } from "../modules/disciplinary/schema.js";
import { schema as reservationModule }  from "../modules/reservation/schema.js";
import { schema as medicalModule }      from "../modules/medical/schema.js";
import { schema as boardIntakeModule } from "../modules/board-intake/schema.js";
import { outboxSchema }                from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://hrms_svc:***@host/civitas_hrms)");

export const sqlClient = createSqlClient(url);

const _rawDb = drizzle(sqlClient, {
  schema: { ...employeeModule, ...recruitmentModule, ...attendanceModule, ...leaveModule, ...trainingModule, ...lifecycleModule, ...serviceBookModule, ...appraisalModule, ...aparModule, ...gpfModule, ...deputationModule, ...claimsModule, ...schedulerModule, ...disciplinaryModule, ...reservationModule, ...medicalModule, ...boardIntakeModule, ...outboxSchema },
});

export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;

/**
 * node-postgres-style adapter over the postgres-js client.
 *
 * Several modules (social, device-trust, id-cards, visiting-cards, ai-ml) issue
 * raw parameterised SQL using the classic `pg` `query(text, params)` shape that
 * returns `{ rows, rowCount }`. postgres-js instead exposes a tagged-template
 * client (`sql\`...\``) plus `sql.unsafe(text, params)` which resolves to a
 * row-list array. This thin wrapper bridges the two so the existing raw-SQL
 * handlers keep their behaviour while remaining type-safe.
 */
export const sqlPool = {
  async query<T = any>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number }> {
    const result = await sqlClient.unsafe(text, params as unknown as never[]);
    const rows = result as unknown as T[];
    const rowCount = (result as unknown as { count?: number }).count ?? rows.length;
    return { rows, rowCount };
  },
};
