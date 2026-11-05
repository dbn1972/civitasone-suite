import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { RECORD_UI_EN, asRecordT } from "./messages";
import { personLabel, unresolvedLabel } from "./labels";
import { outcomeLine, raiseBlockedReason } from "./statusActions";
import { dateTextError } from "@/lib/indianDate";
import { RecordHeader } from "@/app/_components/ds/RecordHeader";
import { ApprovalTrail, trailActionLabel } from "@/app/_components/ds/ApprovalTrail";
import { RequiredLegend } from "@/app/_components/ds/RequiredLegend";
import { Field } from "@/app/_components/ds/Field";
import { Input } from "@/app/_components/ds/Input";
import { DateInput } from "@/app/_components/ds/DateInput";

// UX-R5 / Hindi regression guard: the shared record components and label helpers read `recordUi`, so every page
// that uses them is bilingual by default. This pins the catalogue (en + hi parity, English fallback table) and
// that the Hindi wording reaches the DOM.
type Tree = { [k: string]: string | Tree };
const EN = (enMessages as unknown as { recordUi: Tree }).recordUi;
const HI = (hiMessages as unknown as { recordUi: Tree }).recordUi;

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === "string") out[prefix + k] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}
const enFlat = flatten(EN);
const hiFlat = flatten(HI);
const hiT = asRecordT(createTranslator({ locale: "hi", messages: hiMessages, namespace: "recordUi" } as Parameters<typeof createTranslator>[0]));
const DEVANAGARI = /[ऀ-ॿ]/;

describe("recordUi catalogue", () => {
  it("hi defines exactly the keys en defines, and every hi value is Hindi script", () => {
    expect(Object.keys(hiFlat).sort()).toEqual(Object.keys(enFlat).sort());
    for (const [key, value] of Object.entries(hiFlat)) {
      if (key === "trailBy") continue; // a dash: Hindi puts the actor after the action with no connector word
      expect(DEVANAGARI.test(value), key).toBe(true);
    }
  });

  it("every {placeholder} of an en message survives in hi", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, value] of Object.entries(enFlat)) expect(ph(hiFlat[key]!), key).toEqual(ph(value));
  });

  it("the English fallback table the pure helpers use equals en.json recordUi", () => {
    for (const [key, value] of Object.entries(RECORD_UI_EN)) expect(enFlat[key], key).toBe(value);
  });
});

describe("label helpers take the request-locale translator", () => {
  it("unresolved person, outcome line and blocked reason read Hindi", () => {
    expect(unresolvedLabel("00000000-aaaa-4000-8000-00000000c0d8", hiT)).toBe("नाम उपलब्ध नहीं (ID के अंत में c0d8)");
    expect(personLabel(undefined, "00000000-aaaa-4000-8000-00000000c0d8", undefined, hiT)).not.toMatch(/Name not available/);
    expect(outcomeLine({ status: "approved", by: "आशा राव", at: "2026-10-30" }, hiT)).toBe("अनुमोदित — आशा राव द्वारा, 30 Oct 2026 को।");
    expect(raiseBlockedReason({ terminal: ["closed"] }, "closed", undefined, hiT)).toBe("closed स्थिति वाले अभिलेख के लिए अनुमोदन नहीं भेजा जा सकता।");
    expect(dateTextError("31-04-2026", {}, hiT)).toBe("31-04-2026 वास्तविक तारीख नहीं है। दिन और महीना जाँचें।");
    expect(trailActionLabel("sent_back", hiT)).toBe("सुधार के लिए लौटाया गया");
  });

  it("without a translator the helpers stay English (existing callers unchanged)", () => {
    expect(unresolvedLabel("00000000-aaaa-4000-8000-00000000c0d8")).toBe("Name not available (ID ending c0d8)");
    expect(outcomeLine({ status: "approved", by: "N. Gupta, DDO" })).toBe("Approved by N. Gupta, DDO.");
    expect(trailActionLabel("sent_back")).toBe("Returned for correction");
  });
});

const hi = (ui: React.ReactElement) => render(<NextIntlClientProvider locale="hi" messages={hiMessages}>{ui}</NextIntlClientProvider>);

describe("shared record components in Hindi", () => {
  it("RecordHeader: status label, summary aria-label, amount label and unnumbered title", () => {
    const { container } = hi(<RecordHeader kind="बिल" recordNo={null} status="passed" amountMinor="250000" />);
    const dl = container.querySelector("dl")!;
    expect(dl.getAttribute("aria-label")).toBe("बिल सारांश");
    expect(dl.textContent).toContain("स्थिति");
    expect(dl.textContent).toContain("राशि");
    expect(container.textContent).toContain("बिल (संख्या अभी आवंटित नहीं)");
    expect(container.textContent).not.toMatch(/\b(Status|Amount|summary|allocated)\b/);
  });

  it("ApprovalTrail: title, empty text, action labels and connector", () => {
    const empty = hi(<ApprovalTrail entries={[]} />);
    expect(empty.container.textContent).toContain("अनुमोदन का क्रम");
    expect(empty.container.textContent).toContain("अभी तक कोई अनुमोदन कार्रवाई दर्ज नहीं है।");
    empty.unmount();
    const { container } = hi(<ApprovalTrail entries={[{ actor: "आशा राव", action: "approved" }, { actor: "के. नायर", action: "passed_for_payment" }]} />);
    expect(container.textContent).toContain("अनुमोदित");
    expect(container.textContent).toContain("भुगतान हेतु पारित");
    expect(container.textContent).not.toMatch(/Approv|Passed| by /);
  });

  it("two trails on one page get distinct heading ids", () => {
    const { container } = hi(<><ApprovalTrail entries={[]} /><ApprovalTrail entries={[]} /></>);
    const ids = [...container.querySelectorAll("h2")].map((h) => h.id);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(container.querySelector(`section[aria-labelledby="${id}"]`)).not.toBeNull();
  });

  it("RequiredLegend keeps the red asterisk (aria-hidden) and the screen-reader words", () => {
    const { container } = hi(<RequiredLegend optionalNote />);
    expect(container.querySelector("[aria-hidden='true']")?.textContent).toBe("*");
    expect(container.querySelector(".sr-only")?.textContent).toContain("तारांकन");
    expect(container.textContent).toContain("आवश्यक हैं");
    expect(container.textContent).toContain("अन्य फ़ील्ड वैकल्पिक हैं।");
    expect(container.textContent).not.toMatch(/Fields marked|required|optional/);
  });

  it("Field: the blur messages for an empty required field and an unreal date are Hindi", () => {
    const { container } = hi(<><Field label="नाम" required><Input /></Field><Field label="तारीख" required><DateInput value="" onChange={() => {}} /></Field></>);
    const [name, date] = [...container.querySelectorAll("input")];
    fireEvent.blur(name!);
    expect(container.querySelector("[role='alert']")?.textContent).toBe("नाम आवश्यक है।");
    fireEvent.change(date!, { target: { value: "31042026" } });
    fireEvent.blur(date!);
    expect([...container.querySelectorAll("[role='alert']")].map((e) => e.textContent)).toContain("31-04-2026 वास्तविक तारीख नहीं है। दिन और महीना जाँचें।");
  });
});
