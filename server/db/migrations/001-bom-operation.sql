-- Existing installs: link each BOM line to the routing step that consumes it (idempotent).
ALTER TABLE bom ADD COLUMN IF NOT EXISTS operation_id uuid REFERENCES operations(id) ON DELETE SET NULL;
