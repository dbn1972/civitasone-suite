import { getFinanceSchemes } from "../../../../../_data/loaders";
import { NewUCForm, type SchemeOption } from "./NewUCForm";

/**
 * GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-03: the UC is linked
 * to a scheme chosen from Scheme Tracking, not typed free-hand. The endpoint
 * takes the scheme's code (`schemeCode`, unique per office) and stores it with
 * the certificate, so the option value is the scheme code.
 */
export default async function NewUCPage() {
  const result = await getFinanceSchemes();
  const schemes: SchemeOption[] | null =
    result.source === "error" ? null : result.data.map((s) => ({ code: s.code, name: s.name }));
  return <NewUCForm schemes={schemes} />;
}
