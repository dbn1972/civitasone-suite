/**
 * Minimal HRMS boundary for project-service (S8 G7): "does this employee exist
 * in this tenant". Mirrors payroll-service's verifyEmployeeExists: internal
 * service-secret call, fail closed (a throw, never a false) when HRMS cannot be
 * reached, so an outage cannot be mistaken for "no such employee".
 */
const HRMS_URL = process.env.HRMS_SERVICE_URL ?? "http://127.0.0.1:3012";

export class HrmsUnavailableError extends Error {}

export async function verifyEmployeeExists(tenantId: string, employeeId: string): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${HRMS_URL}/v1/hrms/internal/employees/${encodeURIComponent(employeeId)}/exists`, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new HrmsUnavailableError(`hrms employee existence check unreachable: ${(err as Error).message}`);
  }
  if (!res.ok) throw new HrmsUnavailableError(`hrms employee existence check failed: ${res.status}`);
  return ((await res.json()) as { exists: boolean }).exists === true;
}
