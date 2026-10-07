import { PageHeader } from "../../../_components/ds";
import { RefreshErrorState } from "../../../_components/ds/RefreshErrorState";
import { toHumanError } from "@/lib/messages";
import { getIdentityWebauthnCredentials } from "../_data";
import { PasskeyManager } from "./PasskeyManager";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getIdentityWebauthnCredentials();

  return (
    <div className="page-main">
      {/* GAP-IDENTITY-WEBAUTHN-06: PageHeader back link (next/link, client-side
          navigation) instead of a hand-built <a href> breadcrumb that forced a
          full page reload; title "My passkeys" (the endpoint is self-scoped) and
          user-language copy with no internal service name. */}
      <PageHeader
        back="/identity"
        backLabel="Back to Identity"
        title="My passkeys"
        subtitle="Passkeys registered for signing in to your account."
      />
      {source === "error" && data.length === 0 ? (
        <RefreshErrorState
          error={toHumanError("load", { area: "passkeys" })}
          source={{ area: "passkeys" }}
          backHref="/identity"
        />
      ) : (
        <PasskeyManager credentials={data} />
      )}
    </div>
  );
}
