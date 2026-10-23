import { describe, it, expect } from "vitest";
import { accountLinkErrorKey, accountLinkErrorKeyFromResponse } from "./accountLinkError";

describe("accountLinkErrorKey", () => {
  it("maps only the two known 422 codes", () => {
    expect(accountLinkErrorKey(422, "ACCOUNT_INACTIVE")).toBe("inactive");
    expect(accountLinkErrorKey(422, "ACCOUNT_NOT_FOUND")).toBe("notFound");
    expect(accountLinkErrorKey(422, "MANDATORY_FIELDS_MISSING")).toBeNull();
    expect(accountLinkErrorKey(400, "ACCOUNT_INACTIVE")).toBeNull();
    expect(accountLinkErrorKey(422, undefined)).toBeNull();
  });

  it("reads the code from a response body without consuming it, and tolerates junk", async () => {
    const res = new Response(JSON.stringify({ code: "ACCOUNT_INACTIVE" }), { status: 422 });
    expect(await accountLinkErrorKeyFromResponse(res)).toBe("inactive");
    expect((await res.json()).code).toBe("ACCOUNT_INACTIVE");
    expect(await accountLinkErrorKeyFromResponse(new Response("not json", { status: 422 }))).toBeNull();
    expect(await accountLinkErrorKeyFromResponse({ status: 422 } as unknown as Response)).toBeNull();
    expect(await accountLinkErrorKeyFromResponse(new Response("{}", { status: 500 }))).toBeNull();
  });
});
