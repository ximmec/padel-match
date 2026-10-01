-- PADEL MATCH · esquema inicial
-- Todas las tablas con datos de un organizador llevan org_id para separar datos entre organizadores.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  is_superadmin  boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Roles: ADMIN (administrador general del organizador), ORGANIZER, RESULTS_OPERATOR
CREATE TABLE memberships (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('ADMIN','ORGANIZER','RESULTS_OPERATOR')),
  -- permisos extra/quitados sobre los del rol: {"grant": [...], "revoke": [...]}
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  org_id      uuid REFERENCES organizations(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE login_attempts (
  id          bigserial PRIMARY KEY,
  email       text NOT NULL,
  ip          text,
  success     boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON login_attempts(email, created_at);

-- Jugadores ---------------------------------------------------------------
CREATE TABLE players (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code        text NOT NULL,                  -- identificador único legible (ej. PM-000123)
  first_name  text NOT NULL,
  last_name   text NOT NULL,
  gender      text NOT NULL CHECK (gender IN ('M','F','X')),
  document    text,                           -- DNI u otro, opcional, para evitar duplicados
  phone       text,
  email       text,
  city        text,
  notes       text,
  deleted_at  timestamptz,                    -- baja lógica: se conserva el historial
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);
CREATE UNIQUE INDEX players_document_uq ON players(org_id, document) WHERE document IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX players_name_idx ON players(org_id, lower(last_name), lower(first_name));
CREATE SEQUENCE player_code_seq START 1;

-- Estructura de competencias ----------------------------------------------
CREATE TABLE circuits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE seasons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,                  -- ej. "4ta Masculina"
  gender_rule text NOT NULL CHECK (gender_rule IN ('MALE','FEMALE','MIXED','OPEN')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE venues (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  address    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE courts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name       text NOT NULL,
  sort       int NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true
);

-- Torneos -------------------------------------------------------------------
CREATE TABLE tournaments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                text NOT NULL,
  slug                text NOT NULL,
  venue_id            uuid REFERENCES venues(id) ON DELETE SET NULL,
  circuit_id          uuid REFERENCES circuits(id) ON DELETE SET NULL,
  season_id           uuid REFERENCES seasons(id) ON DELETE SET NULL,
  start_date          date NOT NULL,
  end_date            date NOT NULL,
  status              text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','OPEN','IN_PROGRESS','FINISHED','CANCELLED')),
  is_public           boolean NOT NULL DEFAULT true,
  rules_text          text,
  match_duration_min  int NOT NULL DEFAULT 60 CHECK (match_duration_min BETWEEN 10 AND 300),
  min_rest_min        int NOT NULL DEFAULT 30 CHECK (min_rest_min BETWEEN 0 AND 600),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug),
  CHECK (end_date >= start_date)
);

CREATE TABLE court_availability (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  court_id       uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE INDEX court_availability_t_idx ON court_availability(tournament_id);

CREATE TABLE tournament_categories (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id       uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id         uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  rules               jsonb NOT NULL DEFAULT '{}'::jsonb,   -- CategoryRules (src/core/engine.ts)
  bracket             jsonb NOT NULL DEFAULT '[]'::jsonb,   -- BracketMatchDef[]
  cross_manual_order  jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL DEFAULT 'REGISTRATION' CHECK (status IN ('REGISTRATION','ZONES','PLAYOFFS','FINISHED')),
  points_awarded_at   timestamptz,
  version             int NOT NULL DEFAULT 1,               -- control de concurrencia
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, category_id)
);

-- Inscripción de una pareja en una categoría de un torneo.
CREATE TABLE entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tc_id               uuid NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  seed                int CHECK (seed IS NULL OR seed > 0),
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','WITHDRAWN')),
  withdrawn_at        timestamptz,
  withdrawal_policy   text CHECK (withdrawal_policy IN ('WO_PENDING','ANNUL_ALL')),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entries_tc_idx ON entries(tc_id);

-- Integrantes de la pareja, con historial de reemplazos.
CREATE TABLE entry_players (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id     uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tc_id        uuid NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  player_id    uuid NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  slot         smallint NOT NULL CHECK (slot IN (1,2)),
  active       boolean NOT NULL DEFAULT true,     -- false si fue reemplazado o la pareja se retiró
  replaced_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- Un jugador no puede estar dos veces activo en la misma categoría de un torneo
CREATE UNIQUE INDEX entry_players_unique_active ON entry_players(tc_id, player_id) WHERE active;
-- Cada pareja tiene a lo sumo un integrante vigente por lugar
CREATE UNIQUE INDEX entry_players_slot_current ON entry_players(entry_id, slot) WHERE replaced_at IS NULL;

CREATE TABLE zones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tc_id         uuid NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  name          text NOT NULL,
  sort          int NOT NULL DEFAULT 0,
  manual_order  jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (tc_id, name)
);

CREATE TABLE zone_entries (
  zone_id   uuid NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  entry_id  uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tc_id     uuid NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  sort      int NOT NULL DEFAULT 0,
  PRIMARY KEY (zone_id, entry_id),
  UNIQUE (tc_id, entry_id)
);

-- Partidos ------------------------------------------------------------------
CREATE TABLE matches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tc_id           uuid NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  phase           text NOT NULL CHECK (phase IN ('ZONE','BRACKET')),
  zone_id         uuid REFERENCES zones(id) ON DELETE SET NULL,
  bracket_code    text,
  round           int NOT NULL DEFAULT 1,
  -- Zona: parejas fijas. Cuadro: parejas con las que se cargó el resultado (instantánea).
  entry_a         uuid REFERENCES entries(id) ON DELETE SET NULL,
  entry_b         uuid REFERENCES entries(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PLAY','PLAYED','ANNULLED')),
  outcome         jsonb,                          -- MatchOutcome (src/core/scoring.ts)
  court_id        uuid REFERENCES courts(id) ON DELETE SET NULL,
  scheduled_at    timestamptz,
  schedule_locked boolean NOT NULL DEFAULT false,
  version         int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((phase = 'ZONE' AND zone_id IS NOT NULL AND bracket_code IS NULL) OR (phase = 'BRACKET' AND bracket_code IS NOT NULL)),
  CHECK (status <> 'PLAYED' OR outcome IS NOT NULL)
);
CREATE UNIQUE INDEX matches_bracket_code_uq ON matches(tc_id, bracket_code) WHERE bracket_code IS NOT NULL;
CREATE INDEX matches_tc_idx ON matches(tc_id);
CREATE INDEX matches_schedule_idx ON matches(court_id, scheduled_at);

-- Historial de resultados: nunca se pisa, cada carga o corrección es una versión nueva.
CREATE TABLE match_result_versions (
  id          bigserial PRIMARY KEY,
  match_id    uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  version     int NOT NULL,
  entry_a     uuid,
  entry_b     uuid,
  status      text NOT NULL,
  outcome     jsonb,
  reason      text,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, version)
);

