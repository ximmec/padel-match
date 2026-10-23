-- Datos del circuito (ej. BLOKO PADEL TOUR): descripción y logo propio.
ALTER TABLE circuits ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE circuits ADD COLUMN IF NOT EXISTS logo text;
