-- Cuentas de jugadores (separadas de las cuentas del panel), dispositivos para notificaciones push
-- y notificaciones enviadas.
CREATE TABLE IF NOT EXISTS app_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email         text NOT NULL,
  name          text NOT NULL,
  password_hash text NOT NULL,
  phone         text,
  document      text,
  player_id     uuid REFERENCES players(id) ON DELETE SET NULL,
  link_status   text NOT NULL DEFAULT 'NONE' CHECK (link_status IN ('NONE','PENDING','APPROVED')),
  link_note     text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  UNIQUE (org_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS player_accounts_player_uq ON player_accounts(player_id) WHERE link_status = 'APPROVED';

CREATE TABLE IF NOT EXISTS player_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS player_sessions_account_idx ON player_sessions(account_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_ok_at  timestamptz,
  failures    int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subscriptions_account_idx ON push_subscriptions(account_id);

CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'MANUAL' CHECK (kind IN ('MANUAL','AUTO')),
  title       text NOT NULL,
  body        text NOT NULL,
  url         text,
  audience    text,
  sent_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_org_idx ON notifications(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_recipients (
  notification_id  uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
  push_status      text NOT NULL DEFAULT 'PENDING' CHECK (push_status IN ('PENDING','SENDING','SENT','NO_DEVICE','FAILED')),
  read_at          timestamptz,
  PRIMARY KEY (notification_id, account_id)
);
CREATE INDEX IF NOT EXISTS notification_recipients_pending_idx ON notification_recipients(push_status) WHERE push_status IN ('PENDING','SENDING');
CREATE INDEX IF NOT EXISTS notification_recipients_account_idx ON notification_recipients(account_id);

-- Recordatorio «tu partido empieza en 15 minutos» enviado una sola vez por partido
ALTER TABLE matches ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
