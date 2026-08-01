/**
 * Account hierarchy extension — adds parentId column reference.
 * The actual column is added via migration 0020_account_hierarchy.sql.
 * We reference the accounts table from contacts/schema with a type extension
 * since we cannot modify the existing schema.ts file.
 */
export { accounts, crmSchema } from "../contacts/schema.js";
