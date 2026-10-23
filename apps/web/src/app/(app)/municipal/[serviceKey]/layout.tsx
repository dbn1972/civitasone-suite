import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { ModuleGate } from "../../ModuleGate";
import { getMunicipalService } from "../_data/services";

export default async function MunicipalServiceLayout(
  props: {
    children: ReactNode;
    params: Promise<{ serviceKey: string }>;
  }
) {
  const params = await props.params;

  const {
    children
  } = props;

  const config = getMunicipalService(params.serviceKey);
  if (!config) notFound();

  return <ModuleGate moduleKey={config.moduleKey}>{children}</ModuleGate>;
}
