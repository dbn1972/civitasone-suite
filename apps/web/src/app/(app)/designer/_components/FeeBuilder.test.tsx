import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FeeBuilder } from "./FeeBuilder";
import { emptyFeeDesign } from "../_data/feeBuilderApi";

describe("FeeBuilder", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/finance/major-heads")) {
          return {
            ok: true,
            json: async () => ({
              data: [{ code: "0070", description: "Other Administrative Services" }],
            }),
          } as Response;
        }
        return { ok: true, status: 202, json: async () => ({ id: "sched-1" }) } as Response;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows HOA blocking banner until an account is chosen", async () => {
    const initial = {
      ...emptyFeeDesign("Trade License"),
      feeModel: "flat" as const,
      baseAmountPaise: 50000,
      hoaCode: "",
      exemptions: [
        {
          id: "e1",
          attribute: "category",
          op: "eq" as const,
          value: "micro",
          kind: "percent" as const,
          amount: "50",
          label: "Micro enterprise",
        },
      ],
    };

    render(
      <FeeBuilder
        serviceId="svc-1"
        serviceName="Trade License"
        initial={initial}
        formFields={[
          {
            id: "f1",
            apiName: "category",
            type: "text",
            label: "Category",
            required: false,
            sectionId: "s1",
          },
        ]}
        engineAvailable={false}
      />,
    );

    expect(screen.getByTestId("hoa-blocking-banner")).toBeInTheDocument();
    expect(screen.getByText(/Required before Next \/ Submit/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Exempt sample/i }));
    await waitFor(() => {
      expect(screen.getByTestId("sample-total")).toHaveTextContent("₹250.00");
    });

    const hoaInput = screen.getByPlaceholderText(/Search by code or description/i);
    fireEvent.focus(hoaInput);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /0070/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /0070/ }));

    await waitFor(() => {
      expect(screen.queryByTestId("hoa-blocking-banner")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Attached: 0070/)).toBeInTheDocument();
  });

  it("disables Engine card when no engine is bound", () => {
    render(
      <FeeBuilder
        serviceId="svc-1"
        serviceName="Trade License"
        initial={emptyFeeDesign("Trade License")}
        formFields={[]}
        engineAvailable={false}
      />,
    );
    const engine = screen.getByRole("radio", { name: /Engine/i });
    expect(engine).toBeDisabled();
    expect(screen.getByText(/No assessment engine is bound/i)).toBeInTheDocument();
  });
});
