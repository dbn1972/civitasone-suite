/** Test double for the org-hierarchy (HRMS departments) client used by legal-service. */
import { setOrgClient, type OrgClient } from "../../src/shared/org-client.js";

export const TEST_DEPT_ID = "99999999-aaaa-4000-8000-0000000d1001";
export const TEST_DEPT_NAME = "Revenue Department";
export const TEST_DEPT_2_ID = "99999999-aaaa-4000-8000-0000000d1002";
export const TEST_DEPT_2_NAME = "Public Works Department";

export const fakeOrg: OrgClient = {
  async listDepartments() {
    return [
      { id: TEST_DEPT_ID, name: TEST_DEPT_NAME, code: "REV" },
      { id: TEST_DEPT_2_ID, name: TEST_DEPT_2_NAME, code: "PWD" },
    ];
  },
};

export function useFakeOrg(): void { setOrgClient(fakeOrg); }
