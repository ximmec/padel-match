import Link from "next/link";
import { StatusBadge } from "@/components/views";
import { Icon } from "@/components/Icon";
import { fmtDate } from "@/lib/format";
import { cardBgUrl, fmtMoney } from "@/lib/cardBg";

export type Row = { circuit_name?: string | null; circuit_logo?: string | null; id: string; name: string; slug: string; start_date: string; end_date: string; start_time: string | null; entry_fee: number | null; max_entries: number | null; logo: string | null; card_bg: string; status: string; venue: string | null; org_name: string; categories: string | null; entries: number };

export function TournamentCard({ t }: { t: Row }) {
  const cats = (t.categories ?? "").split(" · ").filter(Boolean);
  const url = cardBgUrl(t.card_bg);
  return (
    <Link href={`/t/${t.slug}`} className="tcard2 tcard2-public" style={{ backgroundImage: `linear-gradient(90deg, rgba(8,8,10,.96) 0%, rgba(8,8,10,.82) 45%, rgba(8,8,10,.55) 100%)${url ? `, url(${url})` : ""}` }}>
      <div className="tcard2-top row"><StatusBadge status={t.status} />{t.circuit_name && <span className="badge info">🌎 {t.circuit_name}</span>}</div>
      <div className="tcard2-body">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="tcard2-logo" src={t.logo ?? t.circuit_logo ?? "/mark.webp"} alt="" width={84} height={84} />
        <div style={{ minWidth: 0 }}>
          <div className="tcard2-cats">{cats.join(" · ") || t.org_name}</div>
          <h3 className="tcard2-name">{t.name}</h3>
          <div className="tcard2-meta"><Icon name="calendar" size={18} /> {fmtDate(t.start_date)}{t.end_date !== t.start_date ? ` – ${fmtDate(t.end_date)}` : ""}{t.start_time ? ` · ${t.start_time.slice(0, 5)}` : ""}</div>
          {t.venue && <div className="tcard2-meta"><Icon name="pin" size={18} /> {t.venue}</div>}
        </div>
      </div>
      <div className="tcard2-foot">
        <div className="tstat"><Icon name="users" size={20} /><span><b>{t.entries}{t.max_entries ? `/${t.max_entries}` : ""}</b><small>Parejas</small></span></div>
        {t.entry_fee != null && <div className="tstat"><Icon name="tag" size={20} /><span><b>{fmtMoney(t.entry_fee)}</b><small>Inscripción</small></span></div>}
        <span className="btn primary pill" style={{ marginLeft: "auto" }}>Ver detalle</span>
      </div>
    </Link>
  );
}

