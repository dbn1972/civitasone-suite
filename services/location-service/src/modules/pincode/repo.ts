import { eq, like, or } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { pincodes, type PincodeRow, type PincodeInsert, type PincodeView } from "./schema.js";
import { haversineDistance } from "../geofence/validators.js";

function toView(r: PincodeRow): PincodeView {
  return {
    id: r.id,
    pincode: r.pincode,
    postOffice: r.postOffice,
    district: r.district,
    state: r.state,
    latitude: r.latitude,
    longitude: r.longitude,
  };
}

export async function findByPincode(code: string): Promise<PincodeView[]> {
  const rows = await scopedRead((tx) => tx.select().from(pincodes)
    .where(eq(pincodes.pincode, code)));
  return rows.map(toView);
}

export async function search(query: string): Promise<PincodeView[]> {
  const pattern = `%${query}%`;
  const rows = await scopedRead((tx) => tx.select().from(pincodes)
    .where(or(
      like(pincodes.pincode, pattern),
      like(pincodes.postOffice, pattern),
      like(pincodes.district, pattern),
      like(pincodes.state, pattern),
    ))
    .limit(50));
  return rows.map(toView);
}

/** Find pincodes near a given point (within radiusKm). */
export async function findNearby(lat: number, lng: number, radiusKm: number): Promise<PincodeView[]> {
  // Load all pincodes with coordinates and filter by distance
  const rows = await scopedRead((tx) => tx.select().from(pincodes));
  const radiusMeters = radiusKm * 1000;
  return rows
    .filter((r) => r.latitude != null && r.longitude != null)
    .filter((r) => haversineDistance(lat, lng, r.latitude!, r.longitude!) <= radiusMeters)
    .map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertBatch(tx: Writer, rows: PincodeInsert[]): Promise<void> {
  if (rows.length === 0) return;
  // Insert in chunks to avoid parameter limits
  const CHUNK_SIZE = 500;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await tx.insert(pincodes).values(rows.slice(i, i + CHUNK_SIZE));
  }
}

export { toView };
