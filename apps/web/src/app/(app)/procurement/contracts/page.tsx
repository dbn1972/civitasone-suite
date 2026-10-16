import { redirect } from "next/navigation";

// GAP-CONTRACTS-HOME-02: /procurement/contracts was a duplicate of the
// canonical /contracts/list module. The procurement tile and Sidebar entry
// (moduleKey "contracts") now both point users to /contracts/list. Old
// bookmarks or deep links to /procurement/contracts are permanently redirected
// for backward compatibility. The procurement-contracts/new sub-route
// continues to work (it succeeds to /contracts/list after creation).
export default function ProcurementContractsPage() {
  redirect("/contracts/list");
}
