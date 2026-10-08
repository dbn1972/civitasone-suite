import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

import { RatesProductPicker } from "./RatesProductPicker";

const PRODUCT = "11111111-2222-4333-8444-000000000001";

function stubFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/catalogue/products")) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: PRODUCT, name: "Birth Certificate", code: "BC" }] }), { status: 200 }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
}

describe("GAP-CATALOGUE-RATES-01 RatesProductPicker", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.restoreAllMocks();
  });

  it("renders a searchable product combobox (not a plain whole-catalogue select)", () => {
    stubFetch();
    render(<RatesProductPicker />);
    expect(screen.getByRole("combobox", { name: /product/i })).toBeInTheDocument();
  });

  it("navigates to ?productId=<uuid> when a product is selected", async () => {
    stubFetch();
    render(<RatesProductPicker />);
    const combo = screen.getByRole("combobox", { name: /product/i });
    fireEvent.focus(combo);
    fireEvent.change(combo, { target: { value: "birth" } });
    const option = await screen.findByRole("option", { name: (n: string) => n.includes("Birth Certificate") });
    fireEvent.mouseDown(option);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/catalogue/rates?productId=${PRODUCT}`));
  });

  it("seeds the picker label from an initial productId in the URL", () => {
    stubFetch();
    render(<RatesProductPicker initialProductId={PRODUCT} initialProductLabel="Birth Certificate" />);
    expect((screen.getByRole("combobox", { name: /product/i }) as HTMLInputElement).value).toBe("Birth Certificate");
  });
});
