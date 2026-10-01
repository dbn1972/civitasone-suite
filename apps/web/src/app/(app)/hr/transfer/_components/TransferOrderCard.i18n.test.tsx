import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { TransferOrderCard } from "./TransferOrderCard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/_components/ds/Toast", () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn() } }) }));

// GAP-HR-TRANSFER-10
describe("transfer UI is translated", () => {
  it("renders Hindi copy for the card when the locale is hi", () => {
    render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <TransferOrderCard transfer={{ id: "t1", employee: "Ramesh", fromOffice: "A", toOffice: "B", status: "requested" }} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: "आदेश जारी करें" })).toBeInTheDocument();
    expect(screen.queryByText("Issue Order")).not.toBeInTheDocument();
  });

  it("hi has exactly the same transferUi keys and ICU placeholders as en", () => {
    const flat = (o: Record<string, unknown>, pre = ""): Record<string, string> =>
      Object.entries(o).reduce((acc, [k, v]) => (typeof v === "string" ? { ...acc, [pre + k]: v } : { ...acc, ...flat(v as Record<string, unknown>, `${pre}${k}.`) }), {});
    const en = flat(enMessages.transferUi);
    const hi = flat(hiMessages.transferUi);
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(en)) expect(ph(hi[k]!), k).toEqual(ph(en[k]!));
  });
});
