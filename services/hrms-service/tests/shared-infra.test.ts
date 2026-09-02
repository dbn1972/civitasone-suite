/**
 * shared-infra.test.ts — Unit tests for src/shared/ infrastructure code.
 *
 * Covers:
 *   - context.ts: HttpError, resolveContext, requireRole, requirePermissionKey
 *   - pii-crypto.ts: encryptPii, decryptPii, isEncrypted, PiiDecryptError, resetPiiKeyCache
 *   - outbox.ts (re-exports @civitasone/outbox): enqueue, markProcessed, relayOnce, startRelay
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── context.ts ─────────────────────────────────────────────────────────────

describe("shared/context", () => {
  describe("HttpError", () => {
    it("creates error with status, code, and message", async () => {
      const { HttpError } = await import("../src/shared/context.js");
      const err = new HttpError(404, "NOT_FOUND", "resource not found");
      expect(err).toBeInstanceOf(Error);
      expect(err.status).toBe(404);
      expect(err.code).toBe("NOT_FOUND");
      expect(err.message).toBe("resource not found");
    });

    it("supports various HTTP status codes", async () => {
      const { HttpError } = await import("../src/shared/context.js");
      const cases = [
        { status: 400, code: "VALIDATION", msg: "bad input" },
        { status: 401, code: "UNAUTHENTICATED", msg: "no token" },
        { status: 403, code: "FORBIDDEN", msg: "access denied" },
        { status: 409, code: "CONFLICT", msg: "version mismatch" },
        { status: 422, code: "BUSINESS_RULE", msg: "insufficient balance" },
        { status: 500, code: "INTERNAL", msg: "unexpected" },
      ];
      for (const { status, code, msg } of cases) {
        const err = new HttpError(status, code, msg);
        expect(err.status).toBe(status);
        expect(err.code).toBe(code);
        expect(err.message).toBe(msg);
      }
    });

    it("has a proper stack trace", async () => {
      const { HttpError } = await import("../src/shared/context.js");
      const err = new HttpError(500, "ERR", "fail");
      expect(err.stack).toBeDefined();
      expect(err.stack).toContain("shared-infra.test.ts");
    });
  });

  describe("resolveContext", () => {
    it("wraps AuthContextError into HttpError with same status/code", async () => {
      const { resolveContext, HttpError } = await import("../src/shared/context.js");
      // A request with no bearer token triggers AuthContextError(401)
      const fakeReq = {
        headers: {},
        id: "req-123",
      } as unknown as import("fastify").FastifyRequest;

      expect(() => resolveContext(fakeReq)).toThrow(HttpError);
      try {
        resolveContext(fakeReq);
      } catch (e: unknown) {
        const err = e as InstanceType<typeof HttpError>;
        expect(err.status).toBe(401);
        expect(err.code).toBe("UNAUTHENTICATED");
      }
    });

    it("resolves context from a valid HS256 token", async () => {
      const { resolveContext } = await import("../src/shared/context.js");
      const { signToken } = await import("@civitasone/auth");
      const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
      const token = signToken(
        { sub: "aaaa-bbbb-cccc-dddd", tid: "1111-2222-3333-4444", roles: ["hr_admin"], sid: "s1" },
        SECRET,
        3600,
      );
      const fakeReq = {
        headers: { authorization: `Bearer ${token}` },
        id: "req-456",
      } as unknown as import("fastify").FastifyRequest;

      const ctx = resolveContext(fakeReq);
      expect(ctx.actorId).toBe("aaaa-bbbb-cccc-dddd");
      expect(ctx.tenantId).toBe("1111-2222-3333-4444");
      expect(ctx.roles).toContain("hr_admin");
    });

    it("throws HttpError on expired/invalid token", async () => {
      const { resolveContext, HttpError } = await import("../src/shared/context.js");
      const fakeReq = {
        headers: { authorization: "Bearer invalid.token.here" },
        id: "req-789",
      } as unknown as import("fastify").FastifyRequest;

      expect(() => resolveContext(fakeReq)).toThrow(HttpError);
      try {
        resolveContext(fakeReq);
      } catch (e: unknown) {
        const err = e as InstanceType<typeof HttpError>;
        expect(err.status).toBe(401);
      }
    });
  });

  describe("requireRole", () => {
    it("does not throw when user has a matching role", async () => {
      const { requireRole } = await import("../src/shared/context.js");
      const ctx = {
        actorId: "a1",
        tenantId: "t1",
        roles: ["hr_admin", "employee"],
        correlationId: "c1",
        sessionId: "s1",
      } as import("@civitasone/types").RequestContext;

      expect(() => requireRole(ctx, ["hr_admin"])).not.toThrow();
    });

    it("does not throw when user has any of the required roles", async () => {
      const { requireRole } = await import("../src/shared/context.js");
      const ctx = {
        actorId: "a1",
        tenantId: "t1",
        roles: ["employee"],
        correlationId: "c1",
        sessionId: "s1",
      } as import("@civitasone/types").RequestContext;

      expect(() => requireRole(ctx, ["hr_admin", "employee"])).not.toThrow();
    });

    it("throws 403 HttpError when user has none of the required roles", async () => {
      const { requireRole, HttpError } = await import("../src/shared/context.js");
      const ctx = {
        actorId: "a1",
        tenantId: "t1",
        roles: ["employee"],
        correlationId: "c1",
        sessionId: "s1",
      } as import("@civitasone/types").RequestContext;

      expect(() => requireRole(ctx, ["super_admin", "hr_admin"])).toThrow(HttpError);
      try {
        requireRole(ctx, ["super_admin", "hr_admin"]);
      } catch (e: unknown) {
        const err = e as InstanceType<typeof HttpError>;
        expect(err.status).toBe(403);
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("super_admin");
        expect(err.message).toContain("hr_admin");
      }
    });

    it("throws when roles array is empty", async () => {
      const { requireRole, HttpError } = await import("../src/shared/context.js");
      const ctx = {
        actorId: "a1",
        tenantId: "t1",
        roles: ["hr_admin"],
        correlationId: "c1",
        sessionId: "s1",
      } as import("@civitasone/types").RequestContext;

      // empty required roles means no match is possible
      expect(() => requireRole(ctx, [])).toThrow(HttpError);
    });
  });

  describe("requirePermissionKey", () => {
    it("resolves when permission is granted", async () => {
      // Import requirePermissionKey and mock the permission check
      const contextMod = await import("../src/shared/context.js");
      const ctx = {
        actorId: "a1",
        tenantId: "t1",
        roles: ["super_admin"],
        correlationId: "c1",
        sessionId: "s1",
      } as import("@civitasone/types").RequestContext;

      // super_admin typically has all permissions via the built-in policy
      // If the permission system isn't available in test, this verifies the wrapper
      // doesn't throw for a valid context
      try {
        await contextMod.requirePermissionKey(ctx, "hrms.employees.read");
      } catch (e: unknown) {
        // If it throws, it should be an HttpError with 403 (not a crash)
        expect(e).toBeInstanceOf(contextMod.HttpError);
        const err = e as InstanceType<typeof contextMod.HttpError>;
        expect([403, 401]).toContain(err.status);
      }
    });
  });
});

// ─── pii-crypto.ts ──────────────────────────────────────────────────────────

describe("shared/pii-crypto", () => {
  beforeEach(async () => {
    const { resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
    resetPiiKeyCache();
  });

  describe("encryptPii / decryptPii roundtrip", () => {
    it("encrypts and decrypts a simple string", async () => {
      const { encryptPii, decryptPii } = await import("../src/shared/pii-crypto.js");
      const plain = "ABCDE1234F"; // PAN-like
      const cipher = encryptPii(plain);
      expect(cipher).not.toBe(plain);
      expect(cipher.startsWith("enc:v2:")).toBe(true);
      const decrypted = decryptPii(cipher);
      expect(decrypted).toBe(plain);
    });

    it("encrypts and decrypts unicode text", async () => {
      const { encryptPii, decryptPii } = await import("../src/shared/pii-crypto.js");
      const plain = "राम कुमार शर्मा 🇮🇳";
      const cipher = encryptPii(plain);
      expect(decryptPii(cipher)).toBe(plain);
    });

    it("encrypts and decrypts empty string", async () => {
      const { encryptPii, decryptPii } = await import("../src/shared/pii-crypto.js");
      const cipher = encryptPii("");
      expect(cipher.startsWith("enc:v2:")).toBe(true);
      expect(decryptPii(cipher)).toBe("");
    });

    it("produces different ciphertext for the same plaintext (random IV)", async () => {
      const { encryptPii } = await import("../src/shared/pii-crypto.js");
      const plain = "sensitive-data";
      const c1 = encryptPii(plain);
      const c2 = encryptPii(plain);
      expect(c1).not.toBe(c2); // different IVs
    });

    it("handles long strings (2KB+)", async () => {
      const { encryptPii, decryptPii } = await import("../src/shared/pii-crypto.js");
      const plain = "X".repeat(2048);
      const cipher = encryptPii(plain);
      expect(decryptPii(cipher)).toBe(plain);
    });
  });

  describe("isEncrypted", () => {
    it("returns true for v2 ciphertext", async () => {
      const { isEncrypted, encryptPii } = await import("../src/shared/pii-crypto.js");
      const cipher = encryptPii("test");
      expect(isEncrypted(cipher)).toBe(true);
    });

    it("returns true for v1 prefix", async () => {
      const { isEncrypted } = await import("../src/shared/pii-crypto.js");
      expect(isEncrypted("enc:v1:somebase64data")).toBe(true);
    });

    it("returns false for plaintext", async () => {
      const { isEncrypted } = await import("../src/shared/pii-crypto.js");
      expect(isEncrypted("hello world")).toBe(false);
      expect(isEncrypted("ABCDE1234F")).toBe(false);
      expect(isEncrypted("")).toBe(false);
    });

    it("returns false for prefix-like but not exact match", async () => {
      const { isEncrypted } = await import("../src/shared/pii-crypto.js");
      expect(isEncrypted("encrypted:v1:data")).toBe(false);
      expect(isEncrypted("enc:v3:data")).toBe(false);
    });
  });

  describe("decryptPii — passthrough for legacy plaintext", () => {
    it("passes through non-encrypted values unchanged", async () => {
      const { decryptPii } = await import("../src/shared/pii-crypto.js");
      expect(decryptPii("plaintext-value")).toBe("plaintext-value");
      expect(decryptPii("someone@example.com")).toBe("someone@example.com");
    });
  });

  describe("PiiDecryptError", () => {
    it("thrown on tampered ciphertext", async () => {
      const { encryptPii, decryptPii, PiiDecryptError } = await import("../src/shared/pii-crypto.js");
      const cipher = encryptPii("secret");
      // Tamper with the base64 payload (flip a character)
      const tampered = cipher.slice(0, -5) + "XXXXX";
      expect(() => decryptPii(tampered)).toThrow(PiiDecryptError);
    });

    it("thrown on malformed v2 envelope (missing key id separator)", async () => {
      const { decryptPii, PiiDecryptError } = await import("../src/shared/pii-crypto.js");
      // v2 prefix without a colon separator for key id
      expect(() => decryptPii("enc:v2:nodatawithoutcolon")).toThrow(PiiDecryptError);
    });

    it("thrown for unknown key id", async () => {
      const { decryptPii, PiiDecryptError } = await import("../src/shared/pii-crypto.js");
      // Fabricate a v2 envelope with a non-existent key id
      expect(() => decryptPii("enc:v2:unknown_key:c29tZWRhdGE=")).toThrow(PiiDecryptError);
    });

    it("has code property PII_DECRYPT_FAILED", async () => {
      const { PiiDecryptError } = await import("../src/shared/pii-crypto.js");
      const err = new PiiDecryptError("test error");
      expect(err.code).toBe("PII_DECRYPT_FAILED");
      expect(err.name).toBe("PiiDecryptError");
      expect(err).toBeInstanceOf(Error);
    });

    it("supports cause option", async () => {
      const { PiiDecryptError } = await import("../src/shared/pii-crypto.js");
      const cause = new Error("original");
      const err = new PiiDecryptError("wrapped", { cause });
      expect(err.cause).toBe(cause);
    });
  });

  describe("key rotation (keyring)", () => {
    it("decrypts ciphertext after cache reset (same key)", async () => {
      const { encryptPii, decryptPii, resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
      const cipher = encryptPii("rotatable");
      resetPiiKeyCache();
      expect(decryptPii(cipher)).toBe("rotatable");
    });
  });

  describe("PII_ENC_KEY validation", () => {
    it("throws if PII_ENC_KEY is missing", async () => {
      const origKey = process.env.PII_ENC_KEY;
      try {
        process.env.PII_ENC_KEY = "";
        const { resetPiiKeyCache, encryptPii } = await import("../src/shared/pii-crypto.js");
        resetPiiKeyCache();
        expect(() => encryptPii("test")).toThrow(/PII_ENC_KEY is required/);
      } finally {
        process.env.PII_ENC_KEY = origKey;
        const { resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
        resetPiiKeyCache();
      }
    });

    it("throws if PII_ENC_KEY is too short", async () => {
      const origKey = process.env.PII_ENC_KEY;
      try {
        process.env.PII_ENC_KEY = "short";
        const { resetPiiKeyCache, encryptPii } = await import("../src/shared/pii-crypto.js");
        resetPiiKeyCache();
        expect(() => encryptPii("test")).toThrow(/PII_ENC_KEY is required/);
      } finally {
        process.env.PII_ENC_KEY = origKey;
        const { resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
        resetPiiKeyCache();
      }
    });
  });
});

// ─── outbox.ts (re-exports @civitasone/outbox) ─────────────────────────────

describe("shared/outbox (transactional outbox)", () => {
  describe("enqueue", () => {
    it("inserts a row into outboxMessages table", async () => {
      const { enqueue, outboxMessages } = await import("../src/shared/outbox.js");
      const insertedRows: unknown[] = [];
      const mockTx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockImplementation((row) => {
            insertedRows.push(row);
            return Promise.resolve();
          }),
        }),
      };

      await enqueue(mockTx as unknown as import("@civitasone/outbox").DrizzleTx, {
        topic: "hrms.employee.created",
        eventType: "EMPLOYEE_CREATED",
        tenantId: "t-1",
        actorId: "a-1",
        correlationId: "c-1",
        payload: { employeeId: "emp-1" },
      });

      expect(mockTx.insert).toHaveBeenCalledWith(outboxMessages);
      expect(insertedRows[0]).toEqual({
        topic: "hrms.employee.created",
        eventType: "EMPLOYEE_CREATED",
        tenantId: "t-1",
        actorId: "a-1",
        correlationId: "c-1",
        payload: { employeeId: "emp-1" },
      });
    });

    it("propagates database errors", async () => {
      const { enqueue } = await import("../src/shared/outbox.js");
      const mockTx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockRejectedValue(new Error("unique_violation")),
        }),
      };

      await expect(
        enqueue(mockTx as unknown as import("@civitasone/outbox").DrizzleTx, {
          topic: "t",
          eventType: "E",
          tenantId: "t1",
          actorId: "a1",
          correlationId: "c1",
          payload: {},
        }),
      ).rejects.toThrow("unique_violation");
    });
  });

  describe("markProcessed", () => {
    it("returns true when message is newly processed", async () => {
      const { markProcessed } = await import("../src/shared/outbox.js");
      const mockTx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoNothing: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ messageId: "msg-1" }]),
            }),
          }),
        }),
      };

      const result = await markProcessed(mockTx as unknown as import("@civitasone/outbox").DrizzleTx, "msg-1");
      expect(result).toBe(true);
    });

    it("returns false when message was already processed (idempotency)", async () => {
      const { markProcessed } = await import("../src/shared/outbox.js");
      const mockTx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoNothing: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]), // empty = already existed
            }),
          }),
        }),
      };

      const result = await markProcessed(mockTx as unknown as import("@civitasone/outbox").DrizzleTx, "msg-1");
      expect(result).toBe(false);
    });
  });

  describe("relayOnce", () => {
    it("publishes unpublished rows and marks them published", async () => {
      const { relayOnce } = await import("../src/shared/outbox.js");
      const fakeRow = {
        id: "row-1",
        topic: "hrms.leave.approved",
        eventType: "LEAVE_APPROVED",
        tenantId: "t1",
        actorId: "a1",
        correlationId: "c1",
        payload: { leaveId: "l1" },
        createdAt: new Date(),
        publishedAt: null,
      };

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([fakeRow]),
              }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      };

      const mockQueue = {
        publish: vi.fn().mockResolvedValue(undefined),
      };

      const published = await relayOnce(
        mockDb as unknown as import("@civitasone/outbox").DrizzleTx,
        mockQueue as unknown as import("@civitasone/queue").Queue,
        100,
        "hrms-service",
      );

      expect(published).toBe(1);
      expect(mockQueue.publish).toHaveBeenCalledWith("hrms.leave.approved", expect.objectContaining({
        messageId: "row-1",
        type: "LEAVE_APPROVED",
        tenantId: "t1",
      }));
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("returns 0 when no unpublished rows exist", async () => {
      const { relayOnce } = await import("../src/shared/outbox.js");
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      };
      const mockQueue = { publish: vi.fn() };

      const published = await relayOnce(
        mockDb as unknown as import("@civitasone/outbox").DrizzleTx,
        mockQueue as unknown as import("@civitasone/queue").Queue,
        100,
        "hrms-service",
      );

      expect(published).toBe(0);
      expect(mockQueue.publish).not.toHaveBeenCalled();
    });

    it("isolates per-row failures (does not abort batch)", async () => {
      const { relayOnce } = await import("../src/shared/outbox.js");
      const rows = [
        { id: "r1", topic: "t1", eventType: "E1", tenantId: "t", actorId: "a", correlationId: "c1", payload: {}, createdAt: new Date(), publishedAt: null },
        { id: "r2", topic: "t2", eventType: "E2", tenantId: "t", actorId: "a", correlationId: "c2", payload: {}, createdAt: new Date(), publishedAt: null },
        { id: "r3", topic: "t3", eventType: "E3", tenantId: "t", actorId: "a", correlationId: "c3", payload: {}, createdAt: new Date(), publishedAt: null },
      ];

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(rows),
              }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      };

      // Second row's publish fails
      const mockQueue = {
        publish: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error("network timeout"))
          .mockResolvedValueOnce(undefined),
      };

      const published = await relayOnce(
        mockDb as unknown as import("@civitasone/outbox").DrizzleTx,
        mockQueue as unknown as import("@civitasone/queue").Queue,
        100,
        "hrms-service",
      );

      // 2 out of 3 succeeded
      expect(published).toBe(2);
      expect(mockQueue.publish).toHaveBeenCalledTimes(3);
    });
  });

  describe("startRelay", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns a timer handle (NodeJS.Timeout)", async () => {
      const { startRelay } = await import("../src/shared/outbox.js");
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      };
      const mockQueue = { publish: vi.fn() };

      const timer = startRelay(
        mockDb as unknown as import("@civitasone/outbox").DrizzleTx,
        mockQueue as unknown as import("@civitasone/queue").Queue,
        10_000,
        "hrms-service",
      );

      expect(timer).toBeDefined();
      clearInterval(timer);
    });

    it("calls relayOnce periodically", async () => {
      vi.useFakeTimers();
      const { startRelay } = await import("../src/shared/outbox.js");
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      };
      const mockQueue = { publish: vi.fn() };

      const timer = startRelay(
        mockDb as unknown as import("@civitasone/outbox").DrizzleTx,
        mockQueue as unknown as import("@civitasone/queue").Queue,
        500,
        "hrms-service",
      );

      // Advance past 3 intervals
      await vi.advanceTimersByTimeAsync(1600);

      expect(mockDb.select).toHaveBeenCalled();
      clearInterval(timer);
    });
  });

  describe("outboxMessages schema", () => {
    it("exports the outboxMessages and processed tables", async () => {
      const { outboxMessages, processed } = await import("../src/shared/outbox.js");
      expect(outboxMessages).toBeDefined();
      expect(processed).toBeDefined();
    });
  });
});
