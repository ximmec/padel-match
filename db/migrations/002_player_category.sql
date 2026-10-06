-- Categoría o nivel del jugador (ej. "4ta", "6ta", "Principiante"). Texto libre.
ALTER TABLE players ADD COLUMN IF NOT EXISTS category text;
CREATE INDEX IF NOT EXISTS players_category_idx ON players(org_id, lower(category)) WHERE deleted_at IS NULL;
