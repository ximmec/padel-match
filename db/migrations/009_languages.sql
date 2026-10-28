-- Idioma de cada jugador (para la app y sus avisos) y versión en inglés de las notificaciones.
ALTER TABLE player_accounts ADD COLUMN IF NOT EXISTS lang text NOT NULL DEFAULT 'es' CHECK (lang IN ('es','en'));
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title_en text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body_en text;
