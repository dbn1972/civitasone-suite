-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: knowledge-service

SET lock_timeout = '5s';

-- ============================================================================
-- knowledge.documents.file_type — SKIPPED, genuinely open-ended (and currently
-- unwritten).
-- The column is nullable varchar(64). commands.ts (createDocument) is the
-- only writer today and always sets fileType: null on create — there is no
-- route, consumer, or upload handler anywhere in modules/documents/** (or the
-- sibling categories/retention/search/sharing/versions modules) that assigns
-- it a literal value. The read side (routes.ts, repo.ts) only ever passes it
-- through (doc.fileType ?? undefined); packages/schemas/src/web.ts types it
-- as a free-form z.string().optional(), not an enum. With zero discoverable
-- values in the current codebase, any enumeration would be a guess and could
-- reject legitimate file types (e.g. MIME-derived extensions) once a real
-- upload path is added. Left unconstrained.
-- ============================================================================

-- No constraints added — see rationale above. Nothing to VALIDATE.
