import type { Dict } from "./es";

/** English texts (public site and players area). Must mirror es.ts. */
export const en: Dict = {
  locale: "en-GB",
  langName: "English",

  nav: { tournaments: "Tournaments", when: "When do I play?", ranking: "Ranking", me: "My Padel Match", login: "Log in", create: "Create tournament", seeTournaments: "← Tournaments" },
  footer: {
    about: "Padel tournaments with live results, groups, draws, schedules and rankings.",
    players: "Players", live: "Live tournaments", meLink: "My Padel Match (alerts on your phone)",
    organizers: "Organizers", panel: "Organizer login",
  },
  lang: { choose: "Language", es: "Español", en: "English" },

  status: {
    PENDING: "Pending", IN_PLAY: "Live", PLAYED: "Finished", ANNULLED: "Void", DRAFT: "Draft",
    OPEN: "Registration open", IN_PROGRESS: "In progress", FINISHED: "Finished", CANCELLED: "Cancelled",
    REGISTRATION: "Registration", ZONES: "Group stage", PLAYOFFS: "Playoffs", ACTIVE: "Active", WITHDRAWN: "Withdrawn",
  },

  g: {
    zone: (n) => `Group ${n}`,
    tbd: "TBD",
    bye: "Bye",
    winnerOf: (code) => `Winner ${code}`,
    winnerMatch: (n) => `Winner of match ${n}`,
    loserMatch: (n) => `Loser of match ${n}`,
    zonePos: (pos, zone) => `${ordinal(pos)} Group ${zone}`,
    bestPos: (rank, pos) => `${ordinal(rank)} best ${ordinal(pos)}`,
    round: (matches) => ({ 1: "Final", 2: "Semifinals", 4: "Quarterfinals", 8: "Round of 16", 16: "Round of 32", 32: "Round of 64" } as Record<number, string>)[matches] ?? `Round of ${matches * 2}`,
    stage: {
      CHAMPION: "Champion", FINALIST: "Runner-up", SEMIFINAL: "Semifinals", QUARTERFINAL: "Quarterfinals",
      ROUND_OF_16: "Round of 16", ROUND_OF_32: "Round of 32", ROUND_OF_64: "Round of 64", ZONE: "Group stage / participation",
    },
    tiebreak: {
      WINS: "Matches won", HEAD_TO_HEAD: "Head-to-head", SET_DIFF: "Set difference", GAME_DIFF: "Game difference",
      SETS_WON: "Sets won", GAMES_WON: "Games won", WIN_RATIO: "Win %", MANUAL: "Draw / organizer decision",
    },
    format: (f) => {
      const tb = f.tiebreak && f.tb !== f.gamesPerSet ? ` · tiebreak at ${f.tb}-${f.tb}` : "";
      if (f.setsToWin === 1) return (f.gamesPerSet === 6 ? "One set" : `One set to ${f.gamesPerSet} games`) + tb;
      return `Best of ${f.setsToWin * 2 - 1} sets${f.superTiebreakDecider ? " (super tiebreak in the last)" : ""}${tb}`;
    },
    retired: "ret.",
    wo: "W/O",
  },

  live: { on: "Live", off: "Offline", hint: "This page updates by itself when there are new results or times" },

  card: { pairs: "Pairs", fee: "Entry fee", details: "See details" },

  home: {
    title1: "Your padel tournament,", title2: "in real time",
    lead: "Groups, results, draws, schedules and rankings in one place. Search your name to see when and on which court you play.",
    searchPh: "Search your first or last name…", searchAria: "Search player", search: "Search",
    organizers: "Organizers", tournamentsL: "tournaments", playersL: "players", playedL: "matches played",
    liveNow: "Playing now", upcoming: "Upcoming tournaments", finished: "Finished", empty: "No tournaments published yet. Come back soon!",
    how: "How it works",
    steps: [
      ["01", "Registration", "Pairs register by category: beginner, advanced, men's, women's or mixed."],
      ["02", "Groups", "Groups are drawn and standings update by themselves with every result."],
      ["03", "Playoffs", "Automatic knockout draw up to the final, with times and courts."],
      ["04", "Ranking", "Every player earns points for the round reached, tournament after tournament."],
    ],
  },

  tournament: {
    fallbackTitle: "Tournament", to: "to", searchPh: "Search your name to see your matches", search: "Search",
    liveNow: "🔴 Playing now", inPlay: "Live", upcoming: "Upcoming matches", noUpcoming: "No matches scheduled yet.",
    results: "Latest results", noResults: "No results yet.",
    rankingThis: "🏆 Ranking for this tournament", circuit: (n) => `🌎 ${n} circuit`, rankingCircuit: (n) => `🏆 ${n} ranking`,
    noSchedule: "Match times for this tournament are assigned on the spot by the tournament desk.", info: "Information",
  },

  category: {
    knockout: "knockout",
    qualify: (per, best) => `${per} qualify${best}`,
    all: "all", perZone: (n) => `${n} per group`, best: (n, pos) => ` + ${n} best ${ordinal(pos)}`,
    fixed: (n) => `always ${n} to the playoffs`,
    tabs: { zonas: "Groups & standings", partidos: "Matches", cuadro: "Draw", parejas: "Pairs" },
    noZones: "The groups haven't been drawn yet.", playoffs: "Playoffs", pair: "Pair", seed: "Seed", zone: "Group",
  },

  standings: {
    defined: "Final", tie: "Tie to resolve", pending: (n) => `${n} match(es) pending`,
    pair: "Pair", pj: "P", pg: "W", pp: "L", pjT: "Played", pgT: "Won", ppT: "Lost", sets: "Sets", games: "Games",
    decided: "Decided by", unresolved: "⚠ Unresolved tie", withdrawn: "Withdrawn",
  },
  bracket: { none: "The draw hasn't been generated yet.", review: "Result to review" },

  search: {
    title: "When do I play?", lead: "Search your name to see your partner, group, next matches, court and time.",
    ph: "First and/or last name", button: "Search", none: (q) => `No players found matching “${q}” in published tournaments.`,
    noCurrent: "No ongoing tournaments", see: "See matches →",
  },

  player: {
    pts: (n) => `${n} ranking pts`, pair: "Pair", seeCategory: "See category", withdrawn: "This pair is marked as withdrawn.",
    next: "Next matches", noNext: "No pending matches.", results: "Results", noResults: "No matches played yet.",
    notPlaying: "Not registered in ongoing tournaments.", history: "Points history", fullRanking: "Full ranking",
    tournament: "Tournament", stage: "Round", points: "Points", adjust: "Adjustment", adjustR: (r) => `Adjustment: ${r}`,
    noPoints: "No points yet.", previous: "Previous tournaments",
  },

  ranking: {
    title: "Ranking", none: "No rankings published yet.", sub: (org) => `${org} · individual accumulated points`,
    inT: (t) => ` in ${t}`, inCircuit: " in this circuit", general: "Overall ranking",
    allCats: "Overall (all categories)", allCircuits: "All circuits", allSeasons: "All seasons", allT: "All tournaments",
    see: "Show", player: "Player", tournaments: "Tournaments", points: "Points", empty: "No points for this filter.",
  },

  circuit: { kicker: "Circuit", ranking: "🏆 Circuit ranking", upcoming: "Upcoming events", past: "Past events", empty: "This circuit has no published tournaments yet." },

  me: {
    title: "My Padel Match", hello: (n) => `Hi, ${n} 👋`, logout: "Log out",
    linkTitle: "Link your player profile",
    linkPending: "⏳ Your request is being reviewed: the organizers will confirm it's you. Meanwhile you can already receive general alerts.",
    linkWhy: "That's how we show your matches and alert you about your times, courts and qualifications.",
    linkName: "Your first and last name as it appears in the tournaments", doc: "ID / passport number (optional)",
    linkUpdate: "Update request", linkAsk: "Request link",
    myT: "My tournaments", linked: "Profile linked", noT: "You're not registered in any active tournament.", with: (p) => ` · with ${p}`,
    myNext: "My next matches", tbdTime: "Time to be confirmed", inPlay: "🔴 Live · ", vs: "vs", tbd: "TBD", bracket: "Draw",
    inbox: "Alerts", nNew: (n) => `${n} new`, markRead: "Mark as read", noInbox: "You haven't received any alerts yet.",
    data: "My details", name: "First and last name", phone: "Mobile", save: "Save",
    delLabel: "Delete my account (type DELETE)", delWord: "DELETE", delBtn: "Delete account",
    delHint: "This deletes your app account and alerts. Your tournament results are not affected.",
    landingKicker: "For players · Bloko Padel Tour",
    landingLead1: "Your matches, times and courts in one place, plus ", landingLeadB: "alerts on your phone", landingLead2: ": when you play, on which court, if the time changed and when you qualify.",
    create: "Create free account", have: "I already have an account",
  },

  auth: {
    loginTitle1: "Hi, ", loginTitle2: "player", loginSub: "Log in to My Padel Match to see your matches and get alerts.",
    email: "Email", password: "Password", login: "Log in →", loggingIn: "Logging in…",
    noAccount: "Don't have an account?", createHere: "Create one here", free: "(it's free).", forgot: "Forgot your password? Ask the organizers for a new one.",
    organizer: "Do you run tournaments?", panel: "Organizer login",
    regTitle1: "Create your ", regTitle2: "account", regSub: "See your matches and get alerts on your phone: times, courts and results.",
    name: "First and last name", namePh: "As it appears in the tournaments", doc: "ID / passport number (optional)", docPh: "Helps us find your player profile",
    phone: "Mobile (optional)", pwPh: "At least 8 characters, letters and numbers", pw2: "Repeat password", create: "Create account →", creating: "Creating…",
    have: "Already have an account?", enter: "Log in", show: "Show password", hide: "Hide password",
    tagKicker: "Play around the world", tag1: "Organize. Play. ", tag2: "Win.",
    tagText: "The platform to run padel tournaments simply and professionally: players follow everything live on their phones.",
    feats: [["grid", "Groups & draws", "Automatic draw, byes and editable matchups."], ["bolt", "Live results", "Standings that update by themselves."], ["calendar", "Schedule", "Courts and times with no overlaps."], ["chart", "Ranking", "Points accumulated by circuit and season."]],
  },

  err: {
    session: "Your session expired. Please log in again.",
    pwMatch: "Passwords don't match.",
    pwShort: "The password must be at least 8 characters long.",
    pwMix: "The password must combine letters and numbers.",
    name: "Please enter your first and last name.",
    email: "Invalid email.",
    tooMany: "Too many sign-ups from this connection. Please try later.",
    exists: "There's already an account with that email. Log in with your password.",
    blocked: "Too many failed attempts. Wait 15 minutes and try again.",
    bad: "Wrong email or password.",
    linked: "Your account is already linked.",
    linkName: "Enter your first and last name as it appears in the tournaments.",
    delWord: "Type DELETE to confirm.",
    generic: "Something went wrong. Please try again.",
  },
  ok: { created: "Account created!", linkAsked: "Done! The organizers will confirm it's you.", saved: "Details saved.", deleted: "Your account was deleted." },

  push: {
    title: "Notifications on this device", on: "🔔 On", off: "🔕 Off",
    sOn: "On: you'll get alerts from the organizers and about your matches.",
    sOff: "Turn them on to get alerts even when the app is closed.",
    sDenied: "You blocked them in this browser. To turn them on, allow notifications for padel-match.net in your browser or phone settings.",
    sIos: "On iPhone, first install the app on your home screen (see how below).",
    sUnsupported: "This browser doesn't support notifications. Try Chrome (Android) or install the app on your iPhone.",
    checking: "Checking…", enable: "Turn on notifications", enabling: "Turning on…", test: "Send me a test", disable: "Turn off",
    okEnabled: "Done! Alerts can now reach this device.", errEnable: "Couldn't turn them on on this device. Please try again.",
    okTest: "We sent you a test notification. If you don't see it, check your phone isn't on “Do not disturb”.",
    noDevice: "We couldn't find this device. Turn notifications off and on again.", errSend: "Couldn't send it.",
    wait: "Wait a minute before asking for another test.", invalid: "Invalid subscription.",
    testTitle: "Notifications are on! 🎾", testBody: "This is how your match alerts will look.",
  },

  install: {
    btn: "Install Padel-Match", sub: "Free · no App Store or Play Store · get alerts for your matches",
    done: (app) => `Done! Look for “${app}” on your home screen`,
    installed: (app) => `✅ ${app} is installed on this phone.`,
    desk1: "📲 To install the app, open ", desk2: " on your phone.",
    title: (app) => `Install ${app}`, subtitle: "It will appear on your home screen like any other app.", close: "Close", ok: "Got it",
    inApp1: "You opened the link inside another app (Instagram, Facebook, WhatsApp…). From here it ", inAppB: "can't be installed", inApp2: ".",
    inAppS1: (b) => `Tap ⋮ or ··· (top right) and choose “Open in ${b}”.`, inAppS2: (b) => `Or copy the link and paste it in ${b}:`,
    copy: "Copy link", copied: "✓ Link copied", copyPrompt: "Copy this link:",
    iosOther: "To receive notifications, do it from Safari. Copy the link and paste it in Safari.",
    ios1: "Tap the Share button", ios1s: "It's at the bottom in the middle (top right on iPad). If you can't see it, scroll the page up a little.",
    ios2: "Scroll down and tap “Add to Home Screen”", ios2mock: "Add to Home Screen", ios2s: "If it's not there, tap “Edit Actions” at the end of the list and add it.",
    ios3: "Tap “Add” (top right)", ios3mock: "Add",
    ios4: (app) => `Open ${app} from the new icon, log in and tap “Turn on notifications”.`, ios4s: "On iPhone, notifications only work when you open the app from the icon (iOS 16.4 or newer).",
    arrow: "⬇︎ The Share button is down here ⬇︎",
    and1: "Open this page in Google Chrome.", and2: "Tap the ⋮ menu (top right).", and3: "Tap “Install app” or “Add to Home screen”", and3mock: "Install app",
    and4: (app) => `Confirm with “Install”. Then open ${app} from the icon and tap “Turn on notifications”.`,
    deskOpen: "Open this link on your phone to install the app:",
  },

  date: { at: " " },
};

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
