/**
 * UX-R5 (names, not ids): pure keying for the directory and the internal user-summaries. Peer services store
 * the JWT sub (the Keycloak user id) as created_by, so both lookups must answer under that key as well as under
 * users.users.id. An identity-id match always wins over a Keycloak-sub match.
 */
import { describe, it, expect } from "vitest";
import { directoryEntriesFor, summaryEntriesFor } from "../src/modules/users/repo.js";

const ID_A = "aaaaaaaa-0000-4000-8000-000000000001";
const KC_A = "aaaaaaaa-0000-4000-8000-0000000000c1";
const ID_B = "bbbbbbbb-0000-4000-8000-000000000001";

describe("directoryEntriesFor", () => {
  const rows = [
    { id: ID_A, keycloakUserId: KC_A, name: "Asha Rao" },
    { id: ID_B, keycloakUserId: null, name: "Bimal Das" },
  ];

  it("answers under the Keycloak sub the caller asked for", () => {
    expect(directoryEntriesFor([KC_A], rows)).toEqual([{ id: KC_A, displayName: "Asha Rao" }]);
  });

  it("answers under the identity id when that was asked", () => {
    expect(directoryEntriesFor([ID_A], rows)).toEqual([{ id: ID_A, displayName: "Asha Rao" }]);
  });

  it("drops rows that match nothing asked", () => {
    expect(directoryEntriesFor([ID_B], rows)).toEqual([{ id: ID_B, displayName: "Bimal Das" }]);
  });

  it("an identity-id match wins when an asked id is both some row id and another row sub", () => {
    const clash = [
      { id: ID_A, keycloakUserId: null, name: "Identity owner" },
      { id: ID_B, keycloakUserId: ID_A, name: "Sub owner" },
    ];
    expect(directoryEntriesFor([ID_A], clash)).toEqual([{ id: ID_A, displayName: "Identity owner" }]);
  });
});

describe("summaryEntriesFor", () => {
  it("emits each user under its identity id and its Keycloak sub", () => {
    const out = summaryEntriesFor([
      { id: ID_A, keycloakUserId: KC_A, name: "Asha Rao" },
      { id: ID_B, keycloakUserId: null, name: "Bimal Das" },
    ]);
    expect(out).toEqual([
      { id: ID_A, name: "Asha Rao" },
      { id: ID_B, name: "Bimal Das" },
      { id: KC_A, name: "Asha Rao" },
    ]);
  });
});
