/**
 * Regression suite for the jsonb double-encoding defect fixed in pool.ts.
 *
 * The integration half talks to the real dev Postgres because the defect only manifests
 * once the server describes a parameter slot as jsonb(3802) — no in-memory fake can
 * reproduce it. Everything lives in a TEMPORARY table so the suite leaves no residue,
 * and the whole block is skipped when the dev DB is unreachable so a machine without
 * docker still gets a green run.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { pgTable, text, jsonb } from "drizzle-orm/pg-core";
import type postgres from "postgres";
import { createSqlClient, serializeJsonParam } from "./pool.js";

const DEV_URL =
  process.env.JSONB_TEST_DATABASE_URL
  ?? "postgres://civitas_admin:civitas_dev_pw@localhost:5435/civitas_cdp";

async function probeReachable(): Promise<boolean> {
  let client: postgres.Sql<{}> | undefined;
  try {
    client = createSqlClient(DEV_URL, { max: 1, connect_timeout: 3, idle_timeout: 1 });
    await client`select 1 as ok`;
    return true;
  } catch {
    return false;
  } finally {
    await client?.end({ timeout: 1 }).catch(() => undefined);
  }
}

const reachable = await probeReachable();

/** `noUncheckedIndexedAccess` makes rows[0] optional; fail loudly instead of casting. */
function firstRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected at least one row");
  return row;
}

