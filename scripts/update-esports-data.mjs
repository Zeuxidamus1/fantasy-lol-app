import fs from "node:fs/promises";

const API_BASE = "https://esports-api.lolesports.com/persisted/gw";
// LoL Esports uses a browser-facing persisted API key on lolesports.com.
// Allow a repository secret to override it, but keep schedule refresh working
// without requiring the separate developer.riotgames.com RGAPI development key.
const SITE_API_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z";
const API_KEY = process.env.LOL_ESPORTS_API_KEY || SITE_API_KEY;
const HL = "en-US";
const OUT = "esports-data.js";

const wantedLeagueTokens = [
  "worlds","world championship","msi","mid-season",
  "lck","lpl","lec","lcs","lta","cblol","pcs","vcs","ljl"
];

const roleMap = new Map([
  ["top","TOP"],["t","TOP"],
  ["jungle","JNG"],["jungler","JNG"],["jng","JNG"],
  ["mid","MID"],["middle","MID"],["midlane","MID"],
  ["bottom","ADC"],["bot","ADC"],["adc","ADC"],
  ["support","SUP"],["sup","SUP"]
]);

async function api(path, params = {}) {
  const url = new URL(API_BASE + "/" + path);
  url.searchParams.set("hl", HL);
  for (const [k,v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach(x => url.searchParams.append(k, x));
    else if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  let lastError;
  for (let attempt=1; attempt<=3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {"x-api-key": API_KEY, "accept": "application/json"},
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) throw new Error(`${path} failed: ${res.status} ${res.statusText}`);
      const payload = await res.json();
      if (!payload || typeof payload !== "object") throw new Error(`${path} returned an invalid response`);
      return payload;
    } catch (err) {
      lastError = err;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 750 * attempt));
    }
  }
  throw lastError;
}

function clean(s) { return String(s ?? "").trim(); }
function codeFor(name) {
  const words = clean(name).replace(/[^A-Za-z0-9 ]/g," ").split(/\s+/).filter(Boolean);
  if (!words.length) return "TBD";
  if (words.length === 1) return words[0].slice(0,4).toUpperCase();
  return words.map(w=>w[0]).join("").slice(0,4).toUpperCase();
}
function normalizeRole(role) {
  const r = clean(role).toLowerCase().replace(/[^a-z]/g,"");
  return roleMap.get(r) || roleMap.get(clean(role).toLowerCase()) || null;
}
function parseExisting(text) {
  const m = text.match(/window\.ESPORTS_DATA\s*=\s*([\s\S]*);\s*$/);
  if (!m) return {};
  // The checked-in snapshot is JavaScript object syntax rather than strict JSON.
  // It is repository-controlled input, so evaluate only the captured object.
  return Function('"use strict"; return (' + m[1] + ');')();
}
function teamFromParticipant(x) {
  const name = clean(x?.name || x?.team?.name || x?.code || "TBD");
  return {
    name,
    code: clean(x?.code || x?.team?.code || codeFor(name)),
    result: x?.result?.outcome || x?.result || null
  };
}

async function fetchAllSchedule() {
  const first = await api("getSchedule");
  const schedule = first?.data?.schedule || {};
  let events = Array.isArray(schedule.events) ? [...schedule.events] : [];
  const seenTokens = new Set();
  let token = schedule?.pages?.newer || null;

  // Follow future pages far enough to cover the next 45 days. The LoL Esports
  // schedule page often publishes lower-tier and promotion events before they
  // appear in our previously saved snapshot.
  for (let i=0; i<12 && token && !seenTokens.has(token); i++) {
    seenTokens.add(token);
    const next = await api("getSchedule", {pageToken: token});
    const s = next?.data?.schedule || {};
    if (Array.isArray(s.events)) events.push(...s.events);
    token = s?.pages?.newer || null;
  }

  const now = Date.now();
  const horizon = now + 45*24*60*60*1000;

  const mapped = events
    .filter(e => e?.type === "match" && e?.match)
    .map(e => {
      const teams = Array.isArray(e.match.teams) ? e.match.teams : [];
      const a = teamFromParticipant(teams[0]);
      const b = teamFromParticipant(teams[1]);
      return {
        eventId: clean(e.id),
        startTime: e.startTime || null,
        league: clean(e.league?.name || e.league?.slug || "LoL Esports"),
        leagueCode: clean(e.league?.slug || e.league?.name || ""),
        stage: clean(e.blockName || e.match?.strategy?.type || ""),
        a: a.name, aCode: a.code,
        b: b.name, bCode: b.code,
        status: clean(e.state || "unstarted").toUpperCase(),
        strategy: clean(e.match?.strategy?.type || ""),
        count: e.match?.strategy?.count ?? null
      };
    })
    .filter(g => {
      const t = Date.parse(g.startTime || "");
      return Number.isFinite(t) && t >= now - 12*60*60*1000 && t <= horizon;
    })
    .sort((x,y)=>Date.parse(x.startTime)-Date.parse(y.startTime));

  const deduped = [];
  const seen = new Set();
  for (const event of mapped) {
    const key = event.eventId || [event.startTime,event.a,event.b].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }
  return deduped.slice(0,200);
}

