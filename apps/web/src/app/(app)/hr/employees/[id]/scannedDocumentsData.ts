import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { hrScannedDocumentsPath, mapHrScannedDocuments, type HrScannedDocument } from "@/lib/hr/scannedDocuments";

/**
 * GAP-ADMIN-BULK-SCAN-02: scanned records filed to this employee (masked metadata only). A failed load is
 * source:"error" -- never an empty list. Roles: hrms-service gates this read to the employee-admin roles.
 */
export async function getEmployeeScannedDocuments(employeeId: string): Promise<LoaderResult<HrScannedDocument[]>> {
  const r = await fetchJson<unknown, HrScannedDocument[]>(hrScannedDocumentsPath(employeeId), [], {
    telemetryKey: "hr.employee.scanned-documents",
    mapResponse: mapHrScannedDocuments,
  });
  // Defensive: never hand a non-array to the view helper.
  return Array.isArray(r.data) ? r : { ...r, data: [] };
}
