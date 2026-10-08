import fs from "node:fs/promises";

const API_BASE = "https://esports-api.lolesports.com/persisted/gw";
// LoL Esports uses a browser-facing persisted API key on lolesports.com.
// Allow a repository secret to override it, but keep schedule refresh working
// without requiring the separate developer.riotgames.com RGAPI development key.
const SITE_API_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z";
const API_KEY = process.env.LOL_ESPORTS_API_KEY || SITE_API_KEY;
const HL = "en-US";
const OUT = "esports-data.js";

const COMPETITIONS = [
  {code:"lcs",name:"LCS",type:"regional",tokens:["lcs"]},
  {code:"cblol",name:"CBLOL",type:"regional",tokens:["cblol"]},
  {code:"lec",name:"LEC",type:"regional",tokens:["lec"]},
  {code:"lck",name:"LCK",type:"regional",tokens:["lck"]},
  {code:"lpl",name:"LPL",type:"regional",tokens:["lpl"]},
  {code:"lcp",name:"LCP",type:"regional",tokens:["lcp"]},
  {code:"first_stand",name:"First Stand",type:"international",tokens:["first stand","first_stand"]},
  {code:"msi",name:"MSI",type:"international",tokens:["msi","mid-season"]},
  {code:"worlds",name:"Worlds",type:"international",tokens:["worlds","world championship"]}
];

function canonicalCompetition(league) {
  const name=clean(league?.name).toLowerCase();
  const slug=clean(league?.slug).toLowerCase();
  const hay=`${name} ${slug}`;
  // Exclude promotion, challengers and qualifying leagues from Tier 1 fantasy pools.
  if (/promotion|challenger|qualif|academy|masters/.test(hay)) return null;
  return COMPETITIONS.find(c=>c.tokens.some(t=>hay===t || name===t || slug===t || hay.includes(` ${t}`) || hay.startsWith(t+" "))) || null;
}

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
function teamMatchKey(s) {
  return clean(s).toLowerCase().replace(/[^a-z0-9]/g,"");
}
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
    id: clean(x?.id || x?.team?.id || ""),
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
      const competition=canonicalCompetition(e.league);
      const leagueCode=clean(e.league?.slug || e.league?.name || "");
      const matchId=clean(e.match?.id || e.id) || [
        competition?.code||leagueCode,
        e.startTime||"tbd",
        a.id||teamMatchKey(a.name),
        b.id||teamMatchKey(b.name)
      ].join("|");
      return {
        matchId,
        eventId: clean(e.id),
        competition: competition?.code || null,
        competitionType: competition?.type || null,
        startTime: e.startTime || null,
        league: clean(e.league?.name || e.league?.slug || "LoL Esports"),
        leagueCode,
        stage: clean(e.blockName || e.match?.strategy?.type || ""),
        aId:a.id||null, a:a.name, aCode:a.code,
        bId:b.id||null, b:b.name, bCode:b.code,
        status: clean(e.state || "unstarted").toUpperCase(),
        strategy: clean(e.match?.strategy?.type || ""),
        count: e.match?.strategy?.count ?? null
      };
    })
    .filter(g => {
      const t = Date.parse(g.startTime || "");
      return !!g.competition && Number.isFinite(t) && t >= now - 12*60*60*1000 && t <= horizon;
    })
    .sort((x,y)=>Date.parse(x.startTime)-Date.parse(y.startTime));

  const deduped = [];
  const seen = new Set();
  for (const event of mapped) {
    const key = event.matchId || event.eventId || [event.startTime,event.aId||event.a,event.bId||event.b].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }
  return deduped.slice(0,200);
}

