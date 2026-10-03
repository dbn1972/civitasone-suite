import { PageHeader, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getAssetCategories, getAssetLocations } from "../../../_data/loaders";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canWriteAssets } from "@/lib/auth/workRoles";
import { toHumanError } from "@/lib/messages";
import { RegisterAssetForm } from "./RegisterAssetForm";
import { AccountingBanner } from "../AccountingBanner";

export default async function RegisterAssetPage() {
  const header = (
    <PageHeader
      title="Register Asset"
      subtitle="Manual capitalization — create an asset master record."
      back="/assets/list"
      backLabel="Asset Register"
    />
  );

  // GAP-ASSETS-REGISTER-01: only roles the asset-service admits on
  // POST /v1/assets/assets get the form (the service still enforces it).
  if (!canWriteAssets(getSessionRoles())) {
    return (
      <>
        {header}
        <EmptyState icon="🔒" title="Not permitted" message="Registering assets needs an asset manager or asset administrator role." />
      </>
    );
  }

  // GAP-ASSETS-REGISTER-02: the category decides depreciation method, rate and
  // useful life, so it must be chosen -- never a hard-coded category id.
  const { data: categories, source } = await getAssetCategories();
  // GAP-ASSETS-LOCATIONS-03: a failed locations load degrades to free text (the form says so); it never blocks registration.
  const { data: locations, source: locationsSource } = await getAssetLocations();

  return (
    <>
      {header}
      {/* The asset is saved either way; without the GL accounts its journal waits (never posted to a guessed account). */}
      <AccountingBanner areas={["acquisition"]} />
      {source === "error" ? (
        <RefreshErrorState error={toHumanError("load", { area: "asset categories" })} />
      ) : categories.length === 0 ? (
        <EmptyState
          icon="🗂️"
          title="Category setup required"
          message="No asset categories exist yet. An asset administrator must create categories (with depreciation method, rate and useful life) before assets can be registered."
        />
      ) : (
        <RegisterAssetForm categories={categories} locations={locations ?? []} locationsFailed={locationsSource === "error"} />
      )}
    </>
  );
}
