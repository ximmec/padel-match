-- Pago del arancel: se marca por jugador dentro de su pareja.
ALTER TABLE entry_players ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE entry_players ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES users(id) ON DELETE SET NULL;
