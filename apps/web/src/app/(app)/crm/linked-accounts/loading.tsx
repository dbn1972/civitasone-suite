import { useTranslations } from "next-intl";
export default function Loading() {
  const t = useTranslations("crm.loading");
  return (
    <div className="page-main">
      <div className="ph">
        <div>
          {/* GAP-CRM-LINKED-ACCOUNTS-06: the segment's one name is "Connected
              Accounts" (matching the page title), not "Linked Accounts". */}
          <h1 id="page-heading">{t("linkedAccountsTitle")}</h1>
        </div>
      </div>
      {/* The page is a single card (connect form + connected-accounts table),
          NOT a four-tile stat dashboard — mirror that shape so there is no
          layout shift when the data loads. */}
      <div className="animate-pulse card" style={{ display: "grid", gap: 14, padding: 16 }}>
        {/* two input skeletons */}
        <div style={{ height: 44, borderRadius: 8, background: "#f1f5f9" }} />
        <div style={{ height: 44, borderRadius: 8, background: "#f1f5f9" }} />
        {/* request button */}
        <div style={{ height: 44, width: 180, borderRadius: 8, background: "#f1f5f9" }} />
        {/* three table-row skeletons */}
        <div style={{ height: 40, borderRadius: 8, background: "#f1f5f9", marginTop: 8 }} />
        <div style={{ height: 40, borderRadius: 8, background: "#f1f5f9" }} />
        <div style={{ height: 40, borderRadius: 8, background: "#f1f5f9" }} />
      </div>
    </div>
  );
}
