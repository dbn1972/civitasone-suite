-- 0010: Dispatch enclosures (Wave 3 A4)
-- When an outgoing DFA is dispatched to another ministry/office, it should
-- carry the formal enclosures from its parent file: the approved green
-- note-sheet, the originating DAK, and file attachments. Stored as a jsonb
-- manifest of {type, ref, label} on the dispatch record.
ALTER TABLE files.estab_dispatch
  ADD COLUMN IF NOT EXISTS enclosures JSONB NOT NULL DEFAULT '[]'::jsonb;
