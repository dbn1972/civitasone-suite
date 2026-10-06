import { humanErrorFromFailure, type MessageKind } from "@/lib/messages";
import { UserFacingError, isNetworkFailure } from "@/lib/userFacingError";

/**
 * Message for a caught error from any call in the meeting data client. Only a UserFacingError
 * (what client.ts send/get throw) is rendered as-is; anything else (a network failure or an
 * unclassified throw) is mapped through the catalogue, never via a raw `err.message`. Same
 * building blocks as useFormError.fromException, usable outside a component. Kept apart from
 * client.ts so tests that mock the client module still get the real mapping.
 */
export function actionErrorText(err: unknown, kind: MessageKind = "save"): string {
  if (err instanceof UserFacingError) return err.message;
  const human = humanErrorFromFailure({
    kind: kind === "load" ? "load" : "save",
    area: "meeting",
    forceKind: isNetworkFailure(err) ? "network" : "unknown",
  });
  return `${human.what} ${human.next}`;
}
