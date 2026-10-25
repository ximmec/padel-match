-- Nuevo orden de desempate por defecto: ganados → dif. sets → dif. games → resultado entre sí → sorteo.
-- Torneos terminados o cancelados conservan el orden con el que se jugaron.
UPDATE tournament_categories tc SET rules = jsonb_set(COALESCE(tc.rules, '{}'::jsonb), '{tiebreaks}', '["WINS","HEAD_TO_HEAD","SET_DIFF","GAME_DIFF","MANUAL"]'::jsonb)
FROM tournaments t
WHERE t.id = tc.tournament_id AND t.status IN ('FINISHED', 'CANCELLED')
  AND (tc.rules->'tiebreaks' IS NULL OR jsonb_array_length(tc.rules->'tiebreaks') = 0);
-- Los que están en juego y usaban el orden por defecto anterior pasan al nuevo.
UPDATE tournament_categories tc SET rules = jsonb_set(tc.rules, '{tiebreaks}', '["WINS","SET_DIFF","GAME_DIFF","HEAD_TO_HEAD","MANUAL"]'::jsonb)
FROM tournaments t
WHERE t.id = tc.tournament_id AND t.status NOT IN ('FINISHED', 'CANCELLED')
  AND tc.rules->'tiebreaks' = '["WINS","HEAD_TO_HEAD","SET_DIFF","GAME_DIFF","MANUAL"]'::jsonb;
