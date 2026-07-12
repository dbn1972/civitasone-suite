import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { schema as indentModule }   from "../modules/indent/schema.js";
import { schema as vendorModule }   from "../modules/vendor/schema.js";
import { schema as poModule }       from "../modules/po/schema.js";
import { schema as grnModule }      from "../modules/grn/schema.js";
import { schema as rfqModule }      from "../modules/rfq/schema.js";
import { schema as tenderModule }   from "../modules/tender/schema.js";
import { schema as auctionModule }  from "../modules/auction/schema.js";
import { schema as paymentsModule } from "../modules/payments/schema.js";
import { schema as blacklistModule } from "../modules/vendor-blacklist/schema.js";
import { schema as threeWayModule }  from "../modules/three-way-match/schema.js";
import { schema as securityModule }  from "../modules/security/schema.js";
import { schema as resolutionIntakeModule } from "../modules/resolution-intake/schema.js";
import { docCountersSchema }         from "./numbering.js";
import { outboxSchema }             from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://procurement_svc:***@host/civitas_procurement)");

export const sqlClient = createSqlClient(url);

const _rawDb = drizzle(sqlClient, {
  schema: {
    ...indentModule,
    ...vendorModule,
    ...poModule,
    ...grnModule,
    ...rfqModule,
    ...tenderModule,
    ...auctionModule,
    ...paymentsModule,
    ...blacklistModule,
    ...threeWayModule,
    ...securityModule,
    ...resolutionIntakeModule,
    ...docCountersSchema,
    ...outboxSchema,
  },
});

export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;
