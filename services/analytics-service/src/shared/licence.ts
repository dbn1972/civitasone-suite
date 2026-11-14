/**
 * Module licence check for this service's calls into other modules (module-sale gap M5). No-op unless
 * MODULE_LICENCE_CHECK=on and the tenant is in watch-only / enforce mode. See @civitasone/module-licence.
 */
import { createModuleLicence } from "@civitasone/module-licence";

export const licence = createModuleLicence({ service: "analytics" });
