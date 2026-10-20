-- Datos extra del torneo para la tarjeta pública y la inscripción.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS start_time  time;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS entry_fee   integer CHECK (entry_fee IS NULL OR entry_fee >= 0);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS max_entries integer CHECK (max_entries IS NULL OR max_entries BETWEEN 2 AND 512);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS logo        text;   -- imagen chica (data URL), se recorta en círculo
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS card_bg     text NOT NULL DEFAULT 'cancha';
