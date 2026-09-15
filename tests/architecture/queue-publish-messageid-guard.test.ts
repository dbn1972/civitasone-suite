/**
 * queue-publish-messageid-guard.mjs — fixture-based unit tests (PERF-008).
 *
 * Exercises the exported `checkFile()` directly against in-memory source
 * (parsed with the real TypeScript compiler API, same as the guard itself),
 * mirroring tests/architecture/nested-tx-guard.test.ts's shape.
 *
 * Run: pnpm exec vitest run tests/architecture/queue-publish-messageid-guard.test.ts
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { checkFile, objectLiteralOwnPropertyNames } from "../../scripts/ci/queue-publish-messageid-guard.mjs";

function parse(source) {
  return ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

describe("queue-publish-messageid-guard: real fleet shape", () => {
  it("flags finance-service's budget/commands.ts in its PRE-FIX shape (fingerprinted, no messageId)", () => {
    const source = `
      export async function budgetReappropriate(ctx, body) {
        await queue.publish(COMMANDS.budgetReappropriate, {
          type: COMMANDS.budgetReappropriate,
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          schemaVersion: "1.0",
          payload: body,
        });
      }
    `;
    const { violations, unknowns, totalMatched } = checkFile(parse(source));
    expect(totalMatched).toBe(1);
    expect(unknowns).toHaveLength(0);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(3);
  });

  it("does NOT flag the same call site once messageId is added (the real fix shape)", () => {
    const source = `
      export async function budgetReappropriate(ctx, body) {
        await queue.publish(COMMANDS.budgetReappropriate, {
          messageId: deriveStableId(ctx, body),
          type: COMMANDS.budgetReappropriate,
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          schemaVersion: "1.0",
          payload: body,
        });
      }
    `;
    const { violations, totalMatched } = checkFile(parse(source));
    expect(totalMatched).toBe(1);
    expect(violations).toHaveLength(0);
  });
});

describe("queue-publish-messageid-guard: unknown (non-literal argument) — reported, never scored", () => {
  it("treats a variable 2nd argument as unknown, not a violation", () => {
    const source = `
      await queue.publish(COMMANDS.capaCreate, msg);
    `;
    const { violations, unknowns, totalMatched } = checkFile(parse(source));
    expect(totalMatched).toBe(1);
    expect(violations).toHaveLength(0);
    expect(unknowns).toHaveLength(1);
  });

  it("treats a helper-function-call 2nd argument as unknown, not a violation (real estab-service/dfa shape)", () => {
    const source = `
      await queue.publish(COMMANDS.dfaCreate, envelope(ctx, COMMANDS.dfaCreate, { id, tenantId: ctx.tenantId, ...body }));
    `;
    const { violations, unknowns } = checkFile(parse(source));
    expect(violations).toHaveLength(0);
    expect(unknowns).toHaveLength(1);
  });
});

describe("queue-publish-messageid-guard: sabotage-check controls that must stay clean", () => {
  it("does not flag an unrelated .publish() call whose object argument isn't fingerprinted (e.g. a board/document publish action)", () => {
    const source = `
      await board.publish(boardId, { visibility: "public", publishedBy: userId });
    `;
    const { violations, unknowns, totalMatched } = checkFile(parse(source));
    expect(totalMatched).toBe(1); // still matched (any .publish(a,b) is looked at)...
    expect(violations).toHaveLength(0); // ...but not fingerprinted as PublishInput, so silent
    expect(unknowns).toHaveLength(0); // and it's a literal, not "unknown" either
  });

  it("does not flag a single-argument .publish() call (topic only, no input)", () => {
    const source = `
      await heartbeat.publish(topic);
    `;
    const { violations, unknowns, totalMatched } = checkFile(parse(source));
    expect(totalMatched).toBe(0);
    expect(violations).toHaveLength(0);
    expect(unknowns).toHaveLength(0);
  });

  it("respects the // perf008-messageid-ok suppression comment", () => {
    const source = `
      await queue.publish(topic, { correlationId: c, payload: p }); // perf008-messageid-ok: fire-and-forget telemetry ping, never retried
    `;
    const { violations, totalMatched } = checkFile(parse(source));
    expect(totalMatched).toBe(0); // suppressed before totalMatched is even incremented
    expect(violations).toHaveLength(0);
  });

  it("does not credit messageId supplied only via a spread (cannot verify statically — stays a violation, the safe/conservative direction)", () => {
    const source = `
      await queue.publish(topic, { ...baseEnvelopeWithMessageId, correlationId: c, payload: p });
    `;
    const { violations } = checkFile(parse(source));
    // Documented, deliberate over-report direction (nags a human to confirm,
    // rather than silently trusting a spread this guard can't see inside) —
    // see objectLiteralOwnPropertyNames()'s own doc comment.
    expect(violations).toHaveLength(1);
  });
});

describe("objectLiteralOwnPropertyNames", () => {
  it("collects plain and shorthand property names, excluding spread contents", () => {
    const source = `const x = { a: 1, b, ...rest };`;
    const sf = parse(source);
    let names;
    function visit(node) {
      if (ts.isObjectLiteralExpression(node)) names = objectLiteralOwnPropertyNames(node);
      ts.forEachChild(node, visit);
    }
    visit(sf);
    expect([...names].sort()).toEqual(["a", "b"]);
  });
});
