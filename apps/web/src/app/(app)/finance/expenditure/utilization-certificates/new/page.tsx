import { getFinanceSchemes } from "../../../../../_data/loaders";
import { NewUCForm, type SchemeOption } from "./NewUCForm";

/**
 * GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-03: the UC is linked
 * to a scheme chosen from Scheme Tracking, not typed free-hand. The endpoint
 * takes the scheme as a string (it becomes the UC's grantee), so the option
 * value is the scheme name.
 */
export default async function NewUCPage() {
  const result = await getFinanceSchemes();
  const schemes: SchemeOption[] | null =
    result.source === "error" ? null : result.data.map((s) => ({ code: s.code, name: s.name }));
  return <NewUCForm schemes={schemes} />;
}
