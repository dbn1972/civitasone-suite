import { ModuleHub } from "../../_components/ModuleHub";
import { StatGrid, StatCard } from "../../_components/ds";
import { getContractExpirySummary } from "../../_data/loaders";

export default async function Page() {
  // GAP-CONTRACTS-HOME-04: surface the expiry picture the register exists to
  // track. The summary is computed from the same list the /contracts/list
  // register renders, so the two can never disagree. On a load error we pass
  // null values through to StatCard, which renders "—" (not a fabricated 0),
  // honouring the acceptance "error shows dashes, not zero".
  const { data: summary, source } = await getContractExpirySummary();
  const errored = source === "error" || summary == null;

  return (
    <ModuleHub
      title="Contracts"
      description="Manage service, supply, and maintenance contracts."
      links={[
        { href: "/contracts/list", label: "Contracts", note: "View and manage all contracts" },
        { href: "/contracts/new", label: "New Contract", note: "Register a new service, supply, or maintenance contract" },
        // GAP-CONTRACTS-HOME-01 (decision): the former "Rate Contracts" tile
        // linked to /contracts/rate-contracts, a route that does not exist
        // under (app)/contracts. The dynamic [id] segment swallowed the click
        // and rendered the "Contract not found" state — a dead tile. The
        // contract-service DOES expose /v1/contract/rate-contracts, but no web
        // page is built for it yet; rather than advertise a tile that bounces
        // the user into a not-found state, the tile is removed until a real
        // rate-contracts page exists. Re-add it here the moment that page and
        // its loader land.
      ]}
    >
      <StatGrid>
        <StatCard
          icon="⏰"
          tone="warn"
          label="Expiring in 30 days"
          value={errored ? null : summary.in30}
          href="/contracts/list"
          hint="Active contracts whose expiry falls within the next 30 days."
        />
        <StatCard
          icon="📅"
          tone="info"
          label="Expiring in 60 days"
          value={errored ? null : summary.in60}
          href="/contracts/list"
          hint="Active contracts whose expiry falls within the next 60 days."
        />
        <StatCard
          icon="🗓️"
          tone="info"
          label="Expiring in 90 days"
          value={errored ? null : summary.in90}
          href="/contracts/list"
          hint="Active contracts whose expiry falls within the next 90 days."
        />
        <StatCard
          icon="⚠️"
          tone="bad"
          label="Expired (open)"
          value={errored ? null : summary.expired}
          href="/contracts/list"
          hint="Contracts past their expiry date that are not yet closed or terminated."
        />
      </StatGrid>
    </ModuleHub>
  );
}
