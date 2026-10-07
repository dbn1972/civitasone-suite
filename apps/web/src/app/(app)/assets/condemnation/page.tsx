import { PageHeader } from "@/app/_components/ds";
import { CondemnationWorkflow, type CondemnationData } from "./CondemnationWorkflow";
import { loadList, mapAssetOptions, mapAuctions, mapRecommendations, mapSurveys } from "./readModels";

/**
 * Condemnation, Auction & Disposal workflow (SVC-060).
 *
 * GAP-ASSETS-CONDEMNATION-01/02: asset-service exposes read models for every
 * step (GET /v1/assets/condemnation-surveys, /condemnation-recommendations,
 * /auctions). They are loaded here so each step picks its record (and takes
 * its optimistic-lock version) from the server, instead of the clerk typing
 * UUIDs and versions. Money columns arrive as decimal strings (bigint paise
 * serialised by the service's jsonSafe hook).
 */

export default async function CondemnationPage() {
  const [assets, surveys, recommendations, auctions] = await Promise.all([
    loadList("/api/v1/asset/assets?limit=200", "assets.condemnation.assets", mapAssetOptions),
    loadList("/api/v1/asset/condemnation-surveys", "assets.condemnation.surveys", mapSurveys),
    loadList("/api/v1/asset/condemnation-recommendations", "assets.condemnation.recommendations", mapRecommendations),
    loadList("/api/v1/asset/auctions", "assets.condemnation.auctions", mapAuctions),
  ]);

  const data: CondemnationData = {
    assets: assets.data,
    surveys: surveys.data,
    recommendations: recommendations.data,
    auctions: auctions.data,
    failed: {
      assets: assets.source === "error",
      surveys: surveys.source === "error",
      recommendations: recommendations.source === "error",
      auctions: auctions.source === "error",
    },
  };

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Condemnation, Auction & Disposal"
        subtitle="Survey a condemned asset, record the committee's recommendation, and run the disposal auction."
        back="/assets"
        backLabel="Assets"
      />
      <CondemnationWorkflow data={data} />
    </div>
  );
}
