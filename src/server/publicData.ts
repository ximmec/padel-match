import { sql } from "./db";

export interface PublicTournament {
  id: string; name: string; slug: string; start_date: string; end_date: string; status: string; venue: string | null; address: string | null;
  org_name: string; org_slug: string; org_id: string; rules_text: string | null;
}

export async function publicTournamentBySlug(slug: string): Promise<PublicTournament | null> {
  const [t] = await sql<PublicTournament[]>`
    SELECT t.id, t.name, t.slug, t.start_date, t.end_date, t.status, v.name AS venue, v.address, o.name AS org_name, o.slug AS org_slug, o.id AS org_id, t.rules_text
    FROM tournaments t JOIN organizations o ON o.id = t.org_id LEFT JOIN venues v ON v.id = t.venue_id
    WHERE t.slug = ${slug} AND t.is_public AND t.status <> 'DRAFT'`;
  return t ?? null;
}

export async function publicTournamentCategories(tournamentId: string) {
  return sql<{ id: string; name: string; status: string; entries: number }[]>`
    SELECT tc.id, c.name, tc.status, (SELECT count(*)::int FROM entries e WHERE e.tc_id = tc.id AND e.status = 'ACTIVE') AS entries
    FROM tournament_categories tc JOIN categories c ON c.id = tc.category_id WHERE tc.tournament_id = ${tournamentId} ORDER BY c.name`;
}
