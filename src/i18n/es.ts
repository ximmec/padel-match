/**
 * Textos en español de la parte pública y de jugadores.
 * Cada texto nuevo tiene que existir también en en.ts (si falta, la app no compila).
 */
export const es = {
  locale: "es-AR",
  langName: "Español",

  nav: { tournaments: "Torneos", when: "¿Cuándo juego?", ranking: "Ranking", me: "Mi Padel Match", login: "Ingresar", create: "Crear torneo", seeTournaments: "← Ver torneos" },
  footer: {
    about: "Torneos de pádel con resultados, zonas, cuadros, horarios y ranking en vivo.",
    players: "Jugadores", live: "Torneos en curso", meLink: "Mi Padel Match (avisos en tu celular)",
    organizers: "Organizadores", panel: "Ingresar al panel",
  },
  lang: { choose: "Idioma", es: "Español", en: "English" },

  status: {
    PENDING: "Pendiente", IN_PLAY: "En juego", PLAYED: "Finalizado", ANNULLED: "Anulado", DRAFT: "Borrador",
    OPEN: "Inscripción abierta", IN_PROGRESS: "En curso", FINISHED: "Finalizado", CANCELLED: "Cancelado",
    REGISTRATION: "Inscripción", ZONES: "Fase de zonas", PLAYOFFS: "Playoffs", ACTIVE: "Activa", WITHDRAWN: "Retirada",
  } as Record<string, string>,

  // Términos del juego
  g: {
    zone: (n: string) => `Zona ${n}`,
    tbd: "A definir",
    bye: "Pase libre",
    winnerOf: (code: string) => `Ganador ${code}`,
    winnerMatch: (n: number) => `Ganador del partido ${n}`,
    loserMatch: (n: number) => `Perdedor del partido ${n}`,
    zonePos: (pos: number, zone: string) => `${pos}° Zona ${zone}`,
    bestPos: (rank: number, pos: number) => `${rank}° mejor ${pos}°`,
    round: (matches: number) => ({ 1: "Final", 2: "Semifinal", 4: "Cuartos de final", 8: "Octavos de final", 16: "16avos de final", 32: "32avos de final" } as Record<number, string>)[matches] ?? `Ronda de ${matches * 2}`,
    stage: {
      CHAMPION: "Campeón", FINALIST: "Subcampeón", SEMIFINAL: "Semifinal", QUARTERFINAL: "Cuartos de final",
      ROUND_OF_16: "Octavos de final", ROUND_OF_32: "16avos de final", ROUND_OF_64: "32avos de final", ZONE: "Fase de zonas / participación",
    } as Record<string, string>,
    tiebreak: {
      WINS: "Partidos ganados", HEAD_TO_HEAD: "Resultado entre sí", SET_DIFF: "Diferencia de sets", GAME_DIFF: "Diferencia de games",
      SETS_WON: "Sets a favor", GAMES_WON: "Games a favor", WIN_RATIO: "% de partidos ganados", MANUAL: "Sorteo / decisión manual",
    } as Record<string, string>,
    format: (f: { setsToWin: number; gamesPerSet: number; tiebreak: boolean; superTiebreakDecider: boolean; tb: number }) => {
      const tb = f.tiebreak && f.tb !== f.gamesPerSet ? ` · tiebreak en ${f.tb}-${f.tb}` : "";
      if (f.setsToWin === 1) return (f.gamesPerSet === 6 ? "A un set" : `Un set a ${f.gamesPerSet} games`) + tb;
      return `Al mejor de ${f.setsToWin * 2 - 1} sets${f.superTiebreakDecider ? " (super tiebreak en el último)" : ""}${tb}`;
    },
    retired: "ret.",
    wo: "W.O.",
  },

  live: { on: "En vivo", off: "Sin conexión", hint: "La página se actualiza sola cuando hay resultados u horarios nuevos" },

  card: { pairs: "Parejas", fee: "Inscripción", details: "Ver detalle" },

  home: {
    kicker: "Torneos · Zonas · Playoffs · Ranking",
    circuitsL: "circuitos",
    featTitle1: "Todo lo que necesitás", featTitle2: "para seguir tu torneo",
    featLead: "Desde la inscripción hasta la final: horarios, resultados y avisos al instante.",
    features: [
      ["Torneos", "Zonas, posiciones y cuadros que se actualizan con cada resultado.", "Ver torneos"],
      ["¿Cuándo juego?", "Buscá tu nombre y enterate el horario y la cancha de tu próximo partido.", "Buscar mi partido"],
      ["Ranking", "Puntos por instancia alcanzada, torneo tras torneo y por circuito.", "Ver ranking"],
      ["Mi Padel Match", "Instalá la app y recibí avisos de horarios, cambios y resultados.", "Activar avisos"],
    ] as [string, string, string][],
    title1: "Tu torneo de pádel,", title2: "en tiempo real",
    lead: "Zonas, resultados, cuadros, horarios y ranking en un solo lugar. Buscá tu nombre y enterate cuándo y en qué cancha jugás.",
    searchPh: "Buscá tu nombre o apellido…", searchAria: "Buscar jugador", search: "Buscar",
    organizers: "Organizadores", tournamentsL: "torneos", playersL: "jugadores", playedL: "partidos jugados",
    liveNow: "Jugándose ahora", upcoming: "Próximos torneos", finished: "Finalizados", empty: "Todavía no hay torneos publicados. ¡Volvé pronto!",
    how: "Cómo funciona",
    steps: [
      ["01", "Inscripción", "Las parejas se inscriben por categoría: Beginner, Advanced, masculina, femenina o mixta."],
      ["02", "Zonas", "Zonas sorteadas y posiciones que se actualizan solas con cada resultado."],
      ["03", "Playoffs", "Cuadro eliminatorio automático hasta la final, con horarios y canchas."],
      ["04", "Ranking", "Cada jugador suma puntos según la instancia alcanzada, torneo tras torneo."],
    ] as [string, string, string][],
  },

  tournament: {
    fallbackTitle: "Torneo", to: "al", searchPh: "Buscá tu nombre para ver tus partidos", search: "Buscar",
    liveNow: "🔴 Jugándose ahora", inPlay: "En juego", upcoming: "Próximos partidos", noUpcoming: "No hay partidos programados por ahora.",
    results: "Últimos resultados", noResults: "Todavía no hay resultados.",
    rankingThis: "🏆 Ranking de este torneo", circuit: (n: string) => `🌎 Circuito ${n}`, rankingCircuit: (n: string) => `🏆 Ranking ${n}`,
    noSchedule: "Los horarios de este torneo se asignan en el momento desde la mesa de control.", info: "Información",
  },

  category: {
    knockout: "eliminación directa",
    qualify: (per: string, best: string) => `clasifican ${per}${best}`,
    all: "todas", perZone: (n: number) => `${n} por zona`, best: (n: number, pos: number) => ` + ${n} mejores ${pos}°`,
    fixed: (n: number) => `siempre ${n} al playoff`,
    tabs: { zonas: "Zonas y posiciones", partidos: "Partidos", cuadro: "Cuadro", parejas: "Parejas" } as Record<string, string>,
    noZones: "Las zonas todavía no fueron sorteadas.", playoffs: "Playoffs", pair: "Pareja", seed: "Siembra", zone: "Zona",
  },

  standings: {
    defined: "Definida", tie: "Empate a resolver", pending: (n: number) => `${n} partido(s) pendiente(s)`,
    pair: "Pareja", pj: "PJ", pg: "PG", pp: "PP", pjT: "Partidos jugados", pgT: "Ganados", ppT: "Perdidos", sets: "Sets", games: "Games",
    decided: "Definido por", unresolved: "⚠ Empate sin resolver", withdrawn: "Retirada",
  },
  bracket: { none: "El cuadro todavía no fue generado.", review: "Resultado a revisar" },

  search: {
    title: "¿Cuándo juego?", lead: "Buscá tu nombre para ver tu pareja, zona, próximos partidos, cancha y horario.",
    ph: "Nombre y/o apellido", button: "Buscar", none: (q: string) => `No encontramos jugadores con «${q}» en torneos publicados.`,
    noCurrent: "Sin torneos en curso", see: "Ver partidos →",
  },

  player: {
    pts: (n: number) => `${n} pts de ranking`, pair: "Pareja", seeCategory: "Ver categoría", withdrawn: "La pareja figura como retirada.",
    next: "Próximos partidos", noNext: "No hay partidos pendientes.", results: "Resultados", noResults: "Todavía no jugó.",
    notPlaying: "No está inscripto en torneos en curso.", history: "Historial de puntos", fullRanking: "Ranking completo",
    tournament: "Torneo", stage: "Instancia", points: "Puntos", adjust: "Ajuste", adjustR: (r: string) => `Ajuste: ${r}`,
    noPoints: "Sin puntos todavía.", previous: "Torneos anteriores",
  },

  ranking: {
    title: "Ranking", none: "Todavía no hay rankings publicados.", sub: (org: string) => `${org} · puntos individuales acumulados`,
    inT: (t: string) => ` en ${t}`, inCircuit: " en este circuito", general: "Ranking general",
    allCats: "General (todas las categorías)", allCircuits: "Todos los circuitos", allSeasons: "Todas las temporadas", allT: "Todos los torneos",
    see: "Ver", player: "Jugador", tournaments: "Torneos", points: "Puntos", empty: "Sin puntos para este filtro.",
  },

  circuit: { kicker: "Circuito", ranking: "🏆 Ranking del circuito", upcoming: "Próximas fechas", past: "Fechas jugadas", empty: "Este circuito todavía no tiene torneos publicados." },

  me: {
    title: "Mi Padel Match", hello: (n: string) => `Hola, ${n} 👋`, logout: "Salir",
    linkTitle: "Vinculá tu ficha de jugador",
    linkPending: "⏳ Tu pedido está en revisión: la organización va a confirmar que sos vos. Mientras tanto ya podés recibir avisos generales.",
    linkWhy: "Así te mostramos tus partidos y te avisamos de tus horarios, canchas y clasificaciones.",
    linkName: "Tu nombre y apellido como figura en los torneos", doc: "DNI / documento (opcional)",
    linkUpdate: "Actualizar pedido", linkAsk: "Pedir vínculo",
    myT: "Mis torneos", linked: "Ficha vinculada", noT: "No estás inscripto en torneos activos.", with: (p: string) => ` · con ${p}`,
    myNext: "Mis próximos partidos", tbdTime: "Horario a confirmar", inPlay: "🔴 En juego · ", vs: "vs", tbd: "a definir", bracket: "Cuadro",
    inbox: "Avisos", nNew: (n: number) => `${n} nuevo${n > 1 ? "s" : ""}`, markRead: "Marcar como leídos", noInbox: "Todavía no recibiste avisos.",
    data: "Mis datos", name: "Nombre y apellido", phone: "Celular", save: "Guardar",
    delLabel: "Borrar mi cuenta (escribí BORRAR)", delWord: "BORRAR", delBtn: "Borrar cuenta",
    delHint: "Se borra tu cuenta de la app y tus avisos. Tus resultados en los torneos no se tocan.",
    landingKicker: "Para jugadores · Bloko Padel Tour",
    landingLead1: "Tus partidos, horarios y canchas en un solo lugar, y ", landingLeadB: "avisos en tu celular", landingLead2: ": cuándo jugás, en qué cancha, si cambió el horario y cuándo clasificás.",
    create: "Crear cuenta gratis", have: "Ya tengo cuenta",
  },

  auth: {
    loginTitle1: "Hola, ", loginTitle2: "jugador", loginSub: "Ingresá a Mi Padel Match para ver tus partidos y recibir avisos.",
    email: "Email", password: "Contraseña", login: "Ingresar →", loggingIn: "Ingresando…",
    noAccount: "¿No tenés cuenta?", createHere: "Creala acá", free: "(es gratis).", forgot: "¿Olvidaste tu contraseña? Pedile a la organización una nueva.",
    organizer: "¿Organizás torneos?", panel: "Ingresá al panel",
    regTitle1: "Creá tu ", regTitle2: "cuenta", regSub: "Mirá tus partidos y recibí avisos en el celular: horarios, canchas y resultados.",
    name: "Nombre y apellido", namePh: "Como figurás en los torneos", doc: "DNI / documento (opcional)", docPh: "Nos ayuda a encontrar tu ficha de jugador",
    phone: "Celular (opcional)", pwPh: "Mínimo 8, con letras y números", pw2: "Repetí la contraseña", create: "Crear cuenta →", creating: "Creando…",
    have: "¿Ya tenés cuenta?", enter: "Ingresá", show: "Ver clave", hide: "Ocultar clave",
    tagKicker: "Play around the world", tag1: "Organizá. Jugá. ", tag2: "Ganá.",
    tagText: "La plataforma para organizar torneos de pádel de manera simple y profesional: los jugadores siguen todo en vivo desde el celular.",
    feats: [["grid", "Zonas y cuadros", "Sorteo automático, byes y cruces editables."], ["bolt", "Resultados en vivo", "Posiciones que se actualizan solas."], ["calendar", "Cronograma", "Canchas y horarios sin superposiciones."], ["chart", "Ranking", "Puntos acumulados por circuito y temporada."]] as [string, string, string][],
  },

  err: {
    session: "Tu sesión expiró. Volvé a ingresar.",
    pwMatch: "Las contraseñas no coinciden.",
    pwShort: "La contraseña debe tener al menos 8 caracteres.",
    pwMix: "La contraseña debe combinar letras y números.",
    name: "Escribí tu nombre y apellido.",
    email: "Email inválido.",
    tooMany: "Demasiados registros desde esta conexión. Probá más tarde.",
    exists: "Ya hay una cuenta con ese email. Ingresá con tu contraseña.",
    blocked: "Demasiados intentos fallidos. Esperá 15 minutos y volvé a intentar.",
    bad: "Email o contraseña incorrectos.",
    linked: "Tu cuenta ya está vinculada.",
    linkName: "Escribí tu nombre y apellido como figura en los torneos.",
    delWord: "Escribí BORRAR para confirmar.",
    generic: "No se pudo completar. Probá de nuevo.",
  },
  ok: { created: "¡Cuenta creada!", linkAsked: "¡Listo! La organización va a confirmar que sos vos.", saved: "Datos guardados.", deleted: "Tu cuenta fue eliminada." },

  push: {
    title: "Notificaciones en este dispositivo", on: "🔔 Activadas", off: "🔕 Desactivadas",
    sOn: "Activadas: te llegan los avisos de la organización y de tus partidos.",
    sOff: "Activalas para recibir avisos aunque no tengas la app abierta.",
    sDenied: "Las bloqueaste en este navegador. Para activarlas, habilitá las notificaciones de padel-match.net en los ajustes del navegador o del celular.",
    sIos: "En iPhone, primero instalá la app en tu pantalla de inicio (te explicamos cómo abajo).",
    sUnsupported: "Este navegador no permite notificaciones. Probá con Chrome (Android) o instalando la app en el iPhone.",
    checking: "Revisando…", enable: "Activar notificaciones", enabling: "Activando…", test: "Enviarme una prueba", disable: "Desactivar",
    okEnabled: "¡Listo! Ya te pueden llegar avisos a este dispositivo.", errEnable: "No se pudo activar en este dispositivo. Probá de nuevo.",
    okTest: "Te mandamos una notificación de prueba. Si no la ves, revisá que el celular no esté en «No molestar».",
    noDevice: "No encontramos este dispositivo. Desactivá y volvé a activar las notificaciones.", errSend: "No se pudo enviar.",
    wait: "Esperá un minuto antes de pedir otra prueba.", invalid: "Suscripción inválida.",
    testTitle: "¡Notificaciones activadas! 🎾", testBody: "Así te van a llegar los avisos de tus partidos.",
  },

  install: {
    btn: "Instalar Padel-Match", sub: "Gratis · sin App Store ni Play Store · recibí los avisos de tus partidos",
    done: (app: string) => `¡Listo! Buscá «${app}» en tu pantalla de inicio`,
    installed: (app: string) => `✅ ${app} está instalada en este celular.`,
    desk1: "📲 Para instalar la app, abrí ", desk2: " desde tu celular.",
    title: (app: string) => `Instalá ${app}`, subtitle: "Va a aparecer en tu pantalla de inicio como una app más.", close: "Cerrar", ok: "Entendido",
    inApp1: "Abriste el enlace desde otra app (Instagram, Facebook, WhatsApp…). Desde acá ", inAppB: "no se puede instalar", inApp2: ".",
    inAppS1: (b: string) => `Tocá ⋮ o ··· (arriba a la derecha) y elegí «Abrir en ${b}».`, inAppS2: (b: string) => `O copiá el enlace y pegalo en ${b}:`,
    copy: "Copiar enlace", copied: "✓ Enlace copiado", copyPrompt: "Copiá este enlace:",
    iosOther: "Para que te lleguen las notificaciones, hacelo desde Safari. Copiá el enlace y pegalo en Safari.",
    ios1: "Tocá el botón Compartir", ios1s: "Está abajo en el medio (o arriba a la derecha en iPad). Si no lo ves, deslizá la página un poco hacia arriba.",
    ios2: "Bajá y tocá «Agregar a pantalla de inicio»", ios2mock: "Agregar a pantalla de inicio", ios2s: "Si no aparece, tocá «Editar acciones» al final de la lista y agregalo.",
    ios3: "Tocá «Agregar» (arriba a la derecha)", ios3mock: "Agregar",
    ios4: (app: string) => `Abrí ${app} desde el ícono nuevo, ingresá y tocá «Activar notificaciones».`, ios4s: "En iPhone las notificaciones solo funcionan abriendo la app desde el ícono (iOS 16.4 o más nuevo).",
    arrow: "⬇︎ El botón Compartir está acá abajo ⬇︎",
    and1: "Abrí esta página en Google Chrome.", and2: "Tocá el menú ⋮ (arriba a la derecha).", and3: "Tocá «Instalar app» o «Agregar a pantalla principal»", and3mock: "Instalar app",
    and4: (app: string) => `Confirmá con «Instalar». Después abrí ${app} desde el ícono y tocá «Activar notificaciones».`,
    deskOpen: "Abrí este enlace desde tu celular para instalar la app:",
  },

  date: { at: " " },
};

export type Dict = typeof es;