// ────────────────────────────────────────────────────────────────────────────────
// Unit: the serializer itself. Runs everywhere, no database required.
// ────────────────────────────────────────────────────────────────────────────────
describe("serializeJsonParam", () => {
  it("passes object JSON text through untouched (the Drizzle write path)", () => {
    expect(serializeJsonParam('{"name":"probe"}')).toBe('{"name":"probe"}');
  });

  it("passes array JSON text through untouched", () => {
    expect(serializeJsonParam('["x","y"]')).toBe('["x","y"]');
  });

  it("passes nested JSON text through untouched", () => {
    const encoded = '{"a":{"b":[1,2,{"c":null}]},"d":true}';
    expect(serializeJsonParam(encoded)).toBe(encoded);
  });

  it("passes quoted-scalar JSON text through untouched", () => {
    // This is what Drizzle sends for the JS string "hello": JSON.stringify("hello").
    expect(serializeJsonParam('"hello"')).toBe('"hello"');
    expect(serializeJsonParam('"true"')).toBe('"true"');
    expect(serializeJsonParam('"null"')).toBe('"null"');
    expect(serializeJsonParam('"123"')).toBe('"123"');
  });

  it("encodes a bare non-JSON string exactly once", () => {
    expect(serializeJsonParam("hello")).toBe('"hello"');
  });

  it("encodes the empty string once (empty string is not valid JSON text)", () => {
    expect(serializeJsonParam("")).toBe('""');
  });

  it("encodes malformed JSON-looking strings once", () => {
    expect(serializeJsonParam("{")).toBe('"{"');
    expect(serializeJsonParam("{oops}")).toBe('"{oops}"');
    expect(serializeJsonParam("[1,")).toBe('"[1,"');
  });

  it("encodes strings containing quotes and unicode once, escaping correctly", () => {
    expect(serializeJsonParam('he said "hi"')).toBe('"he said \\"hi\\""');
    expect(serializeJsonParam("नमस्ते 😀")).toBe('"नमस्ते 😀"');
  });

  it("encodes plain objects once (raw-driver path, unchanged from the builtin)", () => {
    expect(serializeJsonParam({ name: "probe" })).toBe('{"name":"probe"}');
  });

  it("encodes arrays once", () => {
    expect(serializeJsonParam(["x", "y"])).toBe('["x","y"]');
    expect(serializeJsonParam([])).toBe("[]");
  });

  it("encodes empty objects once", () => {
    expect(serializeJsonParam({})).toBe("{}");
  });

  it("encodes numbers, booleans and null the way the builtin does", () => {
    expect(serializeJsonParam(123)).toBe("123");
    expect(serializeJsonParam(-0.5)).toBe("-0.5");
    expect(serializeJsonParam(true)).toBe("true");
    expect(serializeJsonParam(false)).toBe("false");
    expect(serializeJsonParam(null)).toBe("null");
  });

  it("matches the builtin for undefined (JSON.stringify returns undefined)", () => {
    // Parity note, not a design choice: postgres-js's builtin json serializer behaves
    // identically, so this override introduces no new edge case here.
    expect(serializeJsonParam(undefined)).toBeUndefined();
  });

  it("encodes Date via toJSON, same as the builtin", () => {
    expect(serializeJsonParam(new Date("2026-01-02T03:04:05.000Z"))).toBe(
      '"2026-01-02T03:04:05.000Z"'
    );
  });

  it("ACCEPTED AMBIGUITY: a raw-driver bare string that parses as JSON is not re-encoded", () => {
    // Unreachable via Drizzle (Drizzle sends '"123"' when the intent is the string "123").
    // Kept as an executable note so the tradeoff cannot be quietly lost.
    expect(serializeJsonParam("123")).toBe("123");
    expect(serializeJsonParam("true")).toBe("true");
    expect(serializeJsonParam("null")).toBe("null");
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// Integration: prove the encoding is correct *inside Postgres*.
// ────────────────────────────────────────────────────────────────────────────────
const probe = pgTable("jsonb_probe", {
  id: text("id").primaryKey(),
  data: jsonb("data"),
});

describe.skipIf(!reachable)("jsonb encoding — live Postgres round-trip", () => {
  let client: postgres.Sql<{}>;
  let db: PostgresJsDatabase<Record<string, never>>;
  let seq = 0;

  /** max:1 pins every statement to one connection, which TEMP tables require. */
  beforeAll(async () => {
    client = createSqlClient(DEV_URL, { max: 1, connect_timeout: 5 });
    db = drizzle(client);
    await client`create temporary table jsonb_probe (id text primary key, data jsonb)`;
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  function nextId(): string {
    seq += 1;
    return `probe-${seq}`;
  }

  /** Insert through Drizzle — the exact path that was corrupting rows. */
  async function insertViaDrizzle(value: unknown): Promise<string> {
    const id = nextId();
    await db.insert(probe).values({ id, data: value });
    return id;
  }

  async function typeOf(id: string): Promise<string> {
    const rows = await client<{ t: string | null }[]>`
      select jsonb_typeof(data) as t from jsonb_probe where id = ${id}`;
    const t = firstRow(rows).t;
    if (t === null) throw new Error("jsonb_typeof returned null");
    return t;
  }

  /** Reads the stored jsonb as text and parses it in JS — independent of the driver parser. */
  async function storedAsText(id: string): Promise<string> {
    const rows = await client<{ txt: string }[]>`
      select data::text as txt from jsonb_probe where id = ${id}`;
    return firstRow(rows).txt;
  }

  it("stores an object as a jsonb object and ->>'key' resolves inside Postgres", async () => {
    const id = await insertViaDrizzle({ name: "probe", n: 7 });

    expect(await typeOf(id)).toBe("object");

    const rows = await client<{ name: string | null; n: string | null }[]>`
      select data->>'name' as name, data->>'n' as n from jsonb_probe where id = ${id}`;
    expect(firstRow(rows).name).toBe("probe");
    expect(firstRow(rows).n).toBe("7");
  });

  it("stores an array as a jsonb array and jsonb_array_elements expands it", async () => {
    const id = await insertViaDrizzle(["x", "y", "z"]);

    expect(await typeOf(id)).toBe("array");

    const rows = await client<{ el: string }[]>`
      select jsonb_array_elements_text(data) as el from jsonb_probe where id = ${id}`;
    expect(rows.map((r) => r.el)).toEqual(["x", "y", "z"]);

    const len = await client<{ n: number }[]>`
      select jsonb_array_length(data)::int as n from jsonb_probe where id = ${id}`;
    expect(firstRow(len).n).toBe(3);
  });

  it("preserves a deeply nested object/array structure exactly", async () => {
    const value = {
      profile: { name: "probe", tags: ["a", "b"], meta: { active: true, score: 4.5 } },
      history: [{ at: "2026-01-01", by: null }, { at: "2026-02-01", by: "u1" }],
    };
    const id = await insertViaDrizzle(value);

    expect(JSON.parse(await storedAsText(id))).toEqual(value);

    const deep = await client<{ v: string | null }[]>`
      select data #>> '{profile,meta,score}' as v from jsonb_probe where id = ${id}`;
    expect(firstRow(deep).v).toBe("4.5");

    const tag = await client<{ v: string | null }[]>`
      select data #>> '{profile,tags,1}' as v from jsonb_probe where id = ${id}`;
    expect(firstRow(tag).v).toBe("b");
  });

  it("leaves legitimate JSON scalar strings as jsonb strings", async () => {
    for (const scalar of ["hello", "true", "null", "123"]) {
      const id = await insertViaDrizzle(scalar);
      expect(await typeOf(id)).toBe("string");
      const rows = await client<{ v: string | null }[]>`
        select data #>> '{}' as v from jsonb_probe where id = ${id}`;
      expect(firstRow(rows).v).toBe(scalar);
    }
  });

  it("stores non-string jsonb scalars with the right type", async () => {
    const cases: ReadonlyArray<readonly [unknown, string]> = [
      [42, "number"],
      [-0.5, "number"],
      [true, "boolean"],
      [false, "boolean"],
    ];
    for (const [value, expected] of cases) {
      const id = await insertViaDrizzle(value);
      expect(await typeOf(id)).toBe(expected);
    }
    // JS null through Drizzle writes a SQL NULL, so assert the column, not jsonb_typeof.
    const nullId = await insertViaDrizzle(null);
    const rows = await client<{ isNull: boolean }[]>`
      select data is null as "isNull" from jsonb_probe where id = ${nullId}`;
    expect(firstRow(rows).isNull).toBe(true);
  });

  it("does not regress the raw-driver object parameter path", async () => {
    const id = nextId();
    await client`
      insert into jsonb_probe (id, data)
      values (${id}, ${client.json({ name: "raw", nested: { ok: true } })})`;

    expect(await typeOf(id)).toBe("object");
    const rows = await client<{ name: string | null; ok: string | null }[]>`
      select data->>'name' as name, data #>> '{nested,ok}' as ok
      from jsonb_probe where id = ${id}`;
    expect(firstRow(rows).name).toBe("raw");
    expect(firstRow(rows).ok).toBe("true");
  });

  it("reads back a parsed object, not a string, through the driver parser", async () => {
    const id = await insertViaDrizzle({ name: "probe" });
    const rows = await client<{ data: unknown }[]>`
      select data from jsonb_probe where id = ${id}`;
    const value = firstRow(rows).data;
    expect(typeof value).toBe("object");
    expect(value).toEqual({ name: "probe" });
  });

  it("reads back the same object through Drizzle's mapper", async () => {
    const id = await insertViaDrizzle({ name: "probe", nested: { ok: true } });
    const rows = await db.select({ data: probe.data }).from(probe).where(eq(probe.id, id));
    expect(firstRow(rows).data).toEqual({ name: "probe", nested: { ok: true } });
  });

  it("BACKWARDS COMPAT: a pre-fix double-encoded row still reads correctly via Drizzle", async () => {
    const id = nextId();
    // to_jsonb(text) reproduces exactly what the old double-stringify wrote, without
    // routing the value through the parameter serializer under test.
    const innerText = JSON.stringify({ name: "legacy", n: 1 });
    await client`
      insert into jsonb_probe (id, data) values (${id}, to_jsonb(${innerText}::text))`;

    // Still corrupt at the storage layer — that is what the repair script is for.
    expect(await typeOf(id)).toBe("string");

    // But Drizzle's mapFromDriverValue peels the second layer, so ORM reads survive:
    // postgres-js JSON.parse -> the string '{"name":"legacy","n":1}' -> Drizzle JSON.parse -> object.
    const rows = await db.select({ data: probe.data }).from(probe).where(eq(probe.id, id));
    expect(firstRow(rows).data).toEqual({ name: "legacy", n: 1 });

    // Raw reads that bypass Drizzle DO still see a string for old rows. Asserted here so
    // the deploy-before-repair window is understood rather than discovered in production.
    const raw = await client<{ data: unknown }[]>`
      select data from jsonb_probe where id = ${id}`;
    expect(typeof firstRow(raw).data).toBe("string");
  });

  it("matches containment (@>) and key existence (?), proving GIN-indexable behaviour", async () => {
    const id = await insertViaDrizzle({ k: "v", other: 1 });

    const hit = await client<{ hit: boolean }[]>`
      select data @> '{"k":"v"}'::jsonb as hit from jsonb_probe where id = ${id}`;
    expect(firstRow(hit).hit).toBe(true);

    const miss = await client<{ hit: boolean }[]>`
      select data @> '{"k":"nope"}'::jsonb as hit from jsonb_probe where id = ${id}`;
    expect(firstRow(miss).hit).toBe(false);

    const keyExists = await client<{ hit: boolean }[]>`
      select data ? 'k' as hit from jsonb_probe where id = ${id}`;
    expect(firstRow(keyExists).hit).toBe(true);
  });

  it("handles the empty object and the empty array", async () => {
    const objId = await insertViaDrizzle({});
    expect(await typeOf(objId)).toBe("object");
    expect(await storedAsText(objId)).toBe("{}");

    const arrId = await insertViaDrizzle([]);
    expect(await typeOf(arrId)).toBe("array");
    const arrRows = await client<{ n: number }[]>`
      select jsonb_array_length(data)::int as n from jsonb_probe where id = ${arrId}`;
    expect(firstRow(arrRows).n).toBe(0);
  });

  it("preserves unicode, embedded quotes, newlines and backslashes exactly", async () => {
    const value = {
      hindi: "नमस्ते",
      emoji: "😀🚀",
      quoted: 'he said "hi"',
      newline: "line1\nline2",
      backslash: "C:\\temp\\x",
      tab: "a\tb",
    };
    const id = await insertViaDrizzle(value);

    expect(await typeOf(id)).toBe("object");
    const rows = await db.select({ data: probe.data }).from(probe).where(eq(probe.id, id));
    expect(firstRow(rows).data).toEqual(value);

    const inPg = await client<{ q: string | null; nl: string | null; hi: string | null }[]>`
      select data->>'quoted' as q, data->>'newline' as nl, data->>'hindi' as hi
      from jsonb_probe where id = ${id}`;
    expect(firstRow(inPg).q).toBe('he said "hi"');
    expect(firstRow(inPg).nl).toBe("line1\nline2");
    expect(firstRow(inPg).hi).toBe("नमस्ते");
  });
});