-- Ranking (libro contable) --------------------------------------------------
CREATE TABLE ranking_ledger (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  player_id      uuid NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  tc_id          uuid REFERENCES tournament_categories(id) ON DELETE SET NULL,
  entry_id       uuid REFERENCES entries(id) ON DELETE SET NULL,
  kind           text NOT NULL CHECK (kind IN ('AUTO','MANUAL')),
  stage          text,
  points         int NOT NULL,
  reason         text,
  category_id    uuid REFERENCES categories(id) ON DELETE SET NULL,
  circuit_id     uuid REFERENCES circuits(id) ON DELETE SET NULL,
  season_id      uuid REFERENCES seasons(id) ON DELETE SET NULL,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  superseded_at  timestamptz,      -- las asignaciones reemplazadas se conservan como historial
  CHECK (kind = 'AUTO' OR (reason IS NOT NULL AND length(trim(reason)) >= 5))
);
-- Nunca hay dos asignaciones automáticas vigentes para el mismo jugador en el mismo torneo-categoría
CREATE UNIQUE INDEX ranking_ledger_auto_uq ON ranking_ledger(player_id, tc_id) WHERE kind = 'AUTO' AND superseded_at IS NULL;
CREATE INDEX ranking_ledger_org_idx ON ranking_ledger(org_id) WHERE superseded_at IS NULL;

-- Auditoría (solo inserción) ------------------------------------------------
CREATE TABLE audit_log (
  id             bigserial PRIMARY KEY,
  org_id         uuid REFERENCES organizations(id) ON DELETE SET NULL,
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  user_name      text,
  tournament_id  uuid,
  entity         text NOT NULL,
  entity_id      text,
  action         text NOT NULL,
  summary        text,
  before         jsonb,
  after          jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_filter_idx ON audit_log(org_id, created_at DESC);
CREATE INDEX audit_log_tournament_idx ON audit_log(tournament_id, created_at DESC);

CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'El historial de auditoría no se puede modificar ni borrar';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE FUNCTION result_versions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'El historial de resultados no se puede modificar';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER result_versions_no_update BEFORE UPDATE ON match_result_versions
  FOR EACH ROW EXECUTE FUNCTION result_versions_immutable();
