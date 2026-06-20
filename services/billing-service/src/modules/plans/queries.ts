import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

export async function listPlans() {
  return cache.getOrLoad("billing:platform:plans", () => repo.list());
}

export async function getPlan(id: string) {
  return cache.getOrLoad(`billing:platform:plan:${id}`, () => repo.findById(id));
}
