import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { mapInsuranceResponse, type MedicalInsurance } from "./insuranceTypes";

/**
 * Server-side read of one employee's medical insurance. A 404 is a real
 * answer ("no record on file"), returned as `data: null, source: "api"` --
 * never mixed up with a failed read (`source: "error"`), which the card shows
 * as "unavailable".
 */
export async function getMedicalInsurance(employeeId: string): Promise<LoaderResult<MedicalInsurance | null>> {
  const result = await fetchJson<unknown, MedicalInsurance | null>(
    `/api/v1/hrms/medical/insurance?employeeId=${encodeURIComponent(employeeId)}`,
    null,
    { telemetryKey: "hr.medical.insurance", mapResponse: mapInsuranceResponse },
  );
  if (result.source === "error" && result.status === 404) return { data: null, source: "api", status: 404 };
  return result;
}
