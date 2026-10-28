/**
 * Avisos automáticos a los jugadores según lo que pasa en el torneo.
 * Todo corre dentro de un «savepoint»: si un aviso falla, el resultado/cambio del torneo se guarda igual.
 */
import type { Tx } from "./db";
import { entryLabel, loadCategory, type LoadedCategory } from "./category";
import { notifyEntry } from "./notify";
import type { ResolvedMatch } from "@/core/bracket";
import { dict } from "@/i18n";
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
    const where = now.courtName ? ` · ${now.courtName}` : "";
    const changed = !!(before.start || before.courtId);
    for (const [me, rival] of [[a, b], [b, a]] as const) {
      if (!me) continue;
      const r = (l: "es" | "en") => (rival ? entryLabel(lc.entryMap.get(rival)) : l === "es" ? "a definir" : "TBD");
      await notifyEntry(sp, orgId, me, {
        es: { title: changed ? "🕒 Cambio en tu partido" : "📅 Tu partido ya tiene horario", body: `${lc.tc.category_name}: vs ${r("es")} · ${now.start ? fmtDateTime(now.start, "es") : "horario a confirmar"}${where}.` },
        en: { title: changed ? "🕒 Your match has changed" : "📅 Your match is scheduled", body: `${lc.tc.category_name}: vs ${r("en")} · ${now.start ? fmtDateTime(now.start, "en") : "time to be confirmed"}${where}.` },
      }, url(lc));
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
    const label = (id: string | null) => (id ? entryLabel(lc.entryMap.get(id)) : "—");
    for (const m of after) {
      const old = before.find((x) => x.code === m.code);
      const had = new Set([old?.a, old?.b].filter((r) => r?.kind === "ENTRY").map((r) => (r as { entryId: string }).entryId));
      const stEs = dict("es").g.round(perRound.get(m.round)!).toLowerCase(), stEn = dict("en").g.round(perRound.get(m.round)!).toLowerCase();
      for (const [me, rival] of [[m.a, m.b], [m.b, m.a]] as const) {
        if (me.kind !== "ENTRY" || had.has(me.entryId)) continue;
        if (m.byeAdvance || rival.kind === "BYE") continue; // pase libre: avanza sola, se avisa en la ronda siguiente
        const known = rival.kind === "ENTRY" ? label(rival.entryId) : null;
        await notifyEntry(sp, orgId, me.entryId, {
          es: { title: m.round === 1 ? `🎉 ¡Clasificaste a ${stEs}!` : `💪 ¡Pasaste a ${stEs}!`, body: `${lc.tc.category_name}: tu rival es ${known ?? "a definir (se juega antes)"}.` },
          en: { title: m.round === 1 ? `🎉 You qualified for the ${stEn}!` : `💪 You're through to the ${stEn}!`, body: `${lc.tc.category_name}: your opponent is ${known ?? "TBD (still being played)"}.` },
        }, url(lc));
      }
      if (m.round === lastRound && m.winner && old?.winner !== m.winner && !m.staleResult) {
        await notifyEntry(sp, orgId, m.winner, {
          es: { title: "🏆 ¡Campeones!", body: `Ganaron ${lc.tc.category_name} de ${lc.tc.tournament_name}. ¡Felicitaciones!` },
          en: { title: "🏆 Champions!", body: `You won ${lc.tc.category_name} at ${lc.tc.tournament_name}. Congratulations!` },
        }, url(lc));
      }
    }
  });
}