async function fetchLeaguesAndPlayers(existing) {
  const leaguesPayload = await api("getLeagues");
  const leagues = leaguesPayload?.data?.leagues || [];
  const selected = leagues.filter(l => {
    const hay = `${l.name||""} ${l.slug||""} ${l.region||""}`.toLowerCase();
    return wantedLeagueTokens.some(t => hay.includes(t));
  });

  const oldByKey = new Map((existing.players||[]).map(p=>[`${clean(p.name).toLowerCase()}|${clean(p.team).toLowerCase()}`, p]));
  const players = [];
  const seen = new Set();

  for (const league of selected.slice(0,18)) {
    try {
      const payload = await api("getTeams", {id: league.id});
      const teams = payload?.data?.teams || [];
      for (const team of teams) {
        const teamName = clean(team.name || team.code || "Unknown");
        for (const p of (team.players || [])) {
          const role = normalizeRole(p.role);
          const name = clean(p.summonerName || p.name);
          if (!role || !name) continue;
          const key = `${name.toLowerCase()}|${teamName.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const old = oldByKey.get(key);
          players.push({
            id: clean(p.id || `${team.code||codeFor(teamName)}-${name}`).toLowerCase().replace(/[^a-z0-9]+/g,"-"),
            role,
            name,
            team: teamName,
            teamCode: clean(team.code || codeFor(teamName)),
            rank: 999,
            projection: Number(old?.projection ?? old?.fp ?? 20),
            verified: true,
            league: clean(league.slug || league.name)
          });
        }
      }
    } catch (err) {
      console.warn(`Skipping teams for ${league.name}: ${err.message}`);
    }
  }

  // Keep stable fantasy ordering, but prefer any previously established rank.
  players.sort((a,b)=>{
    const aOld = oldByKey.get(`${a.name.toLowerCase()}|${a.team.toLowerCase()}`);
    const bOld = oldByKey.get(`${b.name.toLowerCase()}|${b.team.toLowerCase()}`);
    return Number(aOld?.rank ?? 999) - Number(bOld?.rank ?? 999) || b.projection-a.projection || a.name.localeCompare(b.name);
  });
  players.forEach((p,i)=>p.rank=i+1);
  return {leagues:selected.map(l=>({id:l.id,name:l.name,slug:l.slug,region:l.region})), players};
}

const existingText = await fs.readFile(OUT, "utf8");
const existing = parseExisting(existingText);

const [schedule, rosterData] = await Promise.all([
  fetchAllSchedule(),
  fetchLeaguesAndPlayers(existing)
]);

if (schedule.length < 1) throw new Error("No schedule events returned; refusing to overwrite good schedule data.");

const refreshedPlayers = rosterData.players.length >= 10
  ? rosterData.players
  : (existing.players || []);
const refreshedLeagues = rosterData.leagues.length
  ? rosterData.leagues
  : (existing.leagues || []);

if (rosterData.players.length < 10) {
  console.warn(`Only ${rosterData.players.length} players returned by the roster endpoint; preserving the existing player pool while still refreshing the official schedule.`);
}

const next = {
  ...existing,
  updatedAt: new Date().toISOString(),
  sourceLabel: "LoL Esports",
  sourceUrl: "https://lolesports.com/en-US",
  autoUpdated: true,
  dataMode: "live-refresh",
  leagues: refreshedLeagues,
  schedule,
  players: refreshedPlayers
};

await fs.writeFile(OUT, "window.ESPORTS_DATA = " + JSON.stringify(next, null, 2) + ";\n", "utf8");
console.log(`Updated ${schedule.length} official schedule events and ${refreshedPlayers.length} player records.`);
