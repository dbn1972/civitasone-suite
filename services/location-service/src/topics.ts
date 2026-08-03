/** Topic + event names owned by location-service. */
export const COMMANDS = {
  // locations
  createLocation: "location.location.create",
  // hierarchy
  unitCreate: "location.hierarchy.unit.create",
  unitUpdate: "location.hierarchy.unit.update",
  unitBulkSync: "location.hierarchy.unit.bulk_sync",
  // jurisdiction
  jurisdictionAssign: "location.jurisdiction.assign",
  jurisdictionRevoke: "location.jurisdiction.revoke",
  // geofence
  geofenceCreate: "location.geofence.create",
  geofenceUpdate: "location.geofence.update",
  geofenceCheck: "location.geofence.check",
  // pincode
  pincodeBulkImport: "location.pincode.bulk_import",
  // map-layers
  mapLayerCreate: "location.map_layer.create",
  mapLayerUpdate: "location.map_layer.update",
  mapLayerDelete: "location.map_layer.delete",
  // F3 leftover — road-network / map-markers / spatial-exchange
  roadSegmentCreate: "location.road_network.segment.create",
  roadSegmentDelete: "location.road_network.segment.delete",
  roadNetworkCreate: "location.road_network.network.create",
  geoPointRegister: "location.geo_point.register",
  spatialImport: "location.spatial_exchange.import",
} as const;

export const EVENTS = {
  // locations
  locationCreated: "location.location.created",
  // hierarchy
  unitCreated: "location.hierarchy.unit.created",
  unitUpdated: "location.hierarchy.unit.updated",
  unitBulkSynced: "location.hierarchy.unit.bulk_synced",
  // jurisdiction
  jurisdictionAssigned: "location.jurisdiction.assigned",
  jurisdictionRevoked: "location.jurisdiction.revoked",
  // geofence
  geofenceCreated: "location.geofence.created",
  geofenceUpdated: "location.geofence.updated",
  geofenceChecked: "location.geofence.checked",
  // pincode
  pincodeBulkImported: "location.pincode.bulk_imported",
  // map-layers
  mapLayerCreated: "location.map_layer.created",
  mapLayerUpdated: "location.map_layer.updated",
  mapLayerDeleted: "location.map_layer.deleted",
} as const;

export const SERVICE = "location";
export const RESOURCE = "location";

export const RESOURCES = {
  location: "location",
  unit: "unit",
  jurisdiction: "jurisdiction",
  geofence: "geofence",
  pincode: "pincode",
  mapLayer: "map_layer",
} as const;
