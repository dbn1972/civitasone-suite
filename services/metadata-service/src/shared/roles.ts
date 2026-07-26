/** Roles permitted to change metadata *schema* (entities, fields, layouts, formulas, compositions). */
export const ADMIN = ["super_admin", "platform_admin", "metadata_admin"];

/** Roles permitted to read/write master-data *records* (broader than schema admins). */
export const DATA = ["super_admin", "platform_admin", "metadata_admin", "metadata_user"];