async function fetchCompetitionTeamKeys(league) {
  const keys=new Set();
  const seenTokens=new Set();
  const collect=schedule=>{
    for (const event of (schedule?.events||[])) {
      if (event?.type!=="match" || !event?.match) continue;
      const eventDate=new Date(event.startTime||"");
      if(!Number.isFinite(eventDate.getTime()) || eventDate.getUTCFullYear()!==2026) continue;
      for (const team of (event.match.teams||[])) {
        const name=clean(team?.name||team?.team?.name);
        if (name) keys.add(teamMatchKey(name));
      }
    }
  };

  try {
    const first=await api("getSchedule",{leagueId:league.id});
    const schedule=first?.data?.schedule||{};
    collect(schedule);

    // Walk both directions so offseason leagues still resolve their most recent
    // participants instead of returning an empty roster.
    for (const direction of ["older","newer"]) {
      let token=schedule?.pages?.[direction]||null;
      for (let i=0;i<8 && token && !seenTokens.has(direction+":"+token);i++) {
        seenTokens.add(direction+":"+token);
        const page=await api("getSchedule",{leagueId:league.id,pageToken:token});
        const next=page?.data?.schedule||{};
        collect(next);
        token=next?.pages?.[direction]||null;
      }
    }
  } catch (err) {
    console.warn(`Could not resolve team list for ${league.name}: ${err.message}`);
  }
  return keys;
}

async function fetchLeaguesAndPlayers(existing) {
  const leaguesPayload=await api("getLeagues");
  const leagues=leaguesPayload?.data?.leagues||[];
  const selected=leagues.filter(l=>canonicalCompetition(l));

  const competitionTeamKeys=new Map();
  for (const league of selected) {
    const competition=canonicalCompetition(league);
    if(!competition)continue;
    const keys=await fetchCompetitionTeamKeys(league);
    const current=competitionTeamKeys.get(competition.code)||new Set();
    for(const key of keys)current.add(key);
    competitionTeamKeys.set(competition.code,current);
  }

  let allTeams=[];
  try {
    const payload=await api("getTeams");
    allTeams=payload?.data?.teams||[];
  } catch (err) {
    console.warn(`Could not fetch the LoL Esports team directory: ${err.message}`);
  }

  const oldByKey=new Map((existing.players||[]).map(p=>[`${clean(p.name).toLowerCase()}|${clean(p.team).toLowerCase()}`,p]));
  const players=[];
  const playerByKey=new Map();
  const playerById=new Map();

  for (const team of allTeams) {
    const teamName=clean(team.name||team.code||"Unknown");
    const teamCode=clean(team.code||codeFor(teamName));
    const teamKey=teamMatchKey(teamName);
    const competitions=[];

    for (const competition of COMPETITIONS) {
      const eligibleKeys=competitionTeamKeys.get(competition.code);
      if(eligibleKeys?.has(teamKey))competitions.push(competition.code);
    }

    if(!competitions.length)continue;

    const teamPlayers=Array.isArray(team.players)?team.players:[];
    const lastRoleIndex=new Map();
    teamPlayers.forEach((candidate,index)=>{
      const candidateRole=normalizeRole(candidate?.role);
      if(candidateRole)lastRoleIndex.set(candidateRole,index);
    });
    for (let playerIndex=0; playerIndex<teamPlayers.length; playerIndex++) {
      const p=teamPlayers[playerIndex];
      const role=normalizeRole(p.role);
      const name=clean(p.summonerName||p.name);
      if(!role||!name)continue;
      const key=`${name.toLowerCase()}|${teamName.toLowerCase()}`;
      const stableId=clean(p.id||`${teamCode}-${name}`).toLowerCase().replace(/[^a-z0-9]+/g,"-");
      const existingPlayer=playerById.get(stableId)||playerByKey.get(key);
      if(existingPlayer){
        for(const code of competitions){
          if(!existingPlayer.competitions.includes(code))existingPlayer.competitions.push(code);
        }
        // Prefer the Tier 1 team record currently being processed over any
        // duplicate directory alias for the same Riot player identity.
        existingPlayer.name=name;
        existingPlayer.team=teamName;
        existingPlayer.teamId=clean(team.id)||null;
        existingPlayer.teamCode=teamCode;
        existingPlayer.role=role;
        const isStarter=lastRoleIndex.get(role)===playerIndex;
        if(isStarter){
          existingPlayer.draftable=true;
          existingPlayer.rosterStatus="starter";
        }
        continue;
      }
      const old=oldByKey.get(key);
      const isStarter=lastRoleIndex.get(role)===playerIndex;
      const record={
        id:stableId,
        role,
        name,
        team:teamName,
        teamId:clean(team.id)||null,
        teamCode,
        rank:999,
        projection:Number(old?.projection??old?.fp??20),
        verified:true,
        active:true,
        draftable:isStarter,
        rosterStatus:isStarter?"starter":"reserve",
        league:competitions[0],
        competitions:[...competitions]
      };
      playerByKey.set(key,record);
      playerById.set(stableId,record);
      players.push(record);
    }
  }

  players.sort((a,b)=>{
    const aOld=oldByKey.get(`${a.name.toLowerCase()}|${a.team.toLowerCase()}`);
    const bOld=oldByKey.get(`${b.name.toLowerCase()}|${b.team.toLowerCase()}`);
    return Number(aOld?.rank??999)-Number(bOld?.rank??999)
      || b.projection-a.projection
      || a.name.localeCompare(b.name);
  });
  players.forEach((p,i)=>p.rank=i+1);

  return {
    leagues:selected.map(l=>{
      const competition=canonicalCompetition(l);
      return {id:l.id,name:l.name,slug:l.slug,region:l.region,competition:competition?.code||null,type:competition?.type||null};
    }),
    competitions:COMPETITIONS,
    players
  };
}

