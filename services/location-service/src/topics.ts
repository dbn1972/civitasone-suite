/** Topic + event names owned by location-service. */
export const COMMANDS = {
  // locations
  createLocation: "location.location.create",
  // hierarchy
  unitCreate: "location.hierarchy.unit.create",
  unitUpdate: "location.hierarchy.unit.update",
  unitBulkSync: "location.hierarchy.unit.bulkSync",
  // jurisdiction
  jurisdictionAssign: "location.jurisdiction.assign",
  jurisdictionRevoke: "location.jurisdiction.revoke",
  // geofence
  geofenceCreate: "location.geofence.create",
  geofenceUpdate: "location.geofence.update",
  geofenceCheck: "location.geofence.check",
  // pincode
  pincodeBulkImport: "location.pincode.bulkImport",
} as const;

export const EVENTS = {
  // locations
  locationCreated: "location.location.created",
  // hierarchy
  unitCreated: "location.hierarchy.unit.created",
  unitUpdated: "location.hierarchy.unit.updated",
  unitBulkSynced: "location.hierarchy.unit.bulkSynced",
  // jurisdiction
  jurisdictionAssigned: "location.jurisdiction.assigned",
  jurisdictionRevoked: "location.jurisdiction.revoked",
  // geofence
  geofenceCreated: "location.geofence.created",
  geofenceUpdated: "location.geofence.updated",
  geofenceChecked: "location.geofence.checked",
  // pincode
  pincodeBulkImported: "location.pincode.bulkImported",
} as const;

export const SERVICE = "location";
export const RESOURCE = "location";

export const RESOURCES = {
  location: "location",
  unit: "unit",
  jurisdiction: "jurisdiction",
  geofence: "geofence",
  pincode: "pincode",
} as const;
