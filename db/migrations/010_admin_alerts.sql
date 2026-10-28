-- Avisos para el panel (campanita): jugadores que se registran o piden vincular su ficha.
CREATE TABLE IF NOT EXISTS admin_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('REGISTER','LINK')),
  account_id  uuid REFERENCES player_accounts(id) ON DELETE CASCADE,
  title       text NOT NULL,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_events_org_idx ON admin_events(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_seen (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);

-- Las cuentas que ya existían figuran como avisos ya vistos
INSERT INTO admin_events (org_id, kind, account_id, title, created_at)
SELECT org_id, 'REGISTER', id, name || ' se registró en Mi Padel Match', created_at FROM player_accounts
WHERE NOT EXISTS (SELECT 1 FROM admin_events);
INSERT INTO admin_seen (user_id, org_id, seen_at)
SELECT user_id, org_id, now() FROM memberships WHERE role = 'ADMIN'
ON CONFLICT DO NOTHING;
