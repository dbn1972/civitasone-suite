import { describe, it, expect } from "vitest";
import { describeOperationsError, operationsSourceLabel } from "./operationsLabels";

describe("operationsSourceLabel (UAT b23)", () => {
  it("turns process ids into readable labels", () => {
    expect(operationsSourceLabel("finance-worker")).toBe("Finance worker");
    expect(operationsSourceLabel("gateway")).toBe("Gateway");
    expect(operationsSourceLabel("hrms-service")).toBe("HRMS service");
  });
});

describe("describeOperationsError (UAT b23)", () => {
  it("drops stack frames and shortens absolute paths", () => {
    const raw = "Error: connect ECONNREFUSED at /home/ec2-user/CivitasOne/civitasone-suite/services/finance-service/dist/db.js:42:11";
    const out = describeOperationsError(raw);
    expect(out).not.toContain("/home/");
    expect(out).toContain("ECONNREFUSED");
  });
  it("reduces node_modules paths to the package name", () => {
    const out = describeOperationsError("failed in /home/ec2-user/app/node_modules/@fastify/cors/index.js");
    expect(out).not.toContain("/home/");
    expect(out).toContain("@fastify/cors package");
  });
  it("keeps plain text unchanged and never returns empty", () => {
    expect(describeOperationsError("Queue consumer failed to start")).toBe("Queue consumer failed to start");
    expect(describeOperationsError("   at /home/x/y.js:1:2")).toBe("Error (details withheld)");
    expect(describeOperationsError("    at Object.run (/home/ec2-user/app/dist/x.js:10:5)")).toBe("Error (details withheld)");
  });
  it("keeps ordinary prose containing the word 'at'", () => {
    expect(describeOperationsError("Job failed at step 3")).toBe("Job failed at step 3");
    expect(describeOperationsError("Timed out at connect timeout")).toBe("Timed out at connect timeout");
  });
  it("strips a real frame that follows a message", () => {
    expect(describeOperationsError("TypeError: x is undefined at Object.run (/srv/app/dist/x.js:10:5)")).toBe("TypeError: x is undefined");
  });
});
