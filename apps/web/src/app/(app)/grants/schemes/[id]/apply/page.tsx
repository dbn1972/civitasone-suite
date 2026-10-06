import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSchemeById } from "../../../_data";
import { getGrantees } from "@/app/_data/loaders";
import type { GranteeSummary } from "@civitasone/types";
import { schemeWindowState } from "../../../schemeWindow";
import { ApplyForm } from "./ApplyForm";

export default async function ApplyPage({ params }: { params: { id: string } }) {
  const schemeId = params.id;
  const { data: scheme, source, status } = await getSchemeById(schemeId);

  // GAP-GRANTS-SCHEMES-DETAIL-APPLY-03 / DETAIL-03: a server error shows retry,
  // a genuine 404 shows not-found.
  if (source === "error" && status !== 404) {
    return (
      <>
        <PageHeader back={`/grants/schemes/${schemeId}`} backLabel="Scheme" title="Apply" />
        <RefreshErrorState
          error={toHumanError("load", { area: "scheme" })}
          backHref={`/grants/schemes/${schemeId}`}
          source={{ status, area: "scheme" }}
        />
      </>
    );
  }
  if (!scheme) {
    notFound();
  }

  const window = schemeWindowState(scheme);

  const header = (
    <PageHeader
      back={`/grants/schemes/${schemeId}`}
      backLabel={scheme.name}
      title="Submit Grant Application"
      subtitle={scheme.code}
      help="grants"
    />
  );

  // GAP-GRANTS-SCHEMES-DETAIL-APPLY-03: a closed/draft or out-of-window scheme
  // must not accept the form by URL — block with an honest state.
  if (!window.accepting) {
    const message =
      window.reason === "before-open" && window.at
        ? `This scheme opens on ${formatIndianDate(window.at)}. Applications cannot be filed yet.`
        : window.reason === "after-close" && window.at
          ? `This scheme closed on ${formatIndianDate(window.at)}. It is no longer accepting applications.`
          : "This scheme is not currently accepting applications.";
    return (
      <>
        {header}
        <Card title="Not accepting applications" padding>
          <EmptyState
            icon="🔒"
            title="Applications are closed"
            message={message}
            action={
              <Link href={`/grants/schemes/${schemeId}`} className="btn">
                Back to scheme
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  // Grantees for the picker (GAP-GRANTS-SCHEMES-DETAIL-APPLY-01). Loaded
  // server-side; a load failure is non-fatal — the clerk can still proceed but
  // the picker will be empty, so surface a hint.
  const { data: grantees } = await getGrantees();

  return (
    <>
      {header}
      <ApplyForm
        schemeId={schemeId}
        schemeName={scheme.name}
        minAmountMinor={scheme.minAmountMinor}
        maxAmountMinor={scheme.maxAmountMinor}
        budgetMinor={scheme.budgetMinor}
        windowHint={
          scheme.minAmountMinor > 0 || scheme.maxAmountMinor > 0
            ? `This scheme accepts ${scheme.minAmountMinor > 0 ? `at least ${formatMoney(scheme.minAmountMinor)}` : "any amount"}${
                scheme.maxAmountMinor > 0 ? ` and at most ${formatMoney(scheme.maxAmountMinor)}` : ""
              } per application.`
            : null
        }
        grantees={grantees.map((g: GranteeSummary) => ({
          id: g.id,
          label: g.name,
          sublabel: g.granteeCode,
        }))}
      />
    </>
  );
}
