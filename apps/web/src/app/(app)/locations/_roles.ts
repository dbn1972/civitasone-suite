/**
 * Who may WRITE each /locations register. These mirror location-service's own role sets (the service stays
 * the authority and 403s anyone else); the web only decides whether to show the manage controls.
 *   geofences       services/location-service/src/modules/geofence/routes.ts          GEOFENCE_ROLES
 *   infrastructure  services/location-service/src/modules/infrastructure/routes.ts   ADMIN
 *   jurisdictions   services/location-service/src/modules/jurisdiction/routes.ts      JURISDICTION_ROLES
 */
export const GEOFENCE_MANAGE_ROLES = ["location_user", "location_admin", "super_admin", "admin", "hr_admin"];
export const INFRASTRUCTURE_MANAGE_ROLES = ["super_admin", "location_admin", "asset_admin", "works_admin"];
export const JURISDICTION_MANAGE_ROLES = ["location_admin", "super_admin", "admin"];