const existingText = await fs.readFile(OUT, "utf8");
const existing = parseExisting(existingText);

const [schedule, rosterData] = await Promise.all([
  fetchAllSchedule(),
  fetchLeaguesAndPlayers(existing)
]);

if (schedule.length < 1) throw new Error("No schedule events returned; refusing to overwrite good schedule data.");

// Reconcile schedule participants with the canonical Riot team IDs already
// attached to roster records. The schedule endpoint sometimes omits team IDs
// even when the team name/code is known.
const teamByName=new Map();
const teamByCode=new Map();
for(const player of (rosterData.players||[])){
  if(player.teamId&&player.team)teamByName.set(teamMatchKey(player.team),player.teamId);
  if(player.teamId&&player.teamCode)teamByCode.set(clean(player.teamCode).toLowerCase(),player.teamId);
}
for(const match of schedule){
  if(!match.aId&&match.a&&match.a!=="TBD"){
    match.aId=teamByName.get(teamMatchKey(match.a))||teamByCode.get(clean(match.aCode).toLowerCase())||null;
  }
  if(!match.bId&&match.b&&match.b!=="TBD"){
    match.bId=teamByName.get(teamMatchKey(match.b))||teamByCode.get(clean(match.bCode).toLowerCase())||null;
  }
}

const refreshedPlayers = rosterData.players.length >= 40
  ? rosterData.players
  : (existing.players || []);
const refreshedLeagues = rosterData.leagues.length
  ? rosterData.leagues
  : (existing.leagues || []);

if (rosterData.players.length < 40) {
  console.warn(`Only ${rosterData.players.length} eligible Tier 1 players were resolved; preserving the existing player pool while still refreshing the official schedule.`);
}

const next = {
  ...existing,
  updatedAt: new Date().toISOString(),
  sourceLabel: "LoL Esports",
  sourceUrl: "https://lolesports.com/en-US",
  autoUpdated: true,
  dataMode: "live-refresh",
  leagues: refreshedLeagues,
  competitions: rosterData.competitions || COMPETITIONS,
  schedule,
  players: refreshedPlayers
};

await fs.writeFile(OUT, "window.ESPORTS_DATA = " + JSON.stringify(next, null, 2) + ";\n", "utf8");
console.log(`Updated ${schedule.length} official schedule events and ${refreshedPlayers.length} player records.`);
