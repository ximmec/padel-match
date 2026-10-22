-- Zonas de 4 con formato GvG/PvP (ganadores vs ganadores y perdedores vs perdedores).
ALTER TABLE zones ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'RR' CHECK (format IN ('RR','GVG'));
-- Segunda ronda de una zona GvG: 'GVG' (ganadores) o 'PVP' (perdedores). Las parejas se completan al terminar la 1ª ronda.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS slot text CHECK (slot IS NULL OR slot IN ('GVG','PVP'));
-- Restricción horaria de cada pareja (todos los días del torneo).
ALTER TABLE entries ADD COLUMN IF NOT EXISTS not_before time;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS not_after time;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS restriction_note text;
-- Opciones del torneo.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS no_schedule boolean NOT NULL DEFAULT false;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS ignore_restrictions boolean NOT NULL DEFAULT false;
