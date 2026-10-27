/**
 * Avisos automáticos a los jugadores según lo que pasa en el torneo.
 * Todo corre dentro de un «savepoint»: si un aviso falla, el resultado/cambio del torneo se guarda igual.
 */
import type { Tx } from "./db";
import { entryLabel, loadCategory, type LoadedCategory } from "./category";
import { notifyEntry } from "./notify";
import { roundName, type ResolvedMatch } from "@/core/bracket";
import { fmtDateTime } from "@/lib/format";

async function safe(tx: Tx, fn: (sp: Tx) => Promise<void>) {
  try { await tx.savepoint((sp) => fn(sp as unknown as Tx)); } catch (e) {
    console.error("aviso automático", e);
    if (process.env.NOTIFY_STRICT === "1") throw e;
  }
}

const url = (lc: LoadedCategory) => `/t/${lc.tc.tournament_slug}/c/${lc.tc.id}`;

/** Parejas de un partido (zona: guardadas; cuadro: las que hoy ocupan cada lado). */
function sidesOf(lc: LoadedCategory, matchId: string): [string | null, string | null] {
  const m = lc.matches.find((x) => x.id === matchId);
  if (!m) return [null, null];
  if (m.phase === "ZONE") return [m.entry_a, m.entry_b];
  const rm = lc.view.bracket.find((b) => b.code === m.bracket_code);
  return [rm?.a.kind === "ENTRY" ? rm.a.entryId : null, rm?.b.kind === "ENTRY" ? rm.b.entryId : null];
}

/** Cambió el horario o la cancha de un partido. */
export async function notifyScheduleChange(tx: Tx, orgId: string, tcId: string, matchId: string, before: { courtId: string | null; start: Date | null }, now: { courtName: string | null; courtId: string | null; start: Date | null }) {
  if (before.courtId === now.courtId && (before.start?.getTime() ?? null) === (now.start?.getTime() ?? null)) return;
  if (!now.start && !now.courtId) return;
  await safe(tx, async (sp) => {
    const lc = await loadCategory(sp, tcId, orgId);
    const m = lc.matches.find((x) => x.id === matchId);
    if (!m || m.status === "PLAYED" || m.status === "ANNULLED") return;
    const [a, b] = sidesOf(lc, matchId);
    const when = now.start ? fmtDateTime(now.start) : "horario a confirmar";
    const where = now.courtName ? ` · ${now.courtName}` : "";
    const title = before.start || before.courtId ? "🕒 Cambio en tu partido" : "📅 Tu partido ya tiene horario";
    for (const [me, rival] of [[a, b], [b, a]] as const) {
      if (!me) continue;
      await notifyEntry(sp, orgId, me, title, `${lc.tc.category_name}: vs ${rival ? entryLabel(lc.entryMap.get(rival)) : "a definir"} · ${when}${where}.`, url(lc));
    }
  });
}

/** Parejas que aparecen nuevas en el cuadro (clasificaron o ganaron y avanzaron), y campeones. */
export async function notifyBracketProgress(tx: Tx, orgId: string, lc: LoadedCategory, before: ResolvedMatch[], after: ResolvedMatch[]) {
  if (!after.length) return;
  await safe(tx, async (sp) => {
    const perRound = new Map<number, number>();
    for (const m of after) perRound.set(m.round, (perRound.get(m.round) ?? 0) + 1);
    const lastRound = Math.max(...after.map((m) => m.round));
    const label = (id: string | null) => (id ? entryLabel(lc.entryMap.get(id)) : "a definir");
    for (const m of after) {
      const old = before.find((x) => x.code === m.code);
      const had = new Set([old?.a, old?.b].filter((r) => r?.kind === "ENTRY").map((r) => (r as { entryId: string }).entryId));
      const stage = roundName(perRound.get(m.round)!);
      for (const [me, rival] of [[m.a, m.b], [m.b, m.a]] as const) {
        if (me.kind !== "ENTRY" || had.has(me.entryId)) continue;
        if (m.byeAdvance || rival.kind === "BYE") continue; // pase libre: avanza sola, se avisa en la ronda siguiente
        const title = m.round === 1 ? `🎉 ¡Clasificaste a ${stage.toLowerCase()}!` : `💪 ¡Pasaste a ${stage.toLowerCase()}!`;
        await notifyEntry(sp, orgId, me.entryId, title, `${lc.tc.category_name}: tu rival es ${rival.kind === "ENTRY" ? label(rival.entryId) : "a definir (se juega antes)"}.`, url(lc));
      }
      if (m.round === lastRound && m.winner && old?.winner !== m.winner && !m.staleResult) {
        await notifyEntry(sp, orgId, m.winner, "🏆 ¡Campeones!", `Ganaron ${lc.tc.category_name} de ${lc.tc.tournament_name}. ¡Felicitaciones!`, url(lc));
      }
    }
  });
}
