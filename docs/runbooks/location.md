# Runbook: location-service

> Tier 3. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.5% availability, p95 read < 200 ms (geofence checks used by attendance systems — must be fast).

- **Purpose:** geographic and organizational hierarchy management — location registry (buildings, offices, floors, rooms), administrative hierarchy (state → district → block → panchayat), jurisdiction assignment (officer-to-area mapping), geofence management (polygon-based with point-in-polygon checks for geo-attendance), pincode bulk import, geocoding, cadastral/land-records reference, infrastructure mapping, routing, and spatial queries. Owns `civitas_location`. 11 modules. Serves as a reference-data backbone consumed by many other services.

- **Owner / escalation:** primary: Data/Reference Domain Owner. Secondary: SRE. Page on geofence-check failure (geo-attendance systems depend on this).

- **Dependencies:**
  - Own Postgres DB (`civitas_location`), RLS enabled, tenant-scoped. May use PostGIS extension for spatial queries.
  - Redis — read-through cache for hierarchy lookups (frequently queried by all services for org-structure resolution), geofence polygons (preloaded for fast point-in-polygon checks).
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for location CRUD, hierarchy unit CRUD/bulk-sync, jurisdiction assign/revoke, geofence CRUD/check, pincode bulk-import; events mirroring all mutations.
  - Cross-service: hrms-service (geo-attendance uses geofence-check), all services (org-hierarchy resolution for reporting/data scoping), estab-service (facility locations), project-service (geo-tagging validation).
  - Bulk data: pincode database (18,000+ Indian pincodes), administrative hierarchy (states/districts/blocks imported in bulk). These are large imports — processed in batches.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: hierarchy depth/breadth, geofence check rate (from attendance systems), geocoding success rate, pincode coverage.
  - Alert: geofence-check latency > 100ms = WARN (attendance systems will timeout); hierarchy bulk-sync failure = WARN.

- **Common failure modes → action:**
  - *Geofence check timing out* → point-in-polygon computation for complex polygons can be expensive. Verify the geofence polygon isn't excessively detailed (thousands of vertices). Simplify the polygon if possible. The Redis cache should hold pre-computed bounding boxes for fast initial filtering.
  - *Hierarchy bulk-sync partial failure* → org-hierarchy bulk imports (from external HR systems) process in batches. If a batch fails, check for circular parent references or duplicate unit codes. The sync is resumable from the failed batch.
  - *Jurisdiction assignment conflict* → a geographic area can only be assigned to one officer at a time. If a new assignment conflicts with an existing one, the previous must be revoked first. This is correct domain behavior.
  - *Pincode import failing* → pincode bulk imports are large (18K+ records). If import fails, check for duplicate pincode entries (unique constraint violation) or malformed data (missing state/district reference).
  - *PostGIS spatial query slow* → if spatial queries are slow, verify PostGIS indexes (GiST indexes on geometry columns). Missing indexes on spatial columns cause full-table scans.
  - *Stale hierarchy in consuming services* → hierarchy changes propagate via events. If other services show stale org-structure, verify the event was published and their cache was invalidated.

- **Rollback:** redeploy previous image tag. Reference data (hierarchy, pincodes) is append-only with versioning. Geofence deletions are soft-deletes.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) rebuild the hierarchy cache in Redis (all services depend on this); (2) verify geofence polygons are intact (attendance systems need them); (3) if a bulk-sync was in progress during the gap, re-trigger from the last checkpoint.
