# jsonb parameter encoding in `@civitasone/db`

Why `createSqlClient()` overrides postgres-js's `json` type handler, what the override
does and does not cover, and why deploying it before the data repair is safe.

## The defect

`createSqlClient()` used to pass no `types` option, so postgres-js used its builtin
handler (`node_modules/postgres/src/types.js`):

```js
json: { to: 114, from: [114, 3802], serialize: x => JSON.stringify(x), parse: x => JSON.parse(x) }
```

Drizzle's `PgJsonb.mapToDriverValue` (drizzle-orm 0.30.x,
`pg-core/columns/jsonb.js`) already returns `JSON.stringify(value)` — the driver receives
**JSON text**, not a JS document:

```js
mapToDriverValue(value) { return JSON.stringify(value); }
```

postgres-js then serializes each bound parameter using the OID the *server* reported in
`ParameterDescription` (`src/connection.js`, `Bind()`):

```js
parameters[i] = x = type in options.serializers ? options.serializers[type](x) : '' + x
```

For a `jsonb` column that OID is 3802, so the builtin json serializer ran on text that was
already JSON. The value was stringified twice and Postgres stored a jsonb **string** whose
text happened to be the intended document.

Reads masked the damage: postgres-js parsed one layer, then Drizzle's
`mapFromDriverValue` parsed the second, so application code saw the right object while
`jsonb_typeof` said `string`, `->>'key'` returned `NULL`, and no containment operator or
GIN index could ever match.

### Reproduced against the dev database

```
== BEFORE (pool.ts without types override)
case            | jsonb_typeof | ->>name
----------------+--------------+--------
A drizzle obj   | string       | NULL
B raw obj       | object       | probe
C scalar hello  | string       | NULL
D drizzle array | string       | NULL
  A drizzle obj stored -> "{\"name\":\"probe\"}"
  B raw obj stored -> {"name": "probe"}
  C scalar hello stored -> "hello"
  D drizzle array stored -> "[\"x\",\"y\"]"

== AFTER  (createSqlClient from packages/db/src/pool.ts)
case            | jsonb_typeof | ->>name
----------------+--------------+--------
A drizzle obj   | object       | probe
B raw obj       | object       | probe
C scalar hello  | string       | NULL
D drizzle array | array        | NULL
  A drizzle obj stored -> {"name": "probe"}
  B raw obj stored -> {"name": "probe"}
  C scalar hello stored -> "hello"
  D drizzle array stored -> ["x", "y"]
```

Case A is the fix. Case B (raw driver object) and case C (a JSON scalar string) are
unchanged, which is the point: the override must not "fix" things that were already right.

## The override

```ts
types: {
  json: {
    to: 114,
    from: [114, 3802],
    serialize: serializeJsonParam,
    parse: (raw: string): unknown => JSON.parse(raw),
  },
}
```

### `parse` is mandatory

postgres-js `typeHandlers()` registers parsers from `from`:

```js
types[k].from && [].concat(types[k].from).forEach(x => acc.parsers[x] = types[k].parse)
```

Declaring `from` without `parse` assigns `undefined` to `parsers[114]` and
`parsers[3802]`, and every jsonb read across all 40+ services would return raw text.
We supply `JSON.parse` so read behaviour is byte-identical to the builtin.

### The serialize discriminator

```ts
if (typeof x === "string") {
  try { JSON.parse(x); return x; } catch { return JSON.stringify(x); }
}
return JSON.stringify(x);
```

A string that is already valid JSON text passes through untouched; anything else is
encoded exactly once.

This is correct for Drizzle because Drizzle is the only writer on the ORM path and it
*always* hands over the output of `JSON.stringify`. A string arriving here is therefore
valid JSON text by construction, and passing it through gives exactly one encoding.
Non-strings (plain objects and arrays from raw `sql` calls, numbers, booleans, `null`,
`Date`) cannot be JSON text yet, so they still get one `JSON.stringify` — identical to the
builtin, so the raw-driver path is unchanged.

The `typeof x === "string"` guard matters: `JSON.parse` coerces its argument, so
`JSON.parse(123)` succeeds and a bare number would otherwise be returned as a number to
`Bind()`, which expects a string.

### Residual ambiguity (accepted)

A caller that bypasses Drizzle and passes the **string** `"123"` intending the jsonb
*string* `"123"` will get the jsonb *number* `123`. The same applies to `"true"`,
`"null"`, and any other string that happens to parse as JSON.

This is accepted because:

- It is unreachable through Drizzle. Drizzle sends `"\"123\""` when the intent is the
  string `"123"`, and that round-trips correctly (see the test
  `leaves legitimate JSON scalar strings as jsonb strings`).
- The alternative — leaving roughly 177k already-written rows stored as jsonb strings,
  unqueryable by `->>`, `@>`, `?`, or any GIN index — is a far larger problem.
- A marker/branded type would avoid the ambiguity but every call site in every service
  would have to opt in, which is not a change that can ship safely in one pass.

The behaviour is pinned by the unit test
`ACCEPTED AMBIGUITY: a raw-driver bare string that parses as JSON is not re-encoded`, so
it cannot regress silently.

## `jsonb[]` (OID 3807) is not covered

postgres-js builds array serializers lazily from the element serializer
(`connection.js` `addArrayType`) and this override registers only 114 and 3802, not 3807.

Investigated, and there is nothing to fix today:

- A catalogue sweep of every database on the dev instance (49 databases, including all
  `civitas_*` service databases) found **zero** columns with `udt_name` `_jsonb` or
  `_json`.
- No SQL migration in `services/**/migrations` declares a `jsonb[]` or `json[]` column.
- No Drizzle schema declares `jsonb(...).array()`.

If a `jsonb[]` column is ever introduced, extend the override to register 3807 and add a
round-trip test alongside the existing ones. Leaving it unregistered would reintroduce the
same double-encoding for array elements.

## Backwards compatibility — safe to deploy before the data repair

Rows written before this fix are stored double-encoded. After the fix, an ORM read of an
old row goes:

1. Postgres returns the jsonb string, whose text is `"{\"name\":\"legacy\"}"`
2. postgres-js `JSON.parse` → the **string** `{"name":"legacy"}`
3. Drizzle `mapFromDriverValue` sees a string → `JSON.parse` → the correct object

So **old rows still read correctly through Drizzle**, which is what makes deploying the
fix ahead of the repair script safe. Proven by the test
`BACKWARDS COMPAT: a pre-fix double-encoded row still reads correctly via Drizzle`.

One caveat during the window between deploy and repair: raw `db.execute()` / raw
`sql` reads bypass Drizzle's mapper, so they see a **string** for old rows and an
**object** for new ones. Code that reads jsonb without going through a Drizzle column
must tolerate both until the repair script has run.

## Tests

`src/jsonb-encoding.test.ts`:

- Unit tests for `serializeJsonParam` covering every branch — JSON text passthrough,
  bare strings, empty string, malformed JSON, quotes/unicode, objects, arrays, empty
  object/array, numbers, booleans, `null`, `undefined`, `Date`, and the accepted
  ambiguity.
- Integration tests against the dev Postgres in a `TEMPORARY` table (no residue),
  asserting `jsonb_typeof`, `->>`, `#>>`, `jsonb_array_elements_text`,
  `jsonb_array_length`, `@>` containment and `?` key existence **inside Postgres** —
  those are the assertions that actually prove the fix, since a JS-side round-trip would
  pass even with the bug.

The integration block is `describe.skipIf(!reachable)`, matching the pattern used by the
service DB integration tests, so a machine without the dev database still gets a green
suite. Override the connection with `JSONB_TEST_DATABASE_URL`.
