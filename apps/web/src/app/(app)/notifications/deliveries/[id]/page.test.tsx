import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));

// Capture the props the server wrapper passes into the client component.
const captured: { canResend?: boolean; canSeeTechnicalDetail?: boolean } = {};
vi.mock("./DeliveryDetail", () => ({
  DeliveryDetail: (props: { canResend: boolean; canSeeTechnicalDetail: boolean }) => {
    captured.canResend = props.canResend;
    captured.canSeeTechnicalDetail = props.canSeeTechnicalDetail;
    return null;
  },
}));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "u-1", roles }) });
}

import DeliveryDetailPage from "./page";

describe("DeliveryDetailPage role capabilities", () => {
  beforeEach(() => {
    mockGet.mockReset();
    captured.canResend = undefined;
    captured.canSeeTechnicalDetail = undefined;
  });

  it("grants resend + technical detail to a notification_admin", () => {
    sessionWithRoles(["notification_admin"]);
    render(DeliveryDetailPage());
    expect(captured.canResend).toBe(true);
    expect(captured.canSeeTechnicalDetail).toBe(true);
  });

  // audit_officer may read (deliveries/layout admits it) but may NOT send and
  // is NOT an admin, so neither resend nor raw technical detail is offered.
  it("denies resend + technical detail to an audit_officer", () => {
    sessionWithRoles(["audit_officer"]);
    render(DeliveryDetailPage());
    expect(captured.canResend).toBe(false);
    expect(captured.canSeeTechnicalDetail).toBe(false);
  });
});
