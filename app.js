const proSchedule = (window.ESPORTS_DATA && window.ESPORTS_DATA.schedule) || [];

function localScheduleRow(g){
  const timestamp=g.startTime||null;
  const dateOnly=!timestamp&&g.date?String(g.date):null;
  const d=timestamp?new Date(timestamp):(dateOnly?new Date(dateOnly+"T12:00:00"):null);
  if(!d||Number.isNaN(d.getTime())) return {...g,day:g.day||"upcoming"};
  const now=new Date();
  const todayKey=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());
  const gameKey=Date.UTC(d.getFullYear(),d.getMonth(),d.getDate());
  const diff=Math.round((gameKey-todayKey)/86400000);
  const day=diff<0?"past":diff===0?"today":diff===1?"tomorrow":"upcoming";
  const prefix=diff===0?"TODAY":diff===1?"TOMORROW":d.toLocaleDateString(undefined,{month:"short",day:"numeric"}).toUpperCase();
  return {
    ...g,
    day,
    label:`${prefix} · ${d.toLocaleDateString(undefined,{month:"short",day:"numeric"}).toUpperCase()}`,
    time:timestamp?d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}):(g.time||"TBD")
  };
}
function displayMatchStatus(value){
  const status=String(value||"UNSTARTED").toUpperCase();
  if(status.includes("PROGRESS"))return "LIVE";
  if(status.includes("COMPLETE"))return "FINAL";
  if(status.includes("POSTPON"))return "POSTPONED";
  if(status.includes("CANCEL"))return "CANCELED";
  if(status.includes("UNSTART")||status.includes("SCHEDULE"))return "UPCOMING";
  return status;
}
function databaseMatchToSchedule(row){
  return {
    matchId:row?.id||"",
    eventId:row?.event_id||"",
    competition:row?.competition||null,
    startTime:row?.start_time||null,
    league:row?.league_name||row?.competition||"LoL Esports",
    leagueCode:row?.league_code||row?.competition||"",
    stage:row?.stage||"",
    aId:row?.team_a_id||null, a:row?.team_a_name||"TBD", aCode:row?.team_a_code||"TBD",
    bId:row?.team_b_id||null, b:row?.team_b_name||"TBD", bCode:row?.team_b_code||"TBD",
    status:row?.status||"UNSTARTED",
    strategy:row?.strategy||"",
    count:row?.game_count??null
  };
}
const COMPETITION_META = Object.freeze({
  lcs:{name:"LCS",type:"regional",region:"North America"},
  cblol:{name:"CBLOL",type:"regional",region:"Brazil"},
  lec:{name:"LEC",type:"regional",region:"EMEA"},
  lck:{name:"LCK",type:"regional",region:"Korea"},
  lpl:{name:"LPL",type:"regional",region:"China"},
  lcp:{name:"LCP",type:"regional",region:"Asia Pacific"},
  first_stand:{name:"First Stand",type:"international",region:"International"},
  msi:{name:"MSI",type:"international",region:"International"},
  worlds:{name:"Worlds",type:"international",region:"International"}
});

function normalizeCompetitionCode(value){
  const raw=String(value||"worlds").trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
  const aliases={
    "world_championship":"worlds","worlds":"worlds",
    "mid_season_invitational":"msi","mid_season":"msi","msi":"msi",
    "firststand":"first_stand","first_stand":"first_stand",
    "cblol_brazil":"cblol","cblol":"cblol",
    "lta":"lcs","lta_n":"lcs","lta_s":"cblol","lta_cross":"lcs",
    "lcs":"lcs","lec":"lec","lck":"lck","lpl":"lpl","lcp":"lcp"
  };
  return aliases[raw] || (COMPETITION_META[raw]?raw:null);
}
function competitionName(value){
  const code=normalizeCompetitionCode(value);
  return COMPETITION_META[code]?.name || String(value||"Worlds");
}
function competitionType(value){
  const code=normalizeCompetitionCode(value);
  return COMPETITION_META[code]?.type || "international";
}

const LEAGUE_LIFECYCLE=Object.freeze({
  pre_draft:{label:"Pre-Draft",canDraft:true,canManageRoster:false,canTrade:false,canWaive:false,readOnly:false},
  drafting:{label:"Drafting",canDraft:true,canManageRoster:false,canTrade:false,canWaive:false,readOnly:false},
  active:{label:"Active",canDraft:false,canManageRoster:true,canTrade:true,canWaive:true,readOnly:false},
  playoffs:{label:"Playoffs",canDraft:false,canManageRoster:true,canTrade:true,canWaive:true,readOnly:false},
  completed:{label:"Season Complete",canDraft:false,canManageRoster:false,canTrade:false,canWaive:false,readOnly:true}
});
function leagueLifecycleState(league,{playoffs=[]}={}){
  const raw=String(league?.status||"pre_draft");
  if(raw==="completed")return "completed";
  if(raw==="drafting")return "drafting";
  if(raw==="pre_draft")return "pre_draft";
  if(raw==="active"&&Array.isArray(playoffs)&&playoffs.length)return "playoffs";
  return "active";
}
function leagueLifecycleConfig(league,context={}){
  const state=leagueLifecycleState(league,context);
  return {state,...LEAGUE_LIFECYCLE[state]};
}
function isSimulationLeague(league){
  return league?.settings?.simulation===true;
}
function playableLeague(league){
  return !isSimulationLeague(league)&&new Set(["pre_draft","drafting","active"]).has(String(league?.status||""));
}
function scheduleCompetitionCode(game){
  return normalizeCompetitionCode(game?.competition||game?.leagueCode||game?.league||"");
}
function normalizeTeamKey(value){return String(value||"").toLowerCase().replace(/[^a-z0-9]/g,"");}
function playerMatchesProMatch(player,match){
  const playerTeamId=String(player?.teamId||player?.team_id||"");
  if(playerTeamId&&(playerTeamId===String(match?.team_a_id||"")||playerTeamId===String(match?.team_b_id||"")))return true;
  const playerName=normalizeTeamKey(player?.team);
  const playerCode=normalizeTeamKey(player?.teamCode);
  const teams=[
    normalizeTeamKey(match?.team_a_name),normalizeTeamKey(match?.team_a_code),
    normalizeTeamKey(match?.team_b_name),normalizeTeamKey(match?.team_b_code)
  ];
  return !!((playerName&&teams.includes(playerName))||(playerCode&&teams.includes(playerCode)));
}

// Transitional eligibility for the small legacy snapshot. Fresh roster refreshes attach
// competition codes directly to each player and supersede these mappings.
const LEGACY_TEAM_COMPETITIONS=Object.freeze({
  "flyquest":["lcs"],
  "sentinels":["lcs"],
  "lyon":["lcs","first_stand","msi","worlds"],
  "gengesports":["lck","first_stand","worlds"],
  "geng":["lck","first_stand","worlds"],
  "t1":["lck","msi","worlds"]
});
function playerCompetitionCodes(player){
  const codes=new Set();
  const values=[
    ...(Array.isArray(player?.competitions)?player.competitions:[]),
    player?.competition,
    player?.league
  ];
  for(const value of values){
    const code=normalizeCompetitionCode(value);
    if(code)codes.add(code);
  }
  for(const code of (LEGACY_TEAM_COMPETITIONS[normalizeTeamKey(player?.team)]||[]))codes.add(code);
  const teamName=normalizeTeamKey(player?.team);
  const teamCode=normalizeTeamKey(player?.teamCode);
  if(teamName||teamCode){
    for(const game of proSchedule){
      const teams=[normalizeTeamKey(game?.a),normalizeTeamKey(game?.aCode),normalizeTeamKey(game?.b),normalizeTeamKey(game?.bCode)];
      if((teamName&&teams.includes(teamName))||(teamCode&&teams.includes(teamCode))){
        const code=scheduleCompetitionCode(game);
        if(code)codes.add(code);
      }
    }
  }
  return [...codes];
}
function playerEligibleForCompetition(player,competition){
  const code=normalizeCompetitionCode(competition);
  return !!code && playerCompetitionCodes(player).includes(code);
}
function playerExplicitlyEligibleForCompetition(player,competition){
  const code=normalizeCompetitionCode(competition);
  if(!code)return false;
  const explicit=[
    ...(Array.isArray(player?.competitions)?player.competitions:[]),
    player?.competition
  ].map(normalizeCompetitionCode).filter(Boolean);
  return explicit.includes(code);
}
function playerIsDraftable(player){
  return player?.draftable!==false && String(player?.rosterStatus||"starter").toLowerCase()!=="reserve";
}
const competitionStatusCache=new Map();
function cacheCompetitionStatuses(competition,rows=[]){
  const code=normalizeCompetitionCode(competition);
  if(!code)return;
  competitionStatusCache.set(code,new Map((rows||[]).map(row=>[String(row.player_id),row])));
}
function competitionStatusForPlayer(playerId,competition){
  const code=normalizeCompetitionCode(competition);
  return competitionStatusCache.get(code)?.get(String(playerId))||null;
}
function playerAvailableForAcquisition(player,competition){
  if(!playerEligibleForCompetition(player,competition)||!playerIsDraftable(player))return false;
  const code=normalizeCompetitionCode(competition);
  const statusMap=competitionStatusCache.get(code);
  if(!statusMap)return true;
  const row=statusMap.get(playerKey(player));
  return !!row&&String(row.status)==="starter"&&Number(row.remaining_matches)>0&&!!row.next_match_at;
}
function playerAvailabilityLabel(status){
  switch(String(status||"")){
    case "starter":return "ACTIVE";
    case "substitute":return "SUBSTITUTE";
    case "inactive":return "INACTIVE";
    case "eliminated":return "ELIMINATED";
    case "season_complete":return "SEASON COMPLETE";
    case "no_upcoming_match":return "NO UPCOMING MATCH";
    default:return "UNAVAILABLE";
  }
}
function competitionHelpText(value){
  const code=normalizeCompetitionCode(value);
  const name=competitionName(code);
  return `Only players eligible for ${name} can be drafted, added as free agents, or claimed on waivers. ${name} games are the scoring scope for this league.`;
}

const draftPool = ((window.ESPORTS_DATA && window.ESPORTS_DATA.players) || []).map(p=>{
  const n=Number(p.projection??p.fp??20);
  return {...p,fp:Number.isFinite(n)?n:20};
});
let mockDraftPoolOverride=null;
function eligibleDraftPool(settings=getLeagueSettings()){
  const code=normalizeCompetitionCode(settings?.competition);
  if(settings?.simulation===true){
    const source=Array.isArray(mockDraftPoolOverride)&&mockDraftPoolOverride.length
      ?mockDraftPoolOverride
      :draftPool;
    return source.filter(p=>playerExplicitlyEligibleForCompetition(p,code)&&playerIsDraftable(p));
  }
  return draftPool.filter(p=>playerAvailableForAcquisition(p,code));
}

const draftManagerNames = ["Baron Bandits","Zeuxidamus","Rift Raiders","Pentakill Club","Nexus Breakers","Blue Buff Boys","Dragon Slayers","Iron V","Red Side","First Blood","Scuttle Club","Elder Enjoyers"];
let draftTimerId=null;
let tradeTimerId=null;
let creatorSimulationTimerId=null;
let tradeRealtimeCleanup=null;
const memoryStorage=new Map();
function storageGet(key){
  try{
    const value=localStorage.getItem(key);
    return value===null?(memoryStorage.get(key)??null):value;
  }catch{
    return memoryStorage.get(key)??null;
  }
}
function storageSet(key,value){
  const text=String(value);
  memoryStorage.set(key,text);
  try{localStorage.setItem(key,text);}catch{}
}
function storageRemove(key){
  memoryStorage.delete(key);
  try{localStorage.removeItem(key);}catch{}
}

function draftOrderForPick(pickIndex,managerCount){
  const round=Math.floor(pickIndex/managerCount);
  const within=pickIndex%managerCount;
  return round%2===0 ? within : managerCount-1-within;
}

function getDraftState(){
  try{return JSON.parse(storageGet("riftDraftState")||"null");}catch{return null;}
}

function saveDraftState(state){
  storageSet("riftDraftState",JSON.stringify(state));
}

function newDraftState(){
  const settings=getLeagueSettings();
  const managerCount=Number(settings.managers)||8;
  return {started:true,managerCount,userIndex:Math.min(1,managerCount-1),pickIndex:0,picks:[],seconds:30,complete:false};
}

function managerPicks(state,managerIndex){
  return state.picks.filter(p=>p.managerIndex===managerIndex);
}

function rosterNeedsForManager(state,managerIndex){
  const picks=managerPicks(state,managerIndex);
  const starterRoles=["TOP","JNG","MID","ADC","SUP"];
  const counts=Object.fromEntries(starterRoles.map(r=>[r,picks.filter(p=>p.role===r).length]));
  return starterRoles.filter(r=>counts[r]===0);
}

function canDraftPlayer(state,managerIndex,player){
  const settings=getLeagueSettings();
  const picks=managerPicks(state,managerIndex);
  const maxRoster=6+Number(settings.bench||3);
  if(picks.length>=maxRoster)return false;
  const needs=rosterNeedsForManager(state,managerIndex);
  const benchSpots=Number(settings.bench||3);
  const startersFilled=5-needs.length;
  const benchUsed=Math.max(0,picks.length-startersFilled-1);
  if(needs.length>0 && benchUsed>=benchSpots && !needs.includes(player.role)) return false;
  return true;
}

function bestAvailableDraftPlayer(state,managerIndex=draftOrderForPick(state.pickIndex,state.managerCount)){
  const taken=new Set(state.picks.map(p=>p.playerId));
  const needs=rosterNeedsForManager(state,managerIndex);
  const pool=eligibleDraftPool();
  return pool.find(p=>!taken.has(p.id)&&canDraftPlayer(state,managerIndex,p)&&(needs.length===0||needs.includes(p.role)))
      || pool.find(p=>!taken.has(p.id)&&canDraftPlayer(state,managerIndex,p));
}

function makeDraftPick(state,player,managerIndex){
  state.picks.push({pick:state.pickIndex+1,round:Math.floor(state.pickIndex/state.managerCount)+1,managerIndex,manager:draftManagerNames[managerIndex]||("Manager "+(managerIndex+1)),playerId:player.id,name:player.name,role:player.role,team:player.team});
  state.pickIndex++;
  state.seconds=30;
  const settings=getLeagueSettings();
  const rounds=6+Number(settings.bench||3);
  state.complete=state.pickIndex>=Math.min(rounds*state.managerCount,eligibleDraftPool().length);
  saveDraftState(state);
}

function runCpuPicks(state){
  let guard=0;
  const maxSteps=Math.max(50,eligibleDraftPool().length+state.managerCount*2);
  while(state.started&&!state.complete&&draftOrderForPick(state.pickIndex,state.managerCount)!==state.userIndex&&guard<maxSteps){
    const managerIndex=draftOrderForPick(state.pickIndex,state.managerCount);
    const p=bestAvailableDraftPlayer(state,managerIndex);
    if(!p){state.complete=true;break;}
    makeDraftPick(state,p,managerIndex);
    guard++;
  }
  saveDraftState(state);
}

const defaultLeagueSettings = {
  name:"Fantasy League",
  managers:"4",
  bench:"1",
  draftType:"Snake",
  scoringFormat:"Head-to-head",
  competition:"worlds",
  competitionSeason:2026,
  competitionType:"international",
  fantasyFormat:"tournament",
  teamSlot:false,
  waivers:true,
  waiverHours:24,
  scoring:{kills:3,deaths:-1,assists:2,cs:0.02,win:5,firstBlood:2}
};

function getLeagueSettings(){
  try{
    const key=scopedLeagueStorageKey("riftLeagueSettings");
    const saved=key?JSON.parse(storageGet(key)||"{}")||{}:{};
    const competition=normalizeCompetitionCode(saved.competition||defaultLeagueSettings.competition)||"worlds";
    return {
      ...defaultLeagueSettings,
      ...saved,
      competition,
      competitionSeason:Number(saved.competitionSeason)||2026,
      competitionType:competitionType(competition),
      fantasyFormat:saved.fantasyFormat||((competition==="first_stand")?"short_event":(competitionType(competition)==="regional"?"season":"tournament")),
      draftType:"Snake",
      teamSlot:false,
      scoringFormat:"Head-to-head",
      scoring:{...defaultLeagueSettings.scoring,...(saved.scoring||{})}
    };
  }catch{
    return {...defaultLeagueSettings,scoring:{...defaultLeagueSettings.scoring}};
  }
}
function cacheLeagueSettings(settings,leagueId=getActiveLeagueId()){
  const key=scopedLeagueStorageKey("riftLeagueSettings",leagueId);
  if(key)storageSet(key,JSON.stringify(settings));
}

let selectedPlayerId=null;
let selectedPlayerReturnView="players";
let selectedMatchupRound=null;
let creatorLabResumeCache=null;
let tradePrefill={id:null,side:null};
let tradeRouteIntent={tab:null,id:null};
let modalReturnFocus=null;

function playerKey(p){
  return String(p.id || p.name || "").toLowerCase().replace(/[^a-z0-9]+/g,"-");
}

function defaultUserRoster(){
  const limit=rosterLimit();
  const live=((window.ESPORTS_DATA&&window.ESPORTS_DATA.players)||[]).map(p=>({...p,fp:Number(p.projection??p.fp??20)}));
  if(live.length>=5){
    const roles=["TOP","JNG","MID","ADC","SUP"];
    const chosen=[];
    for(const role of roles){
      const p=live.find(x=>x.role===role&&!chosen.some(c=>playerKey(c)===playerKey(x)));
      if(p) chosen.push({...p,id:playerKey(p),position:p.role,slot:p.role,role:p.role});
    }
    for(const p of live){
      if(chosen.length>=limit)break;
      if(chosen.some(c=>playerKey(c)===playerKey(p)))continue;
      chosen.push({...p,id:playerKey(p),position:p.role,slot:"BN",role:"BN"});
    }
    if(chosen.length>=5)return chosen.slice(0,limit);
  }
  return [];
}

function currentSessionUserId(){
  const session=backend()?.readSession?.();
  const direct=session?.user?.id;
  if(direct)return String(direct);
  const token=String(session?.access_token||"");
  const payload=token.split(".")[1];
  if(!payload)return null;
  try{
    const normalized=payload.replace(/-/g,"+").replace(/_/g,"/");
    const padded=normalized+"=".repeat((4-normalized.length%4)%4);
    const parsed=JSON.parse(atob(padded));
    return parsed?.sub?String(parsed.sub):null;
  }catch{return null;}
}
function scopedLeagueStorageKey(base,leagueId=getActiveLeagueId()){
  const userId=currentSessionUserId();
  if(!userId)return null;
  return base+":"+userId+(leagueId?":"+String(leagueId):"");
}
function getUserRoster(){
  const key=scopedLeagueStorageKey("riftUserRoster");
  if(!key)return [];
  try{
    const saved=JSON.parse(storageGet(key)||"null");
    return Array.isArray(saved) ? saved : [];
  }catch{
    return [];
  }
}

function formatFantasyPoints(value){
  const n=Number(value);
  return Number.isFinite(n)?n.toFixed(2):"0.00";
}
function fantasyBreakdownRows(breakdown={}){
  const labels={kills:"Kills",deaths:"Deaths",assists:"Assists",cs:"CS",win:"Win",firstBlood:"First Blood"};
  return Object.entries(labels).map(([key,label])=>{
    const row=breakdown?.[key]||{};
    const stat=Number(row.stat)||0;
    const mult=Number(row.multiplier)||0;
    const pts=Number(row.points)||0;
    return {key,label,stat,mult,pts};
  });
}
function renderFantasyBreakdown(score){
  const rows=fantasyBreakdownRows(score?.breakdown||{});
  return `<details class="fantasy-score-breakdown">
    <summary>View score breakdown</summary>
    <div class="fantasy-score-math">${rows.map(r=>`
      <div><span>${h(r.label)}</span><strong>${h(String(r.stat))} × ${h(String(r.mult))} = ${r.pts>=0?"+":""}${h(formatFantasyPoints(r.pts))}</strong></div>`).join("")}</div>
  </details>`;
}
function aggregateFantasyScores(scores=[]){
  const map=new Map();
  const keys=["kills","deaths","assists","cs","win","firstBlood"];
  for(const score of scores){
    const key=String(score.player_id);
    const current=map.get(key)||{
      player_id:key,total:0,live:false,delayed:false,hasUnfinalized:false,finalized:true,games:0,latest:null,rows:[],
      breakdown:Object.fromEntries(keys.map(k=>[k,{stat:0,multiplier:null,points:0}]))
    };
    current.total+=Number(score.fantasy_points)||0;
    current.games+=1;
    current.hasUnfinalized=current.hasUnfinalized||!score.finalized;
    current.finalized=current.finalized&&!!score.finalized;
    current.latest=!current.latest||Date.parse(score.updated_at||"")>Date.parse(current.latest.updated_at||"")?score:current.latest;
    current.rows.push(score);
    for(const k of keys){
      const part=score?.breakdown?.[k]||{};
      current.breakdown[k].stat+=Number(part.stat)||0;
      current.breakdown[k].points+=Number(part.points)||0;
      if(Number.isFinite(Number(part.multiplier)))current.breakdown[k].multiplier=Number(part.multiplier);
    }
    map.set(key,current);
  }
  for(const current of map.values()){
    const updatedAt=Date.parse(current.latest?.updated_at||"");
    const fresh=Number.isFinite(updatedAt)&&Date.now()-updatedAt<=3*60*1000;
    current.live=current.hasUnfinalized&&fresh;
    current.delayed=current.hasUnfinalized&&!fresh;
    delete current.hasUnfinalized;
  }
  return map;
}
function activeLeagueStorageKey(){
  const userId=currentSessionUserId();
  if(userId){
    storageRemove("riftActiveLeagueId");
    storageRemove("riftUserRoster");
    storageRemove("riftLeagueSettings");
  }
  return userId?"riftActiveLeagueId:"+userId:null;
}
function getActiveLeagueId(){
  const key=activeLeagueStorageKey();
  return key?(storageGet(key)||null):null;
}
function setActiveLeagueId(id){
  const key=activeLeagueStorageKey();
  if(!key)return;
  if(id)storageSet(key,String(id));
  else storageRemove(key);
}
function chooseDefaultPlayableLeague(leagues){
  return [...(leagues||[])].sort((a,b)=>{
    const ta=Date.parse(a?.created_at||"")||0;
    const tb=Date.parse(b?.created_at||"")||0;
    if(tb!==ta)return tb-ta;
    return String(a?.id||"").localeCompare(String(b?.id||""));
  })[0]||null;
}

// Completed-league review is a transient viewing context, not the active gameplay league.
let historicalLeagueContextId=null;
function getLeagueContextId(){
  return historicalLeagueContextId||getActiveLeagueId();
}
async function loadRosterFromCloud(leagueId){
  if(!leagueId||!cloudReady())return false;
  const b=backend();
  const user=await b.currentUser().catch(()=>null);
  if(!user)return false;
  try{
    const rows=await b.listRosters(leagueId);
    const mine=rows.filter(r=>String(r.user_id)===String(user.id));
    const source=allFantasyPlayers();
    const loaded=mine.map(row=>{
      const p=source.find(x=>playerKey(x)===String(row.player_id)||String(x.id||"")===String(row.player_id));
      return p?{...p,id:playerKey(p),position:p.role,slot:row.slot||"BN",role:row.slot==="BN"?"BN":p.role}:null;
    }).filter(Boolean);
    const normalized=loaded.length?normalizeUserRoster(loaded):[];
    const rosterKey=scopedLeagueStorageKey("riftUserRoster",leagueId);
    if(rosterKey)storageSet(rosterKey,JSON.stringify(normalized));
    const validation=validateRoster(normalized);
    if(!validation.isComplete){
      const leagues=await b.listLeagues().catch(()=>[]);
      const leagueStatus=String(leagues.find(l=>String(l.id)===String(leagueId))?.status||"");
      if(leagueStatus==="active"){
        const missing=[
          ...validation.missingStarterPositions,
          ...(validation.missingFlexSlots?["FLEX"]:[]),
          ...(validation.missingBenchSlots?["BENCH"]:[])
        ];
        const alertKey="riftRosterAlert:"+leagueId+":"+user.id+":"+normalized.length+":"+missing.join(",");
        let alreadyShown=false;
        try{alreadyShown=sessionStorage.getItem(alertKey)==="1";}catch{}
        if(!alreadyShown){
          const countText=normalized.length+"/"+validation.totalRequired+" players";
          const missingText=missing.length?" Missing: "+missing.join(", ")+".":"";
          showToast("Roster incomplete · "+countText+"."+missingText);
          try{sessionStorage.setItem(alertKey,"1");}catch{}
        }
      }
    }
    return true;
  }catch(err){
    console.warn("Cloud roster load failed:",err);
    return false;
  }
}
async function saveUserRoster(players){
  const normalized=normalizeUserRoster(players);
  const leagueId=getActiveLeagueId();
  if(leagueId&&cloudReady()){
    const b=backend();
    const user=await b.currentUser().catch(()=>null);
    if(!user)throw new Error("Sign in before changing your roster.");
    await b.saveRoster(leagueId,normalized);
  }
  const rosterKey=scopedLeagueStorageKey("riftUserRoster",leagueId);
  if(rosterKey)storageSet(rosterKey,JSON.stringify(normalized));
  return normalized;
}

function getTransactionHistory(){
  try{return JSON.parse(storageGet("riftTransactionHistory")||"[]");}catch{return [];}
}
function saveTransactionHistory(items){
  storageSet("riftTransactionHistory",JSON.stringify(items.slice(0,100)));
}
function logTransaction(type,player,extra={}){
  const items=getTransactionHistory();
  items.unshift({
    id:String(Date.now())+"-"+String(items.length+1),
    type,
    player:player?.name||"Unknown",
    playerId:playerKey(player||{}),
    team:player?.team||"",
    role:player?.position||player?.role||"",
    time:new Date().toISOString(),
    ...extra
  });
  saveTransactionHistory(items);
}
function getWaiverClaims(){
  try{return JSON.parse(storageGet("riftWaiverClaims")||"[]");}catch{return [];}
}
function saveWaiverClaims(items){
  storageSet("riftWaiverClaims",JSON.stringify(items));
}
async function createWaiverClaim(player){
  if(isOwned(player)){showToast(`${player.name} is already on your team.`);return;}
  const leagueId=getActiveLeagueId();
  if(leagueId&&cloudReady()){
    try{
      const existing=await backend().listWaivers(leagueId);
      const user=await backend().currentUser();
      if(existing.some(c=>String(c.user_id)===String(user?.id)&&c.status==="pending"&&String(c.player_id)===playerKey(player))){
        showToast("You already have a claim on this player.");
        return;
      }
      if(getUserRoster().length>=rosterLimit()){
        openWaiverDropChooser(player);
        return;
      }
      await backend().createWaiver(leagueId,playerKey(player),null,null);
      showToast(`Waiver claim submitted for ${player.name}`);
      return;
    }catch(err){showToast(err.message||"Could not submit waiver claim");return;}
  }
  const claims=getWaiverClaims();
  if(claims.some(c=>c.playerId===playerKey(player))){showToast("You already have a claim on this player.");return;}
  claims.push({id:String(Date.now()),playerId:playerKey(player),player:player.name,team:player.team||"",role:player.role||"",createdAt:new Date().toISOString(),status:"pending"});
  saveWaiverClaims(claims);
  showToast(`Waiver claim submitted for ${player.name}`);
}

function getTradeOffers(){
  try{return JSON.parse(storageGet("riftTradeOffers")||"[]");}catch{return [];}
}
function saveTradeOffers(items){
  storageSet("riftTradeOffers",JSON.stringify(items.slice(0,100)));
}
function getTradeHistory(){
  try{return JSON.parse(storageGet("riftTradeHistory")||"[]");}catch{return [];}
}
function saveTradeHistory(items){
  storageSet("riftTradeHistory",JSON.stringify(items.slice(0,100)));
}
function leagueManagers(){
  const count=Number(getLeagueSettings().managers)||8;
  return draftManagerNames.filter((_,i)=>i!==1).slice(0,Math.max(1,count-1));
}
function simulatedRosterForManager(manager){
  const owned=new Set(getUserRoster().map(playerKey));
  const pool=allFantasyPlayers().filter(p=>!owned.has(playerKey(p)));
  const seed=Math.max(0,leagueManagers().indexOf(manager));
  const chosen=[];
  for(let i=seed;i<pool.length && chosen.length<8;i+=Math.max(1,leagueManagers().length)) chosen.push(pool[i]);
  if(chosen.length<5){
    for(const p of pool){if(!chosen.some(x=>playerKey(x)===playerKey(p)))chosen.push(p);if(chosen.length>=8)break;}
  }
  return chosen;
}
function completeIncomingTrade(offer,accept){
  const offers=getTradeOffers();
  const idx=offers.findIndex(o=>o.id===offer.id);
  if(idx<0)return;
  if(accept){
    const rosterNow=getUserRoster();
    const outgoing=rosterNow.find(p=>playerKey(p)===offer.userPlayerId);
    const incoming=playerById(offer.theirPlayerId) || {id:offer.theirPlayerId,name:offer.theirPlayer,team:offer.theirTeam,role:offer.theirRole,fp:offer.theirFp};
    if(!outgoing||!incoming){showToast("Trade could not be completed.");return;}
    const next=rosterNow.filter(p=>playerKey(p)!==offer.userPlayerId);
    next.push({...incoming,id:playerKey(incoming),position:incoming.position||incoming.role,slot:"BN"});
    saveUserRoster(arrangeUserRoster(next));
    logTransaction("drop",outgoing,{tradeWith:offer.partner});
    logTransaction("add",incoming,{tradeWith:offer.partner});
    offers[idx]={...offer,status:"accepted",resolvedAt:new Date().toISOString()};
    const hist=getTradeHistory(); hist.unshift(offers[idx]); saveTradeHistory(hist);
    saveTradeOffers(offers.filter(o=>o.id!==offer.id));
    showToast("Trade accepted and roster updated.");
  }else{
    offers[idx]={...offer,status:"declined",resolvedAt:new Date().toISOString()};
    const hist=getTradeHistory(); hist.unshift(offers[idx]); saveTradeHistory(hist);
    saveTradeOffers(offers.filter(o=>o.id!==offer.id));
    showToast("Trade declined.");
  }
}

const ROSTER_RULES=Object.freeze({
  starterSlots:Object.freeze(["TOP","JNG","MID","ADC","SUP"]),
  flexSlot:"FLEX",
  benchSlot:"BN",
  flexEligibleRoles:Object.freeze(["TOP","JNG","MID","ADC","SUP"])
});

function playerPosition(player){
  const role=String(player?.position||player?.role||"").toUpperCase();
  return ROSTER_RULES.starterSlots.includes(role)?role:"";
}

function isFlexEligible(player){
  return ROSTER_RULES.flexEligibleRoles.includes(playerPosition(player));
}

function rosterRequirements(settings=getLeagueSettings()){
  const benchRequired=Math.max(1,Number(settings?.bench||1));
  return {
    starterSlots:[...ROSTER_RULES.starterSlots],
    flexSlots:1,
    benchRequired,
    totalRequired:ROSTER_RULES.starterSlots.length+1+benchRequired
  };
}

function validateRoster(players,settings=getLeagueSettings()){
  const roster=Array.isArray(players)?players:[];
  const req=rosterRequirements(settings);
  const filledStarterSlots=req.starterSlots.filter(slot=>roster.some(p=>(p.slot||p.role)===slot&&playerPosition(p)===slot));
  const missingStarterPositions=req.starterSlots.filter(slot=>!filledStarterSlots.includes(slot));
  const flexPlayers=roster.filter(p=>(p.slot||p.role)===ROSTER_RULES.flexSlot&&isFlexEligible(p));
  const benchPlayers=roster.filter(p=>(p.slot||p.role)===ROSTER_RULES.benchSlot);
  const missingFlexSlots=Math.max(0,1-flexPlayers.length);
  const missingBenchSlots=Math.max(0,req.benchRequired-benchPlayers.length);
  const totalPlayersMissing=Math.max(0,req.totalRequired-roster.length);
  const isComplete=missingStarterPositions.length===0&&missingFlexSlots===0&&missingBenchSlots===0&&roster.length===req.totalRequired;
  return {
    isComplete,
    requiredStartingSlots:req.starterSlots,
    filledStartingSlots:filledStarterSlots,
    missingStarterPositions,
    missingStarterSlots:missingStarterPositions.length,
    missingFlexSlots,
    requiredBenchSize:req.benchRequired,
    currentBenchSize:benchPlayers.length,
    missingBenchSlots,
    totalPlayersMissing,
    totalRequired:req.totalRequired,
    currentTotal:roster.length
  };
}

function rosterStatusText(status){
  if(status.isComplete){
    return `All 5 starting positions, FLEX, and ${status.requiredBenchSize} bench ${status.requiredBenchSize===1?"player":"players"} are filled.`;
  }
  const parts=[];
  if(status.missingStarterSlots){
    parts.push(`${status.missingStarterPositions.join(", ")} starting ${status.missingStarterSlots===1?"position":"positions"}`);
  }
  if(status.missingFlexSlots)parts.push("1 FLEX");
  if(status.missingBenchSlots)parts.push(`${status.missingBenchSlots} Bench ${status.missingBenchSlots===1?"Player":"Players"}`);
  return parts.length?`You still need: ${parts.join(" · ")}.`:"Your roster needs attention.";
}

function draftAssignments(picks){
  const ordered=[...(picks||[])].sort((x,y)=>Number(x.pick_number||x.pick||0)-Number(y.pick_number||y.pick||0));
  const usedRoles=new Set();
  let flexUsed=false;
  return ordered.map(p=>{
    const role=String(p.role||"").toUpperCase();
    let slot="BN";
    if(ROSTER_RULES.starterSlots.includes(role)&&!usedRoles.has(role)){
      usedRoles.add(role);
      slot=role;
    }else if(!flexUsed&&ROSTER_RULES.flexEligibleRoles.includes(role)){
      flexUsed=true;
      slot="FLEX";
    }
    return {...p,position:role,slot};
  });
}

function arrangeUserRoster(players){
  const used=new Set();
  const arranged=[];
  ROSTER_RULES.starterSlots.forEach(role=>{
    const idx=players.findIndex((p,i)=>!used.has(i)&&playerPosition(p)===role);
    if(idx>=0){
      used.add(idx);
      arranged.push({...players[idx],position:role,slot:role,role});
    }
  });
  const flexIdx=players.findIndex((p,i)=>!used.has(i)&&isFlexEligible(p));
  if(flexIdx>=0){
    used.add(flexIdx);
    const p=players[flexIdx];
    arranged.push({...p,position:playerPosition(p),slot:"FLEX",role:playerPosition(p)});
  }
  players.forEach((p,i)=>{
    if(!used.has(i)){
      const position=playerPosition(p);
      arranged.push({...p,position,slot:"BN",role:"BN"});
    }
  });
  return arranged;
}

function normalizeUserRoster(players){
  const usedStarters=new Set();
  let flexUsed=false;
  return (players||[]).map(p=>{
    const position=playerPosition(p);
    const requested=String(p.slot||p.role||"BN").toUpperCase();
    if(position&&requested===position&&!usedStarters.has(position)){
      usedStarters.add(position);
      return {...p,position,slot:position,role:position};
    }
    if(requested===ROSTER_RULES.flexSlot&&position&&isFlexEligible({...p,position})&&!flexUsed){
      flexUsed=true;
      return {...p,position,slot:"FLEX",role:position};
    }
    return {...p,position,slot:"BN",role:"BN"};
  });
}

function rosterLimit(){
  return rosterRequirements().totalRequired;
}

function isOwned(player){
  const key=playerKey(player);
  return getUserRoster().some(p=>playerKey(p)===key);
}

function closeTransactionModal(){
  const modal=document.querySelector("#transactionModal");
  if(modal){
    modal.hidden=true;
    document.body.classList.remove("modal-open");
    const shell=document.querySelector(".app-shell");
    if(shell)shell.inert=false;
  }
  if(modalReturnFocus&&document.contains(modalReturnFocus)){
    modalReturnFocus.focus();
  }
  modalReturnFocus=null;
}

let lineupSwapReturnFocus=null;
function closeLineupSwapModal(){
  const modal=document.querySelector("#lineupSwapModal");
  if(modal){
    modal.hidden=true;
    document.body.classList.remove("modal-open");
    const shell=document.querySelector(".app-shell");
    if(shell)shell.inert=false;
  }
  if(lineupSwapReturnFocus&&document.contains(lineupSwapReturnFocus))lineupSwapReturnFocus.focus();
  lineupSwapReturnFocus=null;
}

function openBenchReplacementChooser(starter,current,candidates,onComplete){
  const modal=document.querySelector("#lineupSwapModal");
  const list=document.querySelector("#lineupSwapList");
  const copy=document.querySelector("#lineupSwapCopy");
  if(!modal||!list||!copy)return;
  const starterSlot=starter.slot||starter.role;
  copy.textContent=`Choose who should replace ${starter.name} in ${starterSlot}.`;
  list.innerHTML=candidates.map(candidate=>`<button class="drop-option" data-bench-replacement-id="${playerKey(candidate)}"><span class="role-badge">${h(candidate.slot||candidate.role)}</span><span><strong>${h(candidate.name)}</strong><small>${h(candidate.team)} · ${h(playerPosition(candidate))}</small></span><span class="drop-action">SWAP</span></button>`).join("");
  list.querySelectorAll("[data-bench-replacement-id]").forEach(btn=>btn.onclick=async()=>{
    const replacement=current.find(p=>playerKey(p)===btn.dataset.benchReplacementId);
    if(!replacement)return;
    const next=current.map(p=>{
      if(playerKey(p)===playerKey(starter))return {...p,position:playerPosition(p),slot:"BN",role:"BN"};
      if(playerKey(p)===playerKey(replacement))return {...p,position:playerPosition(p),slot:starterSlot,role:playerPosition(p)};
      return p;
    });
    btn.disabled=true;
    try{
      await saveUserRoster(next);
      closeLineupSwapModal();
      showToast(`${replacement.name} moved into ${starterSlot}`);
      if(typeof onComplete==="function")onComplete();
    }catch(err){
      showToast(err.message||"Could not update lineup");
      btn.disabled=false;
    }
  });
  lineupSwapReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  modal.hidden=false;
  document.body.classList.add("modal-open");
  const shell=document.querySelector(".app-shell");
  if(shell)shell.inert=true;
  queueMicrotask(()=>list.querySelector("[data-bench-replacement-id]")?.focus());
}

function openLineupSwapChooser(player,current,targets,onComplete){
  const modal=document.querySelector("#lineupSwapModal");
  const list=document.querySelector("#lineupSwapList");
  const copy=document.querySelector("#lineupSwapCopy");
  if(!modal||!list||!copy)return;
  copy.textContent=`Your starting lineup is full. Who would you like to replace with ${player.name}?`;
  list.innerHTML=targets.map(target=>{
    const slot=target.slot||target.role;
    return `<button class="drop-option" data-lineup-swap-id="${playerKey(target)}"><span class="role-badge">${h(slot)}</span><span><strong>${h(target.name)}</strong><small>${h(target.team)} · ${h(playerPosition(target))}</small></span><span class="drop-action">SWAP</span></button>`;
  }).join("");
  list.querySelectorAll("[data-lineup-swap-id]").forEach(btn=>btn.onclick=async()=>{
    const target=current.find(p=>playerKey(p)===btn.dataset.lineupSwapId);
    if(!target)return;
    const targetSlot=target.slot||target.role;
    const next=current.map(p=>{
      if(playerKey(p)===playerKey(player))return {...p,position:playerPosition(p),slot:targetSlot,role:playerPosition(p)};
      if(playerKey(p)===playerKey(target))return {...p,position:playerPosition(p),slot:"BN",role:"BN"};
      return p;
    });
    btn.disabled=true;
    try{
      await saveUserRoster(next);
      closeLineupSwapModal();
      showToast(`${player.name} swapped into ${targetSlot}`);
      if(typeof onComplete==="function")onComplete();
    }catch(err){
      showToast(err.message||"Could not update lineup");
      btn.disabled=false;
    }
  });
  lineupSwapReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  modal.hidden=false;
  document.body.classList.add("modal-open");
  const shell=document.querySelector(".app-shell");
  if(shell)shell.inert=true;
  queueMicrotask(()=>list.querySelector("[data-lineup-swap-id]")?.focus());
}


async function addPlayerToRoster(player){
  if(isOwned(player)){showToast(`${player.name} is already on your team.`);return;}
  let current=getUserRoster();
  if(current.length<rosterLimit()){
    current.push({...player,id:playerKey(player),position:player.position||player.role,slot:"BN"});
    try{
      await saveUserRoster(current);
      logTransaction("add",player);
      showToast(`${player.name} added to your team`);
    }catch(err){showToast(err.message||"Could not add player");}
    return;
  }
  openDropChooser(player);
}

function openDropChooser(incoming){
  const modal=document.querySelector("#transactionModal");
  const list=document.querySelector("#transactionDropList");
  const copy=document.querySelector("#transactionCopy");
  if(!modal||!list||!copy)return;
  const current=getUserRoster();
  const incomingRole=playerPosition(incoming);
  const compatible=current.filter(p=>{
    const slot=p.slot||p.role;
    if(slot==="BN")return true;
    if(slot==="FLEX")return isFlexEligible(incoming);
    return slot===incomingRole;
  });
  copy.textContent=`Your roster is full. Choose who to replace with ${incoming.name}.`;
  list.innerHTML=compatible.length
    ?compatible.map(p=>`<button class="drop-option" data-drop-id="${playerKey(p)}"><span class="role-badge">${h(p.slot||p.role)}</span><span><strong>${h(p.name)}</strong><small>${h(p.team)} · ${h(p.position||p.role)}</small></span><span class="drop-action">REPLACE</span></button>`).join("")
    :'<div class="empty-state"><strong>No legal replacement available</strong><small>This player cannot replace any unlocked roster slot without making your lineup incomplete.</small></div>';
  list.querySelectorAll("[data-drop-id]").forEach(btn=>btn.onclick=()=>{
    const dropId=btn.dataset.dropId;
    const dropped=current.find(p=>playerKey(p)===dropId);
    const next=current.filter(p=>playerKey(p)!==dropId);
    next.push({...incoming,id:playerKey(incoming),position:incoming.position||incoming.role,slot:"BN"});
    void (async()=>{
      try{
        await saveUserRoster(next);
        if(dropped) logTransaction("drop",dropped,{pairedWith:incoming.name});
    logTransaction("add",incoming,{pairedWith:dropped?.name||null});
    closeTransactionModal();
    showToast(`Added ${incoming.name} · Dropped ${dropped?.name||"player"}`);
        if(document.querySelector("#profileName")) render("player");
        else if(document.querySelector("#starterRosterList")) render("team");
        else if(document.querySelector("#freeAgentList")) render("players");
      }catch(err){showToast(err.message||"Could not update roster");}
    })();
  });
  modalReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  modal.hidden=false;
  document.body.classList.add("modal-open");
  const shell=document.querySelector(".app-shell");
  if(shell)shell.inert=true;
  queueMicrotask(()=>list.querySelector("[data-drop-id]")?.focus());
}

function openWaiverDropChooser(incoming){
  const modal=document.querySelector("#transactionModal");
  const list=document.querySelector("#transactionDropList");
  const copy=document.querySelector("#transactionCopy");
  const leagueId=getActiveLeagueId();
  if(!modal||!list||!copy||!leagueId||!cloudReady())return;
  const current=getUserRoster();
  const incomingRole=playerPosition(incoming);
  const compatible=current.filter(p=>{
    const slot=p.slot||p.role;
    if(slot==="BN")return true;
    if(slot==="FLEX")return isFlexEligible(incoming);
    return slot===incomingRole;
  });
  copy.textContent="Your roster is full. Choose who would be replaced if your waiver claim for "+incoming.name+" wins.";
  list.innerHTML=compatible.length
    ?compatible.map(p=>'<button class="drop-option" data-waiver-drop-id="'+playerKey(p)+'"><span class="role-badge">'+h(p.slot||p.role)+'</span><span><strong>'+h(p.name)+'</strong><small>'+h(p.team)+' · '+h(p.position||p.role)+'</small></span><span class="drop-action">REPLACE IF WON</span></button>').join("")
    :'<div class="empty-state"><strong>No legal replacement available</strong><small>This waiver player cannot replace a roster slot without making your lineup incomplete.</small></div>';
  list.querySelectorAll("[data-waiver-drop-id]").forEach(btn=>btn.onclick=async()=>{
    const dropId=btn.dataset.waiverDropId;
    btn.disabled=true;
    try{
      await backend().createWaiver(leagueId,playerKey(incoming),null,dropId);
      closeTransactionModal();
      showToast("Waiver claim submitted for "+incoming.name);
    }catch(err){showToast(err.message||"Could not submit waiver claim");btn.disabled=false;}
  });
  modalReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  modal.hidden=false;
  document.body.classList.add("modal-open");
  const shell=document.querySelector(".app-shell");
  if(shell)shell.inert=true;
  queueMicrotask(()=>list.querySelector("[data-waiver-drop-id]")?.focus());
}

function allFantasyPlayers(){
  return ((window.ESPORTS_DATA&&window.ESPORTS_DATA.players)||[]).map(p=>({...p,fp:Number(p.projection??p.fp??0)}));
}
function eligibleFantasyPlayers(settings=getLeagueSettings()){
  const code=normalizeCompetitionCode(settings?.competition);
  return allFantasyPlayers().filter(p=>playerEligibleForCompetition(p,code));
}
function competitionCapacity(competition,bench=1){
  const code=normalizeCompetitionCode(competition);
  const benchCount=Math.max(0,Number(bench)||0);
  const pool=allFantasyPlayers().filter(p=>playerAvailableForAcquisition(p,code));
  const roleCounts=Object.fromEntries(["TOP","JNG","MID","ADC","SUP"].map(role=>[role,pool.filter(p=>p.role===role).length]));
  const roleLimit=Math.min(...Object.values(roleCounts));
  const rosterSize=6+benchCount;
  const totalLimit=Math.floor(pool.length/rosterSize);
  const maxManagers=Math.max(0,Math.min(10,roleLimit,totalLimit));
  return {code,poolSize:pool.length,roleCounts,rosterSize,maxManagers};
}
function capacityMessage(competition,bench=1){
  const cap=competitionCapacity(competition,bench);
  const name=competitionName(cap.code);
  if(cap.maxManagers<1)return `${name} is not open for fantasy drafting yet because there is no complete eligible player pool.`;
  return `${name}: ${cap.poolSize} draftable players · up to ${cap.maxManagers} manager${cap.maxManagers===1?"":"s"} with ${Number(bench)||0} bench spot${Number(bench)===1?"":"s"}.`;
}
async function applyCompetitionScheduleAvailability(select,onChange){
  if(!select||!cloudReady()||typeof backend()?.listProMatches!=="function")return;
  const year=new Date().getFullYear();
  const [rows,statusRows]=await Promise.all([
    backend().listProMatches(null,new Date(Date.UTC(year,0,1)),new Date(Date.UTC(year+1,0,1))).catch(()=>[]),
    backend().listPlayerCompetitionStatus().catch(()=>[])
  ]);
  const groupedStatuses=new Map();
  for(const row of (statusRows||[])){
    const code=normalizeCompetitionCode(row.competition);
    if(!code)continue;
    const arr=groupedStatuses.get(code)||[];
    arr.push(row);
    groupedStatuses.set(code,arr);
  }
  for(const [code,items] of groupedStatuses)cacheCompetitionStatuses(code,items);
  if(!Array.isArray(rows)||!rows.length)return;
  const byCompetition=new Map();
  for(const row of rows){
    const code=normalizeCompetitionCode(row.competition);
    if(!code)continue;
    const state=byCompetition.get(code)||{any:false,future:false};
    state.any=true;
    const t=Date.parse(row.start_time||"");
    const status=String(row.status||"").toUpperCase();
    if(Number.isFinite(t)&&t>Date.now()&&!["COMPLETED","CANCELED","CANCELLED","POSTPONED"].includes(status))state.future=true;
    byCompetition.set(code,state);
  }
  for(const option of select.options){
    const code=normalizeCompetitionCode(option.value);
    const state=byCompetition.get(code);
    if(!state?.any)continue;
    if(!option.dataset.baseLabel)option.dataset.baseLabel=option.textContent;
    const closed=!state.future;
    option.disabled=closed;
    option.textContent=closed?option.dataset.baseLabel+" · Season Complete":option.dataset.baseLabel;
  }
  if(select.selectedOptions[0]?.disabled){
    const next=[...select.options].find(option=>!option.disabled&&competitionCapacity(option.value,1).maxManagers>0);
    if(next)select.value=next.value;
  }
  if(typeof onChange==="function")onChange();
}

function watchlistIds(){
  try{return new Set(JSON.parse(storageGet("riftWatchlist")||"[]"));}catch{return new Set();}
}

function setWatchlist(ids){
  storageSet("riftWatchlist",JSON.stringify([...ids]));
}

function playerById(id){
  return allFantasyPlayers().find(p=>playerKey(p)===String(id)||String(p.id||"")===String(id));
}

function chainPlayerStats(player){
  const key=String(player?.name||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  return window.PLAYER_STATS?.players?.[key]||null;
}

function fantasyPointsForGame(game,scoring=getLeagueSettings()?.scoring||defaultLeagueSettings.scoring){
  if(!game)return null;
  const kills=Number(game.kills),deaths=Number(game.deaths),assists=Number(game.assists),cs=Number(game.cs);
  if(![kills,deaths,assists].every(Number.isFinite))return null;
  let total=kills*Number(scoring.kills||0)+deaths*Number(scoring.deaths||0)+assists*Number(scoring.assists||0);
  if(Number.isFinite(cs))total+=cs*Number(scoring.cs||0);
  if(game.win===true)total+=Number(scoring.win||0);
  if(game.firstBlood===true)total+=Number(scoring.firstBlood||0);
  return Number(total.toFixed(1));
}

function openPlayer(id,returnView=currentView||"players"){
  selectedPlayerId=id;
  selectedPlayerReturnView=returnView==="player"?"players":returnView;
  render("player");
}

function h(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}

function backend(){
  return window.RiftBackend||null;
}
function cloudReady(){
  const b=backend();
  return !!(b&&typeof b.request==="function"&&typeof b.currentUser==="function");
}
function cloudUserEmail(user){
  return user?.email||user?.user_metadata?.email||"Manager";
}

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

function showToast(message){
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(()=>toast.classList.remove("show"),1800);
}

function playerRow(p, add=false){
  const pid=playerKey(p);
  const image=p.image||p.imageUrl||p.photo||"";
  return `<div class="player-row">
    <button class="player-open-btn" data-open-player="${pid}" aria-label="Open ${h(p.name)} profile">
      ${image?`<img class="player-list-image" src="${h(image)}" alt="" loading="lazy" />`:`<span class="role-badge">${h(p.role)}</span>`}
      <span class="player-info"><strong>${h(p.name)}</strong><small>${h(p.team)} · ${h(p.role)}</small></span>
    </button>
    ${add ? '<div class="player-fantasy-state"><span class="player-status-label">Available</span><button class="add-btn" aria-label="Add player">ADD</button></div>' : ""}
  </div>`;
}

function rosterRow(p, manage=false){
  const slot=p.slot||p.role;
  const position=playerPosition(p);
  const isBench=slot==="BN";
  const locked=!!p.lineupLock;
  const lineupAction=isBench
    ? '<button class="mini-btn" data-start-roster="'+playerKey(p)+'">START</button>'
    : '<button class="mini-btn" data-bench-roster="'+playerKey(p)+'">BENCH</button>';
  const lockBadge=locked?'<span class="lineup-lock-badge" title="This player is locked for the current fantasy period">🔒 LOCKED</span>':"";
  return `<div class="roster-slot ${isBench?"bench":""} ${locked?"lineup-locked":""}">
    <span class="slot-label">${h(slot)}</span>
    <div class="player-info"><strong>${h(p.name)}</strong><small>${h(p.team)} · ${h(position||p.role)}${p.opp?" · "+h(p.opp):""}</small>${lockBadge}</div>
    ${manage?(locked?'<div class="team-actions"><span class="locked-action">Match started</span></div>':'<div class="team-actions">'+lineupAction+'</div>'):""}
  </div>`;
}

let currentView=null;
let navigationDepth=0;
const VERIFY_PENDING_KEY="riftVerificationPending";

function getVerificationPending(){
  try{
    const value=JSON.parse(localStorage.getItem(VERIFY_PENDING_KEY)||"null");
    if(!value?.email||!Number.isFinite(Number(value.availableAt)))return null;
    return {email:String(value.email),availableAt:Number(value.availableAt)};
  }catch{return null;}
}

function markVerificationPending(email){
  try{
    localStorage.setItem(VERIFY_PENDING_KEY,JSON.stringify({
      email:String(email||"").trim(),
      availableAt:Date.now()+60000
    }));
  }catch{}
}

function clearVerificationPending(){
  try{localStorage.removeItem(VERIFY_PENDING_KEY);}catch{}
}

function setupVerificationResend(button,emailInput){
  if(!button)return;
  const pending=getVerificationPending();
  if(!pending){
    button.hidden=true;
    return;
  }
  if(emailInput&&!emailInput.value)emailInput.value=pending.email;
  const reveal=()=>{button.hidden=false;};
  const delay=pending.availableAt-Date.now();
  if(delay<=0)reveal();
  else{
    button.hidden=true;
    setTimeout(()=>{
      const latest=getVerificationPending();
      if(latest)reveal();
    },delay);
  }
}
function goBack(fallback="home"){
  if(navigationDepth>0) history.back();
  else render(fallback,{replace:true});
}

function render(view="home",options={}){
  const requested=String(view||"home").replace(/[^a-z-]/g,"");
  const templateName=requested==="my-schedule"?"schedule":requested;
  const template=document.querySelector(`#${templateName}-template`);
  if(!template){
    if(requested!=="home") return render("home",{...options,replace:true});
    return;
  }
  view=requested;
  historicalLeagueContextId=options.historyLeagueId?String(options.historyLeagueId):null;
  if(["home","league","create-league","join-league","bot-league","bot-settings","bot-confirm","bot-success","my-schedule","creator-lab"].includes(view)&&!backend()?.readSession?.()?.access_token){
    return render("login",{...options,replace:true});
  }
  if(view!=="draft"&&draftTimerId){clearInterval(draftTimerId);draftTimerId=null;}
  if(view!=="trade"&&tradeTimerId){clearInterval(tradeTimerId);tradeTimerId=null;}
  if(view!=="trade"&&tradeRealtimeCleanup){try{tradeRealtimeCleanup();}catch{}tradeRealtimeCleanup=null;}
  if(view!=="creator-lab"&&creatorSimulationTimerId){clearInterval(creatorSimulationTimerId);creatorSimulationTimerId=null;}
  if(!options.fromHistory){
    const hash="#"+view;
    if(options.replace||currentView===null){
      const depth=Number(history.state?.depth)||0;
      navigationDepth=depth;
      history.replaceState({view,depth,historyLeagueId:historicalLeagueContextId},"",hash);
    }else if(currentView!==view){
      navigationDepth+=1;
      history.pushState({view,depth:navigationDepth,historyLeagueId:historicalLeagueContextId},"",hash);
    }
  }
  currentView=view;
  app.innerHTML="";
  app.appendChild(template.content.cloneNode(true));
  const titles={login:"Sign In",signup:"Create Account",verify:"Verify Email",home:"Home",account:"Account","creator-lab":"Mock Draft Simulator",team:"My Team",matchup:"Matchup",standings:"Standings",schedule:"Schedule","my-schedule":"My Schedule",players:"Players",player:"Player",league:"League","create-league":"Create League","join-league":"Join League","bot-league":"Create Bot League","bot-settings":"Bot League Settings","bot-confirm":"Confirm Bot League","bot-success":"League Created",transactions:"Transactions",trade:"Trades",draft:"Draft Room",setup:"League Setup",privacy:"Privacy Notice",terms:"Terms"};
  document.title=`${titles[view]||"Rift Fantasy"} · Rift Fantasy`;
  document.body.classList.toggle("login-view",["login","signup","verify"].includes(view));
  document.body.classList.toggle("standings-view",view==="standings");
  const primaryView={
    team:"league",
    matchup:"league",
    standings:"league",
    transactions:"league",
    trade:"league",
    draft:"league",
    setup:"league",
    "create-league":"league",
    "join-league":"league",
    "bot-league":"league",
    "bot-settings":"league",
    "bot-confirm":"league",
    "bot-success":"league",
    schedule:"home",
    "my-schedule":"home",
    player:"players",
    "creator-lab":"account"
  }[view]||view;
  document.querySelectorAll(".nav-item").forEach(b=>{
    const active=b.dataset.view===primaryView;
    b.classList.toggle("active",active);
    if(active)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");
  });

  if(view==="login"){
    const b=backend();
    const email=document.querySelector("#landingEmail");
    const password=document.querySelector("#landingPassword");
    const signInBtn=document.querySelector("#landingSignIn");
    const resendBtn=document.querySelector("#landingResendVerification");
    setupVerificationResend(resendBtn,email);
    const createAccountBtn=document.querySelector("#landingCreateAccount");
    const setBusy=value=>{signInBtn.disabled=value;if(createAccountBtn)createAccountBtn.disabled=value;};

    document.querySelector("#landingPasswordToggle").onclick=()=>{
      const hidden=password.type==="password";
      password.type=hidden?"text":"password";
      document.querySelector("#landingPasswordToggle").textContent=hidden?"Hide":"Show";
      document.querySelector("#landingPasswordToggle").setAttribute("aria-label",hidden?"Hide password":"Show password");
    };

    const signIn=async()=>{
      if(!email.checkValidity()||password.value.length<8)return showToast("Enter a valid email and password.");
      if(!b?.signIn)return showToast("Account service failed to load. Refresh the app and try again.");
      setBusy(true);
      try{
        await b.signIn(email.value.trim(),password.value);
        clearVerificationPending();
        showToast("Welcome back");
        render("home",{replace:true});
      }catch(err){
        const msg=String(err.message||"");
        showToast(/invalid login credentials/i.test(msg)?"Email or password is incorrect, or your email is not verified yet.":msg||"Sign-in failed");
      }finally{setBusy(false);}
    };

    signInBtn.onclick=signIn;
    password.addEventListener("keydown",e=>{if(e.key==="Enter")signIn();});

    document.querySelector("#landingForgotPassword").onclick=async()=>{
      const value=email.value.trim();
      if(!email.checkValidity())return showToast("Enter your email first, then tap Forgot password.");
      const btn=document.querySelector("#landingForgotPassword");btn.disabled=true;
      try{
        await b.requestPasswordReset(value);
        showToast("Password-reset email sent.");
      }catch(err){
        const msg=String(err.message||"");
        showToast(/rate|limit|too many/i.test(msg)?"Email limit reached. Try again later.":msg||"Could not send password-reset email.");
      }finally{setTimeout(()=>{btn.disabled=false;},3000);}
    };

    document.querySelector("#landingForgotUsername").onclick=()=>{
      showToast("Your Rift Fantasy username is currently your email address.");
    };

    resendBtn.onclick=async()=>{
      const value=email.value.trim();
      if(!email.checkValidity())return showToast("Enter the email used to create your account first.");
      const btn=document.querySelector("#landingResendVerification");btn.disabled=true;
      try{
        await b.resendSignup(value);
        showToast("Verification email sent.");
      }catch(err){
        const msg=String(err.message||"");
        showToast(/rate|limit|too many/i.test(msg)?"Email limit reached. Try again later.":msg||"Could not resend verification email.");
      }finally{setTimeout(()=>{btn.disabled=false;},3000);}
    };

    createAccountBtn.onclick=()=>render("signup");
  }

  if(view==="signup"){
    const b=backend();
    const ready=cloudReady();
    const email=document.querySelector("#signupEmail");
    const password=document.querySelector("#signupPassword");
    const confirm=document.querySelector("#signupPasswordConfirm");
    const submit=document.querySelector("#signupSubmit");
    const toggle=document.querySelector("#signupPasswordToggle");

    toggle.onclick=()=>{
      const hidden=password.type==="password";
      password.type=hidden?"text":"password";
      confirm.type=hidden?"text":"password";
      toggle.textContent=hidden?"Hide":"Show";
      toggle.setAttribute("aria-label",hidden?"Hide password":"Show password");
    };

    document.querySelector("#signupBack").onclick=()=>render("login");

    submit.onclick=async()=>{
      if(!ready)return showToast("Account services are temporarily unavailable.");
      const value=email.value.trim();
      if(!email.checkValidity())return showToast("Enter a valid email address.");
      if(password.value.length<8)return showToast("Password must be at least 8 characters.");
      if(password.value!==confirm.value)return showToast("Passwords do not match.");
      submit.disabled=true;
      try{
        const result=await b.signUp(value,password.value);
        if(result?.access_token){
          clearVerificationPending();
          showToast("Account created");
          render("home",{replace:true});
        }else{
          markVerificationPending(value);
          render("verify",{replace:true});
        }
      }catch(err){
        const msg=String(err.message||"");
        showToast(/rate|limit|too many/i.test(msg)?"Email limit reached. Try again later.":msg||"Could not create account.");
      }finally{submit.disabled=false;}
    };
  }

  if(view==="verify"){
    const pending=getVerificationPending();
    const emailText=document.querySelector("#verifyEmailText");
    const resend=document.querySelector("#verifyResendBtn");
    const waitText=document.querySelector("#verifyWaitText");
    if(pending?.email)emailText.textContent=pending.email;

    document.querySelector("#verifyBackToLogin").onclick=()=>render("login");

    if(pending){
      setupVerificationResend(resend,null);
      const updateWait=()=>{
        const latest=getVerificationPending();
        if(!latest){waitText.hidden=true;return;}
        const seconds=Math.max(0,Math.ceil((latest.availableAt-Date.now())/1000));
        if(seconds<=0){
          waitText.hidden=true;
          resend.hidden=false;
        }else{
          waitText.hidden=false;
          waitText.textContent=`You can request another email in ${seconds} second${seconds===1?"":"s"}.`;
          setTimeout(updateWait,1000);
        }
      };
      updateWait();
    }else{
      waitText.hidden=true;
      resend.hidden=true;
    }

    resend.onclick=async()=>{
      const latest=getVerificationPending();
      if(!latest?.email)return showToast("Return to sign up and enter your email again.");
      resend.disabled=true;
      try{
        await backend().resendSignup(latest.email);
        markVerificationPending(latest.email);
        resend.hidden=true;
        waitText.hidden=false;
        waitText.textContent="Verification email sent. You can request another in 60 seconds.";
        showToast("Verification email sent.");
        setTimeout(()=>render("verify",{replace:true}),60000);
      }catch(err){
        const msg=String(err.message||"");
        showToast(/rate|limit|too many/i.test(msg)?"Email limit reached. Try again later.":msg||"Could not resend verification email.");
      }finally{resend.disabled=false;}
    };
  }

  if(view==="account"){
    const b=backend();
    const ready=cloudReady();
    const authCard=document.querySelector("#authCard");
    const signedInCard=document.querySelector("#signedInCard");
    const recoveryCard=document.querySelector("#recoveryCard");
    if(!ready){
      authCard.classList.add("auth-disabled");
      const authHelp=document.querySelector("#authHelp");
      if(authHelp){
        authHelp.textContent="Account services are temporarily unavailable.";
        authHelp.hidden=false;
      }
    }
    (async()=>{
      const user=ready?await b.currentUser().catch(()=>null):null;
      const recovery=ready&&b?.isRecoveryMode?.();
      if(recovery){
        authCard.hidden=true;
        signedInCard.hidden=true;
        recoveryCard.hidden=false;
      }else if(user){
        authCard.hidden=true;
        recoveryCard.hidden=true;
        signedInCard.hidden=false;
        document.querySelector("#signedInEmail").textContent=cloudUserEmail(user);
        const creatorEntry=document.querySelector("#creatorLabEntry");
        const creatorButton=document.querySelector("#openCreatorLabBtn");
        const creatorEntryStatus=document.querySelector("#creatorLabEntryStatus");
        const creatorEntryPill=document.querySelector("#creatorLabEntryPill");
        const creatorEntryLeagueName=document.querySelector("#creatorLabEntryLeagueName");
        const admin=await b.isPlatformAdmin().catch(()=>false);
        if(creatorEntry)creatorEntry.hidden=!admin;
        if(creatorButton&&admin){
          let activeMock=null;
          let mockRun=null;
          try{
            const leagues=await b.listLeagues();
            activeMock=leagues.find(l=>isSimulationLeague(l))||null;
            if(activeMock?.id)mockRun=await b.getMockSimulation(activeMock.id).catch(()=>null);
          }catch{}
          if(activeMock){
            creatorLabResumeCache={league:activeMock,snapshot:mockRun,storedAt:Date.now()};
            const runStatus=String(mockRun?.run?.status||"");
            const leagueStatus=String(activeMock.status||"");
            creatorButton.textContent=runStatus==="running"
              ?"View Active Mock Matchup"
              :runStatus==="completed"||leagueStatus==="completed"
                ?"View Completed Mock League"
                :leagueStatus==="drafting"
                  ?"Return to Mock Draft"
                  :"View Active Mock League";
            if(creatorEntryStatus)creatorEntryStatus.hidden=false;
            if(creatorEntryLeagueName)creatorEntryLeagueName.textContent=activeMock.name||"Creator Mock Draft";
            if(creatorEntryPill){
              creatorEntryPill.textContent=runStatus==="running"?"LIVE":runStatus==="completed"||leagueStatus==="completed"?"COMPLETE":leagueStatus==="drafting"?"DRAFTING":"ACTIVE";
              creatorEntryPill.classList.toggle("live",runStatus==="running");
            }
          }else{
            creatorLabResumeCache=null;
            creatorButton.textContent="Open Mock Draft Simulator";
            if(creatorEntryStatus)creatorEntryStatus.hidden=true;
          }
          creatorButton.onclick=()=>{
            if(activeMock?.id)setActiveLeagueId(activeMock.id);
            render("creator-lab");
          };
        }
      }else{
        authCard.hidden=false;
        recoveryCard.hidden=true;
        signedInCard.hidden=true;
      }
    })();
    const email=document.querySelector("#authEmail");
    const password=document.querySelector("#authPassword");
    const resendVerifyBtn=document.querySelector("#resendVerifyBtn");
    setupVerificationResend(resendVerifyBtn,email);
    const busy=value=>{document.querySelector("#signInBtn").disabled=value;document.querySelector("#signUpBtn").disabled=value;};
    document.querySelector("#signInBtn").onclick=async()=>{
      if(!ready)return showToast("Cloud backend is not configured yet.");
      if(!email.checkValidity()||password.value.length<8)return showToast("Enter a valid email and password.");
      busy(true);
      try{await b.signIn(email.value.trim(),password.value);clearVerificationPending();showToast("Welcome back");render("home",{replace:true});}
      catch(err){showToast(err.message||"Sign-in failed");}
      finally{busy(false);}
    };
    document.querySelector("#signUpBtn").onclick=async()=>{
      if(!ready)return showToast("Cloud backend is not configured yet.");
      if(!email.checkValidity()||password.value.length<8)return showToast("Use a valid email and a password with at least 8 characters.");
      busy(true);
      try{
        const signupEmail=email.value.trim();
        const result=await b.signUp(signupEmail,password.value);
        if(result?.access_token){
          clearVerificationPending();
          showToast("Account created and signed in");
          render("home",{replace:true});
        }else{
          markVerificationPending(signupEmail);
          showToast("Account created. Check your email to verify it.");
          render("account",{replace:true});
        }
      }catch(err){showToast(err.message||"Account creation failed");}
      finally{busy(false);}
    };
    resendVerifyBtn.onclick=async()=>{
      if(!ready)return showToast("Cloud backend is not configured yet.");
      const value=email.value.trim();
      if(!email.checkValidity())return showToast("Enter the email address you used to create the account.");
      const btn=document.querySelector("#resendVerifyBtn");btn.disabled=true;
      try{
        await b.resendSignup(value);
        showToast("Verification email sent. Check your inbox.");
      }catch(err){
        const msg=String(err.message||"");
        showToast(/rate|limit|too many/i.test(msg)?"Email limit reached. Wait a little while before trying again.":msg||"Could not resend verification email.");
      }finally{setTimeout(()=>{btn.disabled=false;},3000);}
    };

    document.querySelector("#forgotPasswordBtn").onclick=async()=>{
      if(!ready)return showToast("Cloud backend is not configured yet.");
      const value=email.value.trim();
      if(!email.checkValidity())return showToast("Enter your email address first.");
      const btn=document.querySelector("#forgotPasswordBtn");btn.disabled=true;
      try{
        await b.requestPasswordReset(value);
        showToast("Password-reset email sent. Check your inbox.");
      }catch(err){
        const msg=String(err.message||"");
        showToast(/rate|limit|too many/i.test(msg)?"Email limit reached. Wait a little while before trying again.":msg||"Could not send password-reset email.");
      }finally{setTimeout(()=>{btn.disabled=false;},3000);}
    };

    const saveNewPasswordBtn=document.querySelector("#saveNewPasswordBtn");
    if(saveNewPasswordBtn)saveNewPasswordBtn.onclick=async()=>{
      const input=document.querySelector("#newPassword");
      if(input.value.length<8)return showToast("Use at least 8 characters.");
      saveNewPasswordBtn.disabled=true;
      try{
        await b.updatePassword(input.value);
        showToast("Password updated.");
        render("account",{replace:true});
      }catch(err){showToast(err.message||"Could not update password.");}
      finally{saveNewPasswordBtn.disabled=false;}
    };

    document.querySelector("#signOutBtn").onclick=async()=>{await b?.signOut?.();showToast("Signed out");render("login",{replace:true});};
  }
  if(view==="home"){
    const upcomingList=document.querySelector("#homeUpcomingMatches");
    const renderUpcoming=sourceRows=>{
      const rows=(sourceRows||[]).map(localScheduleRow).sort((a,b)=>{
        const ta=Date.parse(a.startTime||a.date||"");
        const tb=Date.parse(b.startTime||b.date||"");
        if(Number.isFinite(ta)&&Number.isFinite(tb))return ta-tb;
        return 0;
      });
      const upcoming=rows.filter(g=>g.day!=="past"&&!["CANCELED","POSTPONED"].includes(displayMatchStatus(g.status))).slice(0,3);
      if(!upcomingList)return;
      upcomingList.innerHTML=upcoming.length?upcoming.map(g=>`
        <div class="home-match-row">
          <div class="home-match-teams">
            <strong>${h(g.a||"TBD")} <span>vs</span> ${h(g.b||"TBD")}</strong>
            <small>${h(g.league||competitionName(g.competition)||"LoL Esports")}${g.stage?" · "+h(g.stage):""}</small>
          </div>
          <div class="home-match-time">
            <strong>${h(g.time||"TBD")}</strong>
            <small>${h(g.label||"Upcoming")}</small>
          </div>
        </div>`).join("")
        :'<div class="empty-state"><strong>No upcoming matches</strong><small>No future professional matches are currently available.</small></div>';
    };
    renderUpcoming(proSchedule);
    if(cloudReady()&&backend()?.listProMatches){
      void backend().listProMatches().then(matches=>{
        if(Array.isArray(matches)&&matches.length)renderUpcoming(matches.map(databaseMatchToSchedule));
      }).catch(()=>{});
    }

  }
  if(view==="team"){
    let completedLeagueView=false;
    const leagueId=getLeagueContextId();
    const leagueNameEl=document.querySelector("#teamLeagueName");
    const teamNameEl=document.querySelector("#myTeamName");
    const badge=document.querySelector("#teamSyncBadge");
    const noLeague=document.querySelector("#teamNoLeague");
    const starterList=document.querySelector("#starterRosterList");
    const flexList=document.querySelector("#flexRosterList");
    const benchList=document.querySelector("#benchRosterList");
    const rosterCount=document.querySelector("#teamRosterCount");
    const starterCount=document.querySelector("#teamStarterCount");
    const statusBanner=document.querySelector("#rosterStatusBanner");
    const statusTitle=document.querySelector("#rosterStatusTitle");
    const statusCopy=document.querySelector("#rosterStatusCopy");
    const rosterCards=document.querySelectorAll(".team-roster-card,.team-summary-card");
    const rosterHelpPopover=document.querySelector("#rosterHelpPopover");
    const rosterHelpTitle=document.querySelector("#rosterHelpTitle");
    const rosterHelpCopy=document.querySelector("#rosterHelpCopy");
    const rosterHelpText={
      flex:{
        title:"FLEX",
        copy:"FLEX is an extra starting slot. An eligible player can start here without replacing the normal starter at that player's role. FLEX players count toward your starting lineup."
      },
      bench:{
        title:"Bench",
        copy:"Bench players are on your fantasy roster but are not currently starting. They do not fill a starting slot until you move them into an eligible starting position or FLEX."
      }
    };
    let rosterHelpTimer=null;
    const hideRosterHelp=()=>{
      clearTimeout(rosterHelpTimer);
      if(rosterHelpPopover)rosterHelpPopover.hidden=true;
      document.querySelectorAll("[data-roster-help]").forEach(btn=>btn.setAttribute("aria-expanded","false"));
    };
    const showRosterHelp=(type,button)=>{
      const info=rosterHelpText[type];
      if(!info||!rosterHelpPopover)return;
      clearTimeout(rosterHelpTimer);
      rosterHelpTitle.textContent=info.title;
      rosterHelpCopy.textContent=info.copy;
      rosterHelpPopover.hidden=false;
      document.querySelectorAll("[data-roster-help]").forEach(btn=>btn.setAttribute("aria-expanded",String(btn===button)));
      const rect=button.getBoundingClientRect();
      const width=Math.min(300,window.innerWidth-32);
      rosterHelpPopover.style.width=width+"px";
      rosterHelpPopover.style.left=Math.max(16,Math.min(window.innerWidth-width-16,rect.left-width/2+rect.width/2))+"px";
      rosterHelpPopover.style.top=Math.min(window.innerHeight-rosterHelpPopover.offsetHeight-16,rect.bottom+8)+"px";
    };
    document.querySelectorAll("[data-roster-help]").forEach(btn=>{
      const type=btn.dataset.rosterHelp;
      btn.onclick=e=>{
        e.stopPropagation();
        if(!rosterHelpPopover?.hidden&&btn.getAttribute("aria-expanded")==="true")hideRosterHelp();
        else showRosterHelp(type,btn);
      };
      btn.addEventListener("mouseenter",()=>showRosterHelp(type,btn));
      btn.addEventListener("mouseleave",()=>{
        rosterHelpTimer=setTimeout(()=>hideRosterHelp(),120);
      });
      btn.addEventListener("focus",()=>showRosterHelp(type,btn));
      btn.addEventListener("blur",()=>hideRosterHelp());
    });
    rosterHelpPopover?.addEventListener("mouseenter",()=>clearTimeout(rosterHelpTimer));
    rosterHelpPopover?.addEventListener("mouseleave",()=>hideRosterHelp());
    document.addEventListener("click",e=>{
      if(!e.target.closest?.("[data-roster-help]")&&!e.target.closest?.("#rosterHelpPopover"))hideRosterHelp();
    });

    let rosterMovesEnabled=false;
    let leagueCompleted=false;
    let historicalRosterOverride=null;
    let activeLineupLocks=new Map();
    const refreshTeam=()=>render("team",{replace:true});

    const bindRosterActions=()=>{
      document.querySelectorAll("[data-bench-roster]").forEach(btn=>btn.onclick=()=>{
        if(!rosterMovesEnabled)return showToast("Lineup changes unlock after the draft.");
        const currentNow=getUserRoster();
        const player=currentNow.find(p=>playerKey(p)===btn.dataset.benchRoster);
        if(!player)return;
        const slot=player.slot||player.role;
        const candidates=currentNow.filter(p=>{
          if((p.slot||p.role)!=="BN")return false;
          if(activeLineupLocks.has(playerKey(p)))return false;
          return slot==="FLEX"?isFlexEligible(p):playerPosition(p)===slot;
        });
        if(!candidates.length)return showToast(`No eligible unlocked bench player can replace ${player.name} in ${slot}.`);
        openBenchReplacementChooser(player,currentNow,candidates,refreshTeam);
      });

      document.querySelectorAll("[data-start-roster]").forEach(btn=>btn.onclick=async()=>{
        if(!rosterMovesEnabled)return showToast("Lineup changes unlock after the draft.");
        const currentNow=getUserRoster();
        const player=currentNow.find(p=>playerKey(p)===btn.dataset.startRoster);
        const position=playerPosition(player);
        if(!player||!position)return showToast("Player role is unavailable.");
        btn.disabled=true;

        const normalOccupied=currentNow.find(p=>(p.slot||p.role)===position);
        const flexOccupied=currentNow.find(p=>(p.slot||p.role)==="FLEX");
        let targetSlot=null;
        if(!normalOccupied)targetSlot=position;
        else if(!flexOccupied&&isFlexEligible(player))targetSlot="FLEX";

        if(targetSlot){
          const next=currentNow.map(p=>playerKey(p)===playerKey(player)?{...p,position,slot:targetSlot,role:position}:p);
          try{
            await saveUserRoster(next);
            showToast(`${player.name} moved into ${targetSlot}`);
            refreshTeam();
          }catch(err){showToast(err.message||"Could not update lineup");btn.disabled=false;}
          return;
        }

        const eligibleTargets=[];
        if(normalOccupied&&!activeLineupLocks.has(playerKey(normalOccupied)))eligibleTargets.push(normalOccupied);
        if(flexOccupied&&isFlexEligible(player)&&!activeLineupLocks.has(playerKey(flexOccupied)))eligibleTargets.push(flexOccupied);
        btn.disabled=false;
        if(!eligibleTargets.length)return showToast("No eligible unlocked starting slot is available.");
        openLineupSwapChooser(player,currentNow,eligibleTargets,refreshTeam);
      });
    };

    const drawRoster=()=>{
      const sourceRoster=Array.isArray(historicalRosterOverride)?historicalRosterOverride:getUserRoster();
      const current=sourceRoster.map(p=>({...p,lineupLock:activeLineupLocks.get(playerKey(p))||null}));
      const validation=validateRoster(current);
      const starters=current.filter(p=>ROSTER_RULES.starterSlots.includes(p.slot||p.role));
      const flex=current.filter(p=>(p.slot||p.role)==="FLEX");
      const bench=current.filter(p=>(p.slot||p.role)==="BN");
      rosterCount.textContent=`${current.length}/${validation.totalRequired}`;
      starterCount.textContent=`${starters.length+flex.length}/6`;

      statusBanner.classList.toggle("complete",leagueCompleted||validation.isComplete);
      statusBanner.classList.toggle("incomplete",!leagueCompleted&&!validation.isComplete);
      if(leagueCompleted){
        statusTitle.textContent="Season Complete";
        statusCopy.textContent="This league has ended. Final rosters are locked and read-only.";
      }else{
        statusTitle.textContent=validation.isComplete?"✓ Roster Complete":"⚠ Roster Incomplete";
        statusCopy.textContent=rosterStatusText(validation);
      }

      starterList.innerHTML=ROSTER_RULES.starterSlots.map(role=>{
        const p=starters.find(x=>(x.slot||x.role)===role);
        if(p)return rosterRow(p,rosterMovesEnabled);
        const hasRoleOnBench=bench.some(x=>playerPosition(x)===role);
        return `<div class="roster-slot empty-roster-slot"><span class="slot-label">${role}</span><div class="player-info"><strong>Empty ${role} slot</strong><small>${hasRoleOnBench?"A bench player can fill this spot":"No "+role+" player is on your roster"}</small></div></div>`;
      }).join("");

      flexList.innerHTML=flex.length
        ?rosterRow(flex[0],rosterMovesEnabled)
        :'<div class="roster-slot empty-roster-slot"><span class="slot-label">FLEX</span><div class="player-info"><strong>Empty FLEX slot</strong><small>Any eligible player can fill this spot.</small></div></div>';

      benchList.innerHTML=bench.length
        ?bench.map(p=>rosterRow(p,rosterMovesEnabled)).join("")
        :'<div class="empty-state"><strong>Bench is empty</strong><small>Add enough players to meet your league bench requirement.</small></div>';
      bindRosterActions();
    };

    if(!leagueId||!cloudReady()){
      rosterCards.forEach(el=>el.hidden=true);
      badge.hidden=true;
      noLeague.hidden=false;
      leagueNameEl.textContent="MY TEAM";
      teamNameEl.textContent="No active league";
    }else{
      noLeague.hidden=true;
      starterList.innerHTML='<div class="empty-state"><strong>Loading roster…</strong><small>Syncing your active league.</small></div>';
      if(flexList)flexList.innerHTML="";
      benchList.innerHTML="";
      (async()=>{
        try{
          const b=backend();
          const [user,leagues]=await Promise.all([
            b.currentUser(),
            b.listLeagues()
          ]);
          if(!user)throw new Error("Sign in to view your team.");
          const activeLeague=leagues.find(l=>String(l.id)===String(leagueId));
          const members=await b.listLeagueMembers(leagueId);
          const membership=members.find(m=>String(m.user_id)===String(user.id));
          if(!membership)throw new Error("You are not a member of this league.");

          leagueNameEl.textContent=String(activeLeague?.name||"Active League").toUpperCase();
          teamNameEl.textContent=membership.team_name||"My Team";
          const renameBtn=document.querySelector("#renameTeamBtn");
          const editor=document.querySelector("#teamNameEditor");
          const nameInput=document.querySelector("#teamNameInput");
          const saveNameBtn=document.querySelector("#saveTeamNameBtn");
          const cancelNameBtn=document.querySelector("#cancelTeamNameBtn");
          nameInput.value=membership.team_name||"";
          renameBtn.onclick=()=>{editor.hidden=false;nameInput.focus();};
          cancelNameBtn.onclick=()=>{editor.hidden=true;nameInput.value=membership.team_name||"";};
          saveNameBtn.onclick=async()=>{
            const nextName=nameInput.value.trim();
            if(!nextName)return showToast("Enter a team name.");
            saveNameBtn.disabled=true;
            try{
              await b.updateTeamName(leagueId,nextName);
              membership.team_name=nextName;
              teamNameEl.textContent=nextName;
              editor.hidden=true;
              showToast("Team name updated");
            }catch(err){showToast(err.message||"Could not update team name");}
            finally{saveNameBtn.disabled=false;}
          };
          const teamPlayoffs=await b.listPlayoffs(leagueId).catch(()=>[]);
          const teamLifecycle=leagueLifecycleConfig(activeLeague,{playoffs:teamPlayoffs});
          const teamLeagueStatus=teamLifecycle.state;
          badge.textContent=teamLifecycle.readOnly?"READ ONLY":teamLifecycle.label.toUpperCase();
          badge.hidden=false;
          leagueCompleted=teamLifecycle.readOnly;
          rosterMovesEnabled=teamLifecycle.canManageRoster;

          if(leagueCompleted){
            leagueNameEl.textContent="FINAL ROSTERS · "+String(activeLeague?.name||"League").toUpperCase();
            renameBtn.hidden=true;
            editor.hidden=true;
            const addPlayersBtn=document.querySelector('.team-screen [data-jump="players"]');
            if(addPlayersBtn)addPlayersBtn.hidden=true;
            const nextLockRow=document.querySelector("#teamNextLockRow");
            const lockStatusRow=document.querySelector("#teamLockStatusRow");
            if(nextLockRow)nextLockRow.hidden=true;
            if(lockStatusRow)lockStatusRow.hidden=true;

            const finalRosterManagerCard=document.querySelector("#finalRosterManagerCard");
            const finalRosterManagerSelect=document.querySelector("#finalRosterManagerSelect");
            const [bots,allRosterRows]=await Promise.all([
              b.listLeagueBots(leagueId).catch(()=>[]),
              b.listRosters(leagueId).catch(()=>[])
            ]);
            const rosterManagers=[
              ...members.map(m=>({id:String(m.user_id),type:"human",team_name:m.team_name||"Unnamed Team"})),
              ...bots.map(bot=>({id:String(bot.id),type:"bot",team_name:bot.team_name||"Bot Team"}))
            ];
            const sourcePlayers=allFantasyPlayers();
            const rosterForManager=manager=>{
              const rows=(allRosterRows||[]).filter(r=>String(r.user_id)===String(manager.id));
              return rows.map(row=>{
                const player=sourcePlayers.find(p=>playerKey(p)===String(row.player_id)||String(p.id||"")===String(row.player_id));
                const slot=String(row.slot||"BN").toUpperCase();
                const fallbackPosition=ROSTER_RULES.starterSlots.includes(slot)?slot:"";
                return player
                  ?{...player,id:playerKey(player),position:playerPosition(player)||fallbackPosition,slot,role:slot==="BN"?"BN":(playerPosition(player)||fallbackPosition)}
                  :{id:String(row.player_id),name:String(row.player_id),team:"",position:fallbackPosition,slot,role:slot==="BN"?"BN":fallbackPosition};
              });
            };
            const applyHistoricalRoster=manager=>{
              historicalRosterOverride=rosterForManager(manager);
              teamNameEl.textContent=manager.team_name+(manager.type==="human"&&String(manager.id)===String(user.id)?" · You":"");
              drawRoster();
            };

            if(finalRosterManagerCard&&finalRosterManagerSelect){
              finalRosterManagerCard.hidden=false;
              finalRosterManagerSelect.innerHTML=rosterManagers.map(manager=>`<option value="${h(manager.type+":"+manager.id)}">${h(manager.team_name)}${manager.type==="human"&&String(manager.id)===String(user.id)?" · You":manager.type==="bot"?" · Bot":""}</option>`).join("");
              const mineKey="human:"+String(user.id);
              if(rosterManagers.some(manager=>manager.type+":"+manager.id===mineKey))finalRosterManagerSelect.value=mineKey;
              const selectedManager=rosterManagers.find(manager=>manager.type+":"+manager.id===finalRosterManagerSelect.value)||rosterManagers[0];
              if(selectedManager)applyHistoricalRoster(selectedManager);
              else{
                historicalRosterOverride=[];
                teamNameEl.textContent="No final rosters";
              }
              finalRosterManagerSelect.onchange=()=>{
                const selected=rosterManagers.find(manager=>manager.type+":"+manager.id===finalRosterManagerSelect.value);
                if(selected)applyHistoricalRoster(selected);
              };
            }
          }else{
            renameBtn.hidden=false;
          }

          document.querySelectorAll('.team-screen [data-jump="players"],.team-screen [data-jump="transactions"]').forEach(el=>{
            if(el.dataset.jump==="players"){
              el.disabled=!rosterMovesEnabled;
              el.title=rosterMovesEnabled?"":"Players can be added after the league draft.";
            }
          });

          if(!leagueCompleted)await loadRosterFromCloud(leagueId);
          const rounds=await b.listFantasyRounds(leagueId);
          const activeRound=rounds.find(r=>r.status==="live");
          const nextUpcomingRound=rounds
            .filter(r=>r.status==="upcoming"&&Date.parse(r.starts_at||"")>Date.now())
            .sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at))[0]||null;
          const lockRound=activeRound||nextUpcomingRound;
          const competition=normalizeCompetitionCode(activeLeague?.settings?.competition)||"worlds";
          const [statusRows,lockRoundMatches]=await Promise.all([
            b.listPlayerCompetitionStatus(competition).catch(()=>[]),
            lockRound
              ?b.listProMatches(competition,lockRound.starts_at,lockRound.ends_at).catch(()=>[])
              :Promise.resolve([])
          ]);
          activeLineupLocks=new Map();
          if(activeRound){
            const locks=await b.listLineupLocks(leagueId,activeRound.round_number);
            locks
              .filter(lock=>String(lock.manager_id)===String(user.id)&&String(lock.manager_type)==="human")
              .forEach(lock=>activeLineupLocks.set(String(lock.player_id),lock));
          }
          const rosterNow=getUserRoster();
          const rosterIds=new Set(rosterNow.map(playerKey));
          cacheCompetitionStatuses(competition,statusRows);
          const relevantStatus=statusRows.filter(x=>rosterIds.has(String(x.player_id)));
          const statusByPlayer=new Map(relevantStatus.map(row=>[String(row.player_id),row]));
          const unavailableRostered=rosterNow.map(player=>{
            const row=statusByPlayer.get(playerKey(player));
            return row&&String(row.status)==="starter"?null:{
              player,
              status:row?.status||"unknown"
            };
          }).filter(Boolean);
          const availabilityBanner=document.querySelector("#teamAvailabilityBanner");
          const availabilityCopy=document.querySelector("#teamAvailabilityCopy");
          if(availabilityBanner&&availabilityCopy){
            availabilityBanner.hidden=unavailableRostered.length===0;
            if(unavailableRostered.length){
              availabilityCopy.textContent=unavailableRostered.map(item=>{
                return item.player.name+" · "+playerAvailabilityLabel(item.status);
              }).join(" · ");
            }else{
              availabilityCopy.textContent="";
            }
          }
          const nextLock=rosterNow
            .filter(player=>!activeLineupLocks.has(playerKey(player)))
            .flatMap(player=>(lockRoundMatches||[])
              .filter(match=>{
                const start=Date.parse(match.start_time||"");
                const status=String(match.status||"").toUpperCase();
                return Number.isFinite(start)
                  &&start>Date.now()
                  &&!["CANCELED","CANCELLED","POSTPONED"].includes(status)
                  &&playerMatchesProMatch(player,match);
              })
              .map(match=>({player,match,_lockTime:Date.parse(match.start_time)})))
            .sort((a,b)=>a._lockTime-b._lockTime)[0]||null;
          const nextLockEl=document.querySelector("#teamNextLock");
          const lockStatusEl=document.querySelector("#teamLockStatus");
          if(nextLockEl){
            if(nextLock){
              const when=new Date(nextLock._lockTime).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
              nextLockEl.textContent=when+" · "+nextLock.player.name;
              nextLockEl.title="Locks at the official professional match start time.";
            }else{
              nextLockEl.textContent="No upcoming lock";
              nextLockEl.title="";
            }
          }
          if(lockStatusEl){
            const lockedCount=rosterNow.filter(p=>activeLineupLocks.has(playerKey(p))).length;
            lockStatusEl.textContent=lockedCount+" locked · "+Math.max(0,rosterNow.length-lockedCount)+" unlocked";
          }
          drawRoster();
        }catch(err){
          badge.hidden=true;
          starterList.innerHTML='<div class="empty-state cloud-error"><strong>Could not load your team</strong><small>'+h(err.message||"Please try again.")+'</small></div>';
          if(flexList)flexList.innerHTML="";
          benchList.innerHTML="";
        }
      })();
    }
  }
  if(view==="player"){
    const p=playerById(selectedPlayerId) || allFantasyPlayers()[0];
    if(!p){ render("players"); return; }
    selectedPlayerId=p.id||selectedPlayerId;
    const profileImage=document.querySelector("#profileImage");
    const playerImage=p.image||p.imageUrl||p.photo||"";
    if(profileImage){
      profileImage.hidden=!playerImage;
      if(playerImage){
        profileImage.src=playerImage;
        profileImage.alt=`${p.name||"Player"} profile photo`;
      }
    }
    document.querySelector("#profileRole").textContent=p.role||"—";
    document.querySelector("#profileTeam").textContent=p.team||"Unknown team";
    document.querySelector("#profileName").textContent=p.name||"Player";
    document.querySelector("#profileRank").textContent=p.rank?`Player pool rank #${p.rank}`:"Player profile";
    const owned=isOwned(p);
    document.querySelector("#profileStatus").textContent=owned?"On your roster":"Available";
    const chain=chainPlayerStats(p);
    const scoring=getLeagueSettings()?.scoring||defaultLeagueSettings.scoring;
    document.querySelector("#profileProjection").textContent=Number.isFinite(Number(chain?.kda))?Number(chain.kda).toFixed(2):"—";

    const outlookByRole={
      TOP:"Top laners gain value through steady scoring, matchup stability, and strong team win equity.",
      JNG:"Junglers can create fantasy spikes through kills, assists, objectives, and high map involvement.",
      MID:"Mid laners often combine strong kill participation with reliable farm, giving them a high fantasy ceiling.",
      ADC:"AD carries can produce some of the biggest fantasy totals when their team plays through late-game damage and kills.",
      SUP:"Supports usually rely on assists, vision, and team success, making them valuable when attached to winning teams."
    };
    const formText=chain?.games?` ChainCC tracks ${chain.games} games this season at a ${chain.winRate}% win rate with a ${chain.kda??"—"} KDA.`:"";
    document.querySelector("#profileOutlook").textContent=`${p.name} is a ${p.role} for ${p.team}. ${outlookByRole[p.role]||"Fantasy value depends on role, team performance, and match volume."}${formText}`;

    const statValue=(value,suffix="")=>Number.isFinite(Number(value))?`${Number(value).toFixed(Number(value)%1?1:0)}${suffix}`:"—";
    const stats=chain?[
      ["Games",chain.games??"—"],
      ["Win rate",statValue(chain.winRate,"%")],
      ["KDA",chain.kda??"—"],
      ["CS / min",chain.avgCspm??"—"],
      ["Damage / min",chain.avgDpm??"—"],
      ["Kill participation",Number.isFinite(Number(chain.avgKp))?`${chain.avgKp}%`:"—"]
    ]:[
      ["Role",p.role||"—"],
      ["Team",p.teamCode||String(p.team||"").slice(0,4).toUpperCase()],
      ["Player pool",p.rank?"#"+p.rank:"—"]
    ];
    document.querySelector("#profileStats").innerHTML=stats.map(s=>`<div class="profile-stat"><small>${h(s[0])}</small><strong>${h(s[1])}</strong></div>`).join("");
    const note=document.querySelector("#profileDataNote");
    if(note)note.textContent=chain?`2026 professional match summary from ChainCC. Recent match history is shown below when available.`:"No ChainCC profile data matched this player yet.";

    const teamName=String(p.team||"").toLowerCase();
    const teamCode=String(p.teamCode||"").toLowerCase();
    const matches=proSchedule.map(localScheduleRow).filter(g=>{
      const a=`${g.a||""} ${g.aCode||""}`.toLowerCase();
      const b=`${g.b||""} ${g.bCode||""}`.toLowerCase();
      return (teamName&&((a.includes(teamName)||b.includes(teamName)))) || (teamCode&&((a.includes(teamCode)||b.includes(teamCode))));
    }).slice(0,3);
    document.querySelector("#profileMatches").innerHTML=matches.length?matches.map(g=>{
      const opponent=(String(g.a||"").toLowerCase().includes(teamName)||String(g.aCode||"").toLowerCase()===teamCode)?g.b:g.a;
      return `<div class="profile-match"><div><strong>vs ${h(opponent||"TBD")}</strong><small>${h(g.league||"")} · ${h(g.stage||"")}</small></div><div><strong>${h(g.time||"TBD")}</strong><small>${h(g.label||"")}</small></div></div>`;
    }).join(""):'<div class="empty-state"><strong>No upcoming match found</strong><small>The schedule will populate automatically when a matching event is available.</small></div>';

    const recentGames=(chain?.recent||[]).slice(0,5);
    document.querySelector("#profileTrend").innerHTML=recentGames.length?recentGames.map(g=>{
      const fp=fantasyPointsForGame(g,scoring);
      const result=g.win===true?"W":g.win===false?"L":"—";
      const date=g.date?new Date(g.date+"T12:00:00Z"):null;
      const dateText=date&&!Number.isNaN(date.getTime())?date.toLocaleDateString([], {month:"short",day:"numeric"}):"";
      const hasKda=[g.kills,g.deaths,g.assists].every(Number.isFinite);
      const kda=hasKda?`${g.kills}/${g.deaths}/${g.assists}`:"";
      return `<div class="recent-game-row"><span class="recent-result ${result==="W"?"win":result==="L"?"loss":""}">${result}</span><div class="recent-game-main"><strong>${h(g.champion||"Match")}${kda?" · "+h(kda):""}</strong><small>${h(g.opponent?"vs "+g.opponent:(g.league||"Pro match"))}${dateText?" · "+h(dateText):""}</small></div>${Number.isFinite(fp)?`<div class="recent-fp"><strong>${h(fp.toFixed(1))}</strong><small>FP</small></div>`:""}</div>`;
    }).join(""):'<div class="empty-state"><strong>No recent ChainCC matches found</strong><small>This player may not have a matching 2026 game record yet.</small></div>';

    const watch=watchlistIds();
    const watchBtn=document.querySelector("#watchPlayerBtn");
    const watchId=playerKey(p);
    const syncWatch=()=>{const active=watch.has(watchId);watchBtn.classList.toggle("watching",active);watchBtn.textContent=active?"★ Watching":"☆ Watchlist";};
    syncWatch();
    watchBtn.onclick=()=>{watch.has(watchId)?watch.delete(watchId):watch.add(watchId);setWatchlist(watch);syncWatch();showToast(watch.has(watchId)?"Added to watchlist":"Removed from watchlist");};
    const addBtn=document.querySelector("#profileAddBtn");
    if(owned){
      addBtn.textContent="On My Team";
      addBtn.classList.add("owned");
      addBtn.disabled=true;
    }else{
      addBtn.textContent=getUserRoster().length>=rosterLimit()?"Add / Choose Drop":"Add Player";
      addBtn.onclick=()=>addPlayerToRoster(p);
    }
    const waiverBtn=document.querySelector("#profileWaiverBtn");
    const tradeBtn=document.querySelector("#profileTradeBtn");
    const configureLeagueActions=async()=>{
      const leagueId=getActiveLeagueId();
      if(!leagueId||!cloudReady()){
        addBtn.disabled=true;
        addBtn.textContent="Join a League";
        waiverBtn.disabled=true;
        tradeBtn.disabled=true;
        return;
      }
      try{
        const b=backend();
        const [user,rosters,leagues,statusRows,projectionRows,rounds]=await Promise.all([
          b.currentUser(),b.listRosters(leagueId),b.listLeagues(),
          b.listPlayerCompetitionStatus().catch(()=>[]),
          b.listPlayerProjections(leagueId).catch(()=>[]),
          b.listFantasyRounds(leagueId).catch(()=>[])
        ]);
        const league=leagues.find(l=>String(l.id)===String(leagueId));
        const leagueCompetition=normalizeCompetitionCode(league?.settings?.competition)||"worlds";
        const waiversEnabled=league?.settings?.waivers!==false;
        const leagueStatusRows=statusRows.filter(x=>normalizeCompetitionCode(x.competition)===leagueCompetition);
        cacheCompetitionStatuses(leagueCompetition,leagueStatusRows);
        const playerStatus=leagueStatusRows.find(x=>String(x.player_id)===playerKey(p));
        const currentRound=rounds.find(r=>r.status==="live")||rounds.find(r=>r.status==="upcoming");
        const projection=projectionRows.find(x=>String(x.player_id)===playerKey(p)&&(!currentRound||Number(x.round_number)===Number(currentRound.round_number)));
        const availability=document.querySelector("#profileAvailability");
        if(availability)availability.textContent=String(playerStatus?.status||"unknown").replaceAll("_"," ").toUpperCase();
        const projected=document.querySelector("#profileProjectedFp");
        const expected=document.querySelector("#profileExpectedGames");
        const recent=document.querySelector("#profileRecentFp");
        const nextMatch=document.querySelector("#profileNextMatch");
        if(projected)projected.textContent=projection?formatFantasyPoints(projection.projected_fp):"—";
        if(expected)expected.textContent=projection?String(projection.expected_games):String(playerStatus?.remaining_matches??"—");
        if(recent)recent.textContent=projection?formatFantasyPoints(projection.recent_avg_fp):"—";
        if(nextMatch){const d=playerStatus?.next_match_at?new Date(playerStatus.next_match_at):null;nextMatch.textContent=d&&!Number.isNaN(d.getTime())?d.toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"—";}
        const ownership=rosters.find(r=>String(r.player_id)===playerKey(p));
        const mine=ownership&&String(ownership.user_id)===String(user?.id);
        const other=ownership&&!mine;
        const eligible=playerEligibleForCompetition(p,leagueCompetition);
        const draftable=playerIsDraftable(p);
        const mockDraftContext=league?.settings?.simulation===true
          && selectedPlayerReturnView==="draft"
          && league?.status==="drafting";
        const mockEligible=mockDraftContext
          ?playerExplicitlyEligibleForCompetition(p,leagueCompetition)
          :false;
        const acquisitionAvailable=mockDraftContext
          ?(mockEligible&&draftable)
          :playerAvailableForAcquisition(p,leagueCompetition);

        if(mockDraftContext){
          if(availability)availability.textContent=acquisitionAvailable?"MOCK DRAFT ELIGIBLE":"NOT ELIGIBLE";
          if(expected)expected.textContent="SIM";
          if(nextMatch)nextMatch.textContent="Simulated game";
          document.querySelector("#profileStatus").textContent=acquisitionAvailable
            ?"Eligible for mock draft"
            :!mockEligible
              ?`Not eligible for ${competitionName(leagueCompetition)}`
              :"Not currently draftable";

          waiverBtn.hidden=true;
          tradeBtn.hidden=true;
          addBtn.disabled=!acquisitionAvailable;
          addBtn.textContent=acquisitionAvailable?"Draft Player":"Not Eligible";
          addBtn.onclick=acquisitionAvailable?async()=>{
            addBtn.disabled=true;
            try{
              await b.makeDraftPick(leagueId,p.id,p.role);
              showToast(p.name+" drafted");
              render("draft",{replace:true});
            }catch(err){
              showToast(err.message||"Could not make draft pick");
              addBtn.disabled=false;
            }
          }:null;
          return;
        }

        document.querySelector("#profileStatus").textContent=mine
          ?"On your roster"
          :other
            ?"Rostered by another manager"
            :!eligible
              ?`Not eligible for ${competitionName(leagueCompetition)}`
              :!draftable
                ?"Reserve · Not currently draftable"
                :acquisitionAvailable
                  ?"Available"
                  :playerAvailabilityLabel(playerStatus?.status);
        if((!eligible||!draftable||!acquisitionAvailable)&&!mine&&!other){
          const unavailableLabel=!eligible?"Not Eligible":!draftable?"Reserve":playerAvailabilityLabel(playerStatus?.status);
          addBtn.disabled=true;
          addBtn.textContent=unavailableLabel;
          waiverBtn.disabled=true;
          waiverBtn.textContent=unavailableLabel;
          tradeBtn.disabled=true;
          return;
        }

        if(league?.status!=="active"){
          addBtn.disabled=true;
          addBtn.textContent=league?.status==="drafting"?"Draft In Progress":"Roster Locked";
          waiverBtn.disabled=true;
          tradeBtn.disabled=true;
          return;
        }

        if(mine){
          addBtn.textContent="On My Team";
          addBtn.classList.add("owned");
          addBtn.disabled=true;
          waiverBtn.textContent="Already Owned";
          waiverBtn.disabled=true;
          tradeBtn.disabled=false;
          tradeBtn.onclick=()=>{tradePrefill={id:playerKey(p),side:"mine"};render("trade");};
        }else if(other){
          addBtn.textContent="Rostered";
          addBtn.disabled=true;
          waiverBtn.textContent="Rostered";
          waiverBtn.disabled=true;
          tradeBtn.disabled=false;
          tradeBtn.onclick=()=>{tradePrefill={id:playerKey(p),side:"theirs"};render("trade");};
        }else{
          tradeBtn.disabled=true;
          if(waiversEnabled){
            addBtn.disabled=true;
            addBtn.textContent="Use Waiver Claim";
            addBtn.onclick=null;
            waiverBtn.disabled=false;
            waiverBtn.textContent="Waiver Claim";
            waiverBtn.onclick=async()=>{
              waiverBtn.disabled=true;
              await createWaiverClaim(p);
              waiverBtn.disabled=false;
            };
          }else{
            addBtn.disabled=false;
            addBtn.textContent=getUserRoster().length>=rosterLimit()?"Add / Choose Drop":"Add Player";
            addBtn.onclick=()=>addPlayerToRoster(p);
            waiverBtn.disabled=true;
            waiverBtn.textContent="Waivers Off";
            waiverBtn.onclick=null;
          }
        }
      }catch(err){
        addBtn.disabled=true;
        waiverBtn.disabled=true;
        tradeBtn.disabled=true;
      }
    };
    void configureLeagueActions();
    const playerBackBtn=document.querySelector("#playerBackBtn");
    const returnLabels={draft:"Draft Room",team:"My Team",trade:"Trades",transactions:"Transactions",league:"League",players:"Players"};
    const returnView=returnLabels[selectedPlayerReturnView]?selectedPlayerReturnView:"players";
    playerBackBtn.textContent="← "+(returnLabels[returnView]||"Players");
    playerBackBtn.onclick=()=>render(returnView,{replace:true});
  }
  if(view==="standings"){
    const list=document.querySelector("#standingsList");
    const leagueId=getLeagueContextId();
    const status=document.querySelector("#standingsStatus");
    if(!leagueId||!cloudReady()){
      list.innerHTML='<div class="empty-state"><strong>No active league</strong><small>Select a league before viewing standings.</small><button class="primary-btn" data-jump="league">Go to League</button></div>';
      if(status)status.textContent="OFFLINE";
    }else{
      (async()=>{
        try{
          const b=backend();
          const [members,bots,leagues,user,standings,rounds]=await Promise.all([
            b.listLeagueMembers(leagueId),
            b.listLeagueBots(leagueId),
            b.listLeagues(),
            b.currentUser(),
            b.listLeagueStandings(leagueId),
            b.listFantasyRounds(leagueId)
          ]);
          const league=leagues.find(l=>String(l.id)===String(leagueId));
          const name=document.querySelector("#standingsLeagueName");
          const pageTitle=document.querySelector("#standingsPageTitle");
          const seasonPill=document.querySelector(".standings-season-pill");
          if(name)name.textContent=String(league?.name||"League").toUpperCase();
          if(league?.status==="completed"){
            if(pageTitle)pageTitle.textContent="Final Standings";
            if(seasonPill)seasonPill.textContent="READ ONLY";
          }

          const managerNames=new Map();
          members.forEach(m=>managerNames.set("human:"+String(m.user_id),m));
          bots.forEach(bot=>managerNames.set("bot:"+String(bot.id),bot));

          const currentRound=rounds.find(r=>r.status==="live");
          if(status){
            status.textContent=currentRound?"ROUND "+currentRound.round_number+" LIVE":"OFFICIAL";
            status.classList.toggle("live",!!currentRound);
          }

          const rows=(standings||[]).map(s=>{
            const manager=managerNames.get(String(s.manager_type)+":"+String(s.manager_id))||{};
            const mine=s.manager_type==="human"&&String(s.manager_id)===String(user?.id);
            const isBot=s.manager_type==="bot";
            const record=`${Number(s.wins)||0}-${Number(s.losses)||0}-${Number(s.ties)||0}`;
            const games=Number(s.completed_matchups)||0;
            const pct=games?((Number(s.wins)+(Number(s.ties)||0)*0.5)/games):0;
            return {...s,manager,mine,isBot,record,pct};
          });

          list.innerHTML=rows.length?rows.map(s=>{
            const detail=s.isBot?"Bot":(s.manager.role==="owner"?"Commissioner":"Manager");
            const teamName=String(s.manager.team_name||"Unnamed Team");
            const initials=teamName.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join("").toUpperCase()||"RF";
            return `<div class="standing-live-row real-standings-row ${s.mine?"mine":""} ${s.isBot?"bot-manager-row":""}">
              <span class="rank">${Number(s.rank)||"—"}</span>
              <div class="standing-team-avatar" aria-hidden="true">${h(initials)}</div>
              <div class="standing-live-team">
                <strong>${h(teamName)}</strong>
                <small>${h(detail)}${s.mine?'<b class="standings-you"> · You</b>':""}</small>
              </div>
              <div class="standing-live-record">
                <strong>${h(s.record)}</strong>
              </div>
              <div class="standing-stat-cell standings-pf"><strong>${formatFantasyPoints(s.points_for)}</strong></div>
              <div class="standing-stat-cell standings-pa"><strong>${formatFantasyPoints(s.points_against)}</strong></div>
              <div class="standing-stat-cell standings-bye"><strong>${Number(s.byes)||0}</strong></div>
            </div>`;
          }).join(""):(league?.status==="completed"
            ?'<div class="empty-state"><strong>No fantasy scoring periods were played</strong><small>This league ended before standings could be created.</small></div>'
            :'<div class="empty-state"><strong>No standings yet</strong><small>Standings are created automatically after the league draft.</small></div>');
        }catch(err){
          if(status)status.textContent="ERROR";
          list.innerHTML='<div class="empty-state"><strong>Could not load standings</strong><small>'+h(err.message||"Try again later.")+'</small></div>';
        }
      })();
    }
  }
  if(view==="matchup"){
    const leagueId=getLeagueContextId();
    const board=document.querySelector("#matchupScoreList");
    const leagueTitle=document.querySelector("#matchupLeagueName");
    const eyebrow=document.querySelector("#matchupLeagueEyebrow");
    const roundStatus=document.querySelector("#matchupRoundStatus");
    const roundLabel=document.querySelector("#matchupRoundLabel");
    const roundDates=document.querySelector("#matchupRoundDates");
    const prevBtn=document.querySelector("#matchupPrevRound");
    const nextBtn=document.querySelector("#matchupNextRound");

    const managerKey=(id,type)=>String(type||"human")+":"+String(id||"");
    const formatRoundDate=value=>{
      const d=new Date(value);
      return Number.isNaN(d.getTime())?"—":d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});
    };
    const teamMatchesPlayer=(player,match)=>{
      const playerTeamId=String(player?.teamId||player?.team_id||"");
      if(playerTeamId&&(playerTeamId===String(match?.team_a_id||"")||playerTeamId===String(match?.team_b_id||"")))return true;
      const pName=normalizeTeamKey(player?.team);
      const pCode=normalizeTeamKey(player?.teamCode);
      const teams=[
        normalizeTeamKey(match?.team_a_name),normalizeTeamKey(match?.team_a_code),
        normalizeTeamKey(match?.team_b_name),normalizeTeamKey(match?.team_b_code)
      ];
      return !!((pName&&teams.includes(pName))||(pCode&&teams.includes(pCode)));
    };
    const playerRoundState=(player,score,matches)=>{
      if(score?.delayed)return "DATA DELAYED";
      if(score?.live)return "LIVE";
      const related=matches.filter(m=>teamMatchesPlayer(player,m));
      const upcoming=related.some(m=>{
        const state=displayMatchStatus(m.status);
        return state==="UPCOMING"||Date.parse(m.start_time||"")>Date.now();
      });
      if(score?.games&&upcoming)return "MORE GAMES";
      if(upcoming)return "UPCOMING";
      if(score?.games)return "COMPLETE";
      return "NO GAME";
    };
    const lineupFor=(rosters,managerId,managerType,players,scoreMap,matches,lockMap)=>{
      const order={TOP:0,JNG:1,MID:2,ADC:3,SUP:4,FLEX:5};
      return rosters
        .filter(r=>String(r.user_id)===String(managerId)&&String(r.manager_type||"human")===String(managerType||"human")&&String(r.slot||"").toUpperCase()!=="BN")
        .sort((a,b)=>(order[String(a.slot).toUpperCase()]??99)-(order[String(b.slot).toUpperCase()]??99))
        .map(r=>{
          const player=players.find(p=>playerKey(p)===String(r.player_id)||String(p.id||"")===String(r.player_id))
            ||{id:r.player_id,name:r.player_id,team:"",role:r.slot};
          const score=scoreMap.get(String(r.player_id))||{total:0,live:false,games:0,breakdown:{}};
          return {roster:r,player,score,state:playerRoundState(player,score,matches),locked:lockMap.has(String(r.player_id))};
        });
    };
    const renderLineup=(label,name,items,total,isMine)=>{
      const remaining=items.filter(x=>["LIVE","DATA DELAYED","UPCOMING","MORE GAMES"].includes(x.state)).length;
      const complete=items.filter(x=>x.state==="COMPLETE").length;
      return `<section class="matchup-side ${isMine?"mine":""}">
        <div class="matchup-team-heading">
          <div><small>${h(label)}</small><strong>${h(name)}</strong></div>
          <div class="matchup-team-score"><strong>${formatFantasyPoints(total)}</strong><small>FP</small></div>
        </div>
        <div class="matchup-progress"><span>${complete} complete</span><span>${remaining} remaining</span></div>
        <div class="matchup-lineup">${items.length?items.map(({roster,player,score,state,locked})=>`
          <article class="matchup-player-row">
            <span class="role">${h(String(roster.slot||player.role||""))}</span>
            <div class="matchup-player-main"><strong>${h(player.name||roster.player_id)}</strong><small>${h(player.team||"")}</small></div>
            <div class="matchup-player-state"><span class="${state==="LIVE"?"live":state==="DATA DELAYED"?"data-delayed":""}">${locked?"🔒 ":""}${h(state)}</span><strong>${formatFantasyPoints(score.total)}</strong></div>
            ${score.games?renderFantasyBreakdown(score):""}
          </article>`).join(""):'<div class="empty-state"><strong>No starters</strong><small>This lineup is incomplete.</small></div>'}</div>
      </section>`;
    };

    if(!leagueId||!cloudReady()){
      board.innerHTML='<div class="empty-state"><strong>No active league</strong><small>Select a league before viewing head-to-head matchups.</small></div>';
      if(prevBtn)prevBtn.disabled=true;
      if(nextBtn)nextBtn.disabled=true;
    }else{
      (async()=>{
        try{
          const b=backend();
          const [user,leagues,rounds,members,bots,rosters,scores]=await Promise.all([
            b.currentUser(),b.listLeagues(),b.listFantasyRounds(leagueId),
            b.listLeagueMembers(leagueId),b.listLeagueBots(leagueId),
            b.listRosters(leagueId),b.listFantasyGameScores(leagueId)
          ]);
          const league=leagues.find(l=>String(l.id)===String(leagueId));
          if(leagueTitle)leagueTitle.textContent=league?.status==="completed"?"Matchup Results":String(league?.name||"Matchup");
          if(eyebrow)eyebrow.textContent=(league?.status==="completed"?"READ ONLY · ":"HEAD TO HEAD · ")+competitionName(league?.settings?.competition||"");

          if(!rounds.length){
            const compName=competitionName(league?.settings?.competition||"");
            board.innerHTML=league?.status==="completed"
              ?'<div class="empty-state"><strong>No fantasy scoring periods were played</strong><small>This completed league has no matchup results.</small></div>'
              :'<div class="empty-state"><strong>No active fantasy scoring period</strong><small>'+h(compName)+' has no scheduled matches after this league\'s draft. Rift Fantasy will create the next scoring period automatically when the pro schedule contains eligible matches.</small></div>';
            prevBtn.disabled=true;nextBtn.disabled=true;return;
          }

          const liveRound=rounds.find(r=>r.status==="live")||rounds.find(r=>r.status==="upcoming")||rounds.at(-1);
          if(!selectedMatchupRound||!rounds.some(r=>Number(r.round_number)===Number(selectedMatchupRound))){
            selectedMatchupRound=Number(liveRound.round_number);
          }
          const round=rounds.find(r=>Number(r.round_number)===Number(selectedMatchupRound))||liveRound;
          const roundIndex=rounds.findIndex(r=>Number(r.round_number)===Number(round.round_number));
          prevBtn.disabled=roundIndex<=0;
          nextBtn.disabled=roundIndex>=rounds.length-1;
          const roundRenderOptions=()=>historicalLeagueContextId
            ?{replace:true,historyLeagueId:leagueId}
            :{replace:true};
          prevBtn.onclick=()=>{if(roundIndex>0){selectedMatchupRound=Number(rounds[roundIndex-1].round_number);render("matchup",roundRenderOptions());}};
          nextBtn.onclick=()=>{if(roundIndex<rounds.length-1){selectedMatchupRound=Number(rounds[roundIndex+1].round_number);render("matchup",roundRenderOptions());}};

          roundLabel.textContent=round.label||((round.stage?round.stage+" · ":"")+"Round "+round.round_number);
          const roundEnded=Date.now()>=Date.parse(round.ends_at||"");
          const finalizing=round.status==="live"&&roundEnded;
          roundStatus.textContent=round.status==="final"
            ?"FINAL"
            :finalizing
              ?"FINALIZING STATS"
              :round.status==="live"
                ?"LIVE FANTASY PERIOD"
                :"UPCOMING";
          roundStatus.classList.toggle("live",round.status==="live"&&!finalizing);
          const matchText=Number(round.match_count)>0?" · "+Number(round.match_count)+" pro match"+(Number(round.match_count)===1?"":"es"):"";
          roundDates.textContent=formatRoundDate(round.starts_at)+" – "+formatRoundDate(new Date(Date.parse(round.ends_at)-1))+matchText;
          
          const [matchups,proMatches,lineupLocks,playoffs]=await Promise.all([
            b.listLeagueMatchups(leagueId,round.round_number),
            b.listProMatches(league?.settings?.competition||null,round.starts_at,round.ends_at),
            b.listLineupLocks(leagueId,round.round_number),
            b.listPlayoffs(leagueId).catch(()=>[])
          ]);
          const lockMap=new Map(lineupLocks.map(lock=>[
            String(lock.manager_type)+":"+String(lock.manager_id)+":"+String(lock.player_id),
            lock
          ]));
          const managerNames=new Map();
          members.forEach(m=>managerNames.set(managerKey(m.user_id,"human"),m.team_name||"Unnamed Team"));
          bots.forEach(m=>managerNames.set(managerKey(m.id,"bot"),m.team_name||"Bot Manager"));
          const source=allFantasyPlayers();

          if(String(league?.status||"")==="completed"&&historicalLeagueContextId){
            if(leagueTitle)leagueTitle.textContent="Season Results";
            if(eyebrow)eyebrow.textContent="READ ONLY · "+competitionName(league?.settings?.competition||"");

            const roundPlayoffs=(playoffs||[]).filter(p=>Number(p.round_number)===Number(round.round_number));
            if(roundPlayoffs.length){
              const playoffStage=roundPlayoffs.some(p=>String(p.stage)==="championship")?"CHAMPIONSHIP":"SEMIFINALS";
              roundStatus.textContent="FINAL · "+playoffStage;
              roundLabel.textContent=playoffStage==="CHAMPIONSHIP"?"Championship":"Semifinals";
            }else{
              roundStatus.textContent="FINAL";
            }
            roundStatus.classList.remove("live");

            const historicalRows=roundPlayoffs.length
              ?roundPlayoffs.map(p=>({
                  home_manager_id:p.home_manager_id,
                  home_manager_type:p.home_manager_type||"human",
                  away_manager_id:p.away_manager_id,
                  away_manager_type:p.away_manager_type||"human",
                  home_score:p.home_score,
                  away_score:p.away_score,
                  winner_manager_id:p.winner_manager_id,
                  result:p.winner_manager_id
                    ?(String(p.winner_manager_id)===String(p.home_manager_id)?"home_win":"away_win")
                    :"tie",
                  stage:p.stage,
                  bracket_slot:p.bracket_slot,
                  home_seed:p.home_seed,
                  away_seed:p.away_seed,
                  status:p.status
                }))
              :matchups;

            if(!historicalRows.length){
              board.innerHTML='<div class="empty-state"><strong>No results recorded</strong><small>No fantasy matchups were recorded for this round.</small></div>';
              return;
            }

            board.innerHTML='<div class="season-results-list">'+historicalRows.map((m,index)=>{
              const homeId=m.home_manager_id;
              const awayId=m.away_manager_id;
              const homeType=m.home_manager_type||"human";
              const awayType=m.away_manager_type||"human";
              const homeName=homeId?managerNames.get(managerKey(homeId,homeType))||"Home Team":"BYE";
              const awayName=awayId?managerNames.get(managerKey(awayId,awayType))||"Away Team":"BYE";
              const homeMine=String(homeId||"")===String(user?.id);
              const awayMine=String(awayId||"")===String(user?.id);
              const homeScore=Number(m.home_score);
              const awayScore=Number(m.away_score);
              const homeScoreText=Number.isFinite(homeScore)?formatFantasyPoints(homeScore):"—";
              const awayScoreText=Number.isFinite(awayScore)?formatFantasyPoints(awayScore):"—";
              const stageLabel=m.stage==="championship"
                ?"Championship"
                :m.stage==="semifinal"
                  ?"Semifinal"+(m.bracket_slot?" "+m.bracket_slot:"")
                  :"Matchup "+(index+1);
              let resultText="FINAL";
              if(!homeId||!awayId)resultText="BYE";
              else if(m.result==="home_win")resultText=homeName+" WINS";
              else if(m.result==="away_win")resultText=awayName+" WINS";
              else if(m.result==="tie")resultText="TIE";

              return `<article class="matchup-scoreboard season-result-card">
                <div class="${homeMine?"mine":""}">
                  <small>${h(m.home_seed?"SEED #"+m.home_seed:(homeMine?"YOU":"HOME"))}</small>
                  <strong>${h(homeName)}</strong>
                  <span>${h(homeScoreText)} FP</span>
                </div>
                <div class="matchup-versus">
                  <span>${h(stageLabel.toUpperCase())}</span>
                  <strong>${h(resultText)}</strong>
                </div>
                <div class="${awayMine?"mine":""}">
                  <small>${h(m.away_seed?"SEED #"+m.away_seed:(awayMine?"YOU":"AWAY"))}</small>
                  <strong>${h(awayName)}</strong>
                  <span>${h(awayScoreText)} FP</span>
                </div>
              </article>`;
            }).join("")+'</div>';
            return;
          }

          const myMatchup=matchups.find(m=>
            (String(m.home_manager_id||"")===String(user?.id))||
            (String(m.away_manager_id||"")===String(user?.id))
          );
          if(!myMatchup){
            board.innerHTML='<div class="empty-state"><strong>No matchup found</strong><small>Your team is not paired in this fantasy round.</small></div>';
            return;
          }

          const roundMatchIds=new Set(proMatches.map(m=>String(m.id)));
          const roundScores=scores.filter(s=>roundMatchIds.has(String(s.match_id)));
          const byPlayer=aggregateFantasyScores(roundScores);

          const homeId=myMatchup.home_manager_id;
          const awayId=myMatchup.away_manager_id;
          const homeType=myMatchup.home_manager_type;
          const awayType=myMatchup.away_manager_type;
          const homeName=homeId?managerNames.get(managerKey(homeId,homeType))||"Home Team":"BYE";
          const awayName=awayId?managerNames.get(managerKey(awayId,awayType))||"Away Team":"BYE";
          const homeMine=String(homeId||"")===String(user?.id);
          const awayMine=String(awayId||"")===String(user?.id);

          if(!homeId||!awayId){
            const myId=homeId||awayId;
            const myType=homeId?homeType:awayType;
            const myName=homeId?homeName:awayName;
            const lineup=lineupFor(rosters,myId,myType,source,byPlayer,proMatches,new Map(
              [...lockMap.entries()].filter(([key])=>key.startsWith(String(myType)+":"+String(myId)+":")).map(([key,value])=>[key.split(":").at(-1),value])
            ));
            const total=lineup.reduce((sum,x)=>sum+x.score.total,0);
            board.innerHTML=`<div class="matchup-bye-banner"><span>BYE WEEK</span><strong>No opponent this round</strong><small>Your lineup can still be viewed, but no head-to-head result is contested.</small></div>
              ${renderLineup("YOUR TEAM",myName,lineup,total,true)}`;
            return;
          }

          const homeLocks=new Map(lineupLocks
            .filter(lock=>String(lock.manager_id)===String(homeId)&&String(lock.manager_type)===String(homeType))
            .map(lock=>[String(lock.player_id),lock]));
          const awayLocks=new Map(lineupLocks
            .filter(lock=>String(lock.manager_id)===String(awayId)&&String(lock.manager_type)===String(awayType))
            .map(lock=>[String(lock.player_id),lock]));
          const homeLineup=lineupFor(rosters,homeId,homeType,source,byPlayer,proMatches,homeLocks);
          const awayLineup=lineupFor(rosters,awayId,awayType,source,byPlayer,proMatches,awayLocks);
          const homeTotal=homeLineup.reduce((sum,x)=>sum+x.score.total,0);
          const awayTotal=awayLineup.reduce((sum,x)=>sum+x.score.total,0);
          const resultLabel=myMatchup.result==="home_win"?"FINAL · "+homeName+" WINS":
            myMatchup.result==="away_win"?"FINAL · "+awayName+" WINS":
            myMatchup.result==="tie"?"FINAL · TIE":
            myMatchup.result==="live"?"LIVE":"UPCOMING";

          board.innerHTML=`<div class="matchup-scoreboard">
              <div class="${homeMine?"mine":""}"><small>${homeMine?"YOU":"HOME"}</small><strong>${h(homeName)}</strong><span>${formatFantasyPoints(homeTotal)} FP</span></div>
              <div class="matchup-versus"><span>${h(resultLabel)}</span><strong>VS</strong></div>
              <div class="${awayMine?"mine":""}"><small>${awayMine?"YOU":"AWAY"}</small><strong>${h(awayName)}</strong><span>${formatFantasyPoints(awayTotal)} FP</span></div>
            </div>
            <div class="matchup-lineups-grid">
              ${renderLineup(homeMine?"YOUR TEAM":"OPPONENT",homeName,homeLineup,homeTotal,homeMine)}
              ${renderLineup(awayMine?"YOUR TEAM":"OPPONENT",awayName,awayLineup,awayTotal,awayMine)}
            </div>`;
        }catch(err){
          board.innerHTML='<div class="empty-state"><strong>Could not load matchup</strong><small>'+h(err.message||"Try again later.")+'</small></div>';
        }
      })();
    }
  }
  if(view==="schedule"||view==="my-schedule"){
    const list=document.querySelector("#scheduleList");
    const rosterOnly=view==="my-schedule";
    let day="all";
    let rosterPlayers=[];
    let scheduleRows=proSchedule.filter(g=>!!scheduleCompetitionCode(g));
    let leagueCompetition=null;
    let leagueCompleted=false;
    const title=document.querySelector("#schedulePageTitle");
    const copy=document.querySelector("#scheduleScopeCopy");
    const fullBtn=document.querySelector("#fullScheduleBtn");
    const myBtn=document.querySelector("#myScheduleBtn");
    if(title)title.textContent=rosterOnly?"My Schedule":"Schedule";
    if(copy)copy.textContent=rosterOnly
      ?"Only matches involving teams represented by players on your current fantasy roster."
      :"All scheduled professional matches in the current feed.";
    if(fullBtn)fullBtn.classList.toggle("schedule-view-active",!rosterOnly);
    if(myBtn)myBtn.classList.toggle("schedule-view-active",rosterOnly);

    const normalizeTeam=value=>String(value||"").toLowerCase().replace(/[^a-z0-9]/g,"");
    const rosterMatchForTeam=(teamId,teamName,teamCode)=>{
      const idKey=String(teamId||"");
      const nameKey=normalizeTeam(teamName);
      const codeKey=normalizeTeam(teamCode);
      return rosterPlayers.filter(p=>{
        const playerTeamId=String(p.teamId||p.team_id||"");
        if(idKey&&playerTeamId&&idKey===playerTeamId)return true;
        const pName=normalizeTeam(p.team);
        const pCode=normalizeTeam(p.teamCode);
        return (nameKey&&(pName===nameKey||pCode===nameKey)) ||
               (codeKey&&(pName===codeKey||pCode===codeKey));
      });
    };
    const rosterMatchForPlayers=(players,teamId,teamName,teamCode)=>{
      const idKey=String(teamId||"");
      const nameKey=normalizeTeam(teamName);
      const codeKey=normalizeTeam(teamCode);
      return (players||[]).some(p=>{
        const playerTeamId=String(p.teamId||p.team_id||"");
        if(idKey&&playerTeamId&&idKey===playerTeamId)return true;
        const pName=normalizeTeam(p.team);
        const pCode=normalizeTeam(p.teamCode);
        return (nameKey&&(pName===nameKey||pCode===nameKey)) ||
               (codeKey&&(pName===codeKey||pCode===codeKey));
      });
    };

    const drawSchedule=()=>{
      const rows=scheduleRows.map(localScheduleRow).sort((a,b)=>{
        const ta=Date.parse(a.startTime||"");
        const tb=Date.parse(b.startTime||"");
        if(Number.isFinite(ta)&&Number.isFinite(tb))return ta-tb;
        return 0;
      });
      const filtered=rows.filter(g=>{
        const dayMatches=day==="all"||g.day===day||(day==="upcoming"&&g.day==="upcoming");
        if(!dayMatches)return false;
        if(leagueCompetition&&scheduleCompetitionCode(g)!==leagueCompetition)return false;
        if(!rosterOnly)return true;
        return rosterMatchForTeam(g.aId,g.a,g.aCode).length>0 || rosterMatchForTeam(g.bId,g.b,g.bCode).length>0;
      });
      let lastLabel="";
      list.innerHTML=filtered.length?filtered.map(g=>{
        const heading=g.label!==lastLabel ? `<div class="schedule-day">${h(g.label||"Upcoming")}</div>` : "";
        lastLabel=g.label;
        const aRoster=rosterMatchForTeam(g.aId,g.a,g.aCode);
        const bRoster=rosterMatchForTeam(g.bId,g.b,g.bCode);
        const aOwned=aRoster.length>0;
        const bOwned=bRoster.length>0;
        const aNote=aOwned?aRoster.map(p=>p.name).filter(Boolean).join(", "):"";
        const bNote=bOwned?bRoster.map(p=>p.name).filter(Boolean).join(", "):"";
        return heading+`<div class="game-card ${aOwned||bOwned?"roster-match":""}">
          <div class="game-team ${aOwned?"my-roster-team":""}"><span class="team-mark">${h(g.aCode||"TBD")}</span><div><strong>${h(g.a||"TBD")}</strong><small>${h(aNote)}</small></div></div>
          <div class="game-meta"><span class="game-time">${h(g.time||"TBD")}</span><span class="game-league">${h(competitionName(g.competition||g.leagueCode)||g.league||"LoL Esports")}</span><span class="game-stage">${h([g.stage,Number(g.count)>0?"BO"+g.count:""].filter(Boolean).join(" · "))}</span><span class="game-status ${displayMatchStatus(g.status)==="LIVE"?"live":""} ${["POSTPONED","CANCELED"].includes(displayMatchStatus(g.status))?"canceled":""}">${h(displayMatchStatus(g.status))}</span></div>
          <div class="game-team right ${bOwned?"my-roster-team":""}"><div><strong>${h(g.b||"TBD")}</strong><small>${h(bNote)}</small></div><span class="team-mark">${h(g.bCode||"TBD")}</span></div>
        </div>`;
      }).join(""):(leagueCompleted
        ? '<div class="empty-state"><strong>Season complete</strong><small>'+h(competitionName(leagueCompetition))+' has no remaining matches. Use All to review completed matches.</small></div>'
        : rosterOnly
          ? '<div class="empty-state"><strong>No roster games found</strong><small>There are no scheduled matches for players on your current roster in this time filter.</small></div>'
          : '<div class="empty-state"><strong>No matches found</strong><small>Try another filter or check back after the next data refresh.</small></div>');
    };

    document.querySelectorAll("[data-day]").forEach(c=>c.onclick=()=>{day=c.dataset.day;document.querySelectorAll("[data-day]").forEach(x=>x.classList.remove("active"));c.classList.add("active");drawSchedule();});
    (async()=>{
      const leagueId=getActiveLeagueId();
      if(leagueId&&cloudReady()){
        try{
          const leagues=await backend().listLeagues();
          const league=leagues.find(l=>String(l.id)===String(leagueId));
          if(league){
            leagueCompetition=normalizeCompetitionCode(league.settings?.competition)||null;
            leagueCompleted=String(league.status)==="completed";
            if(title&&leagueCompetition)title.textContent=rosterOnly?"My "+competitionName(leagueCompetition)+" Schedule":competitionName(leagueCompetition)+" Schedule";
            if(copy&&leagueCompetition)copy.textContent=leagueCompleted
              ? competitionName(leagueCompetition)+" season complete · no future matches remain."
              : rosterOnly
                ?"Only "+competitionName(leagueCompetition)+" matches involving players on your current fantasy roster."
                :"Official "+competitionName(leagueCompetition)+" matches in the current schedule window.";
            const season=Number(league.settings?.competitionSeason)||new Date().getFullYear();
            const scheduleFrom=leagueCompleted?new Date(Date.UTC(season,0,1)):null;
            const scheduleTo=leagueCompleted?new Date(Date.UTC(season+1,0,1)):null;
            const [loaded,matches,user,rounds,matchups,allRosters]=await Promise.all([
              loadRosterFromCloud(leagueId),
              backend().listProMatches?.(leagueCompetition,scheduleFrom,scheduleTo),
              backend().currentUser(),
              backend().listFantasyRounds(leagueId).catch(()=>[]),
              backend().listLeagueMatchups(leagueId).catch(()=>[]),
              backend().listRosters(leagueId).catch(()=>[])
            ]);
            rosterPlayers=loaded?getUserRoster():[];
            if(Array.isArray(matches)&&matches.length)scheduleRows=matches.map(databaseMatchToSchedule);

            if(rosterOnly){
              const intel=document.querySelector("#scheduleIntelligenceCard");
              const currentRound=rounds.find(x=>x.status==="live")||rounds.find(x=>x.status==="upcoming");
              if(intel&&currentRound){
                intel.hidden=false;
                const periodRows=scheduleRows.filter(row=>{
                  const t=Date.parse(row.startTime||row.date||"");
                  return Number.isFinite(t)&&t>=Date.parse(currentRound.starts_at)&&t<Date.parse(currentRound.ends_at);
                });
                const rowsForPlayers=players=>periodRows.filter(row=>
                  rosterMatchForPlayers(players,row.aId,row.a,row.aCode)||
                  rosterMatchForPlayers(players,row.bId,row.b,row.bCode)
                );
                const myRows=rowsForPlayers(rosterPlayers);
                const playersWithGames=rosterPlayers.filter(player=>myRows.some(row=>
                  rosterMatchForPlayers([player],row.aId,row.a,row.aCode)||
                  rosterMatchForPlayers([player],row.bId,row.b,row.bCode)
                ));
                const noGames=rosterPlayers.filter(player=>!playersWithGames.some(x=>playerKey(x)===playerKey(player)));

                const myMatch=matchups.find(m=>Number(m.round_number)===Number(currentRound.round_number)&&(
                  String(m.home_manager_id||"")===String(user?.id)||
                  String(m.away_manager_id||"")===String(user?.id)
                ));
                let opponentRows=[];
                if(myMatch){
                  const opponentId=String(myMatch.home_manager_id||"")===String(user?.id)?myMatch.away_manager_id:myMatch.home_manager_id;
                  const opponentRosterIds=allRosters.filter(x=>String(x.user_id)===String(opponentId)).map(x=>String(x.player_id));
                  const source=allFantasyPlayers();
                  const opponentPlayers=opponentRosterIds.map(id=>source.find(p=>playerKey(p)===id||String(p.id||"")===id)).filter(Boolean);
                  opponentRows=rowsForPlayers(opponentPlayers);
                }

                document.querySelector("#scheduleIntelPeriod").textContent=currentRound.label||("Fantasy Round "+currentRound.round_number);
                document.querySelector("#scheduleIntelMyGames").textContent=String(myRows.length);
                document.querySelector("#scheduleIntelOpponentGames").textContent=myMatch?String(opponentRows.length):"—";
                document.querySelector("#scheduleIntelActivePlayers").textContent=String(playersWithGames.length);
                document.querySelector("#scheduleIntelNoGames").textContent=String(noGames.length);
                const warnings=document.querySelector("#scheduleIntelWarnings");
                if(warnings)warnings.innerHTML=noGames.length
                  ?'<div class="roster-status-banner incomplete"><strong>Players with no game scheduled</strong><small>'+h(noGames.map(p=>p.name).join(", "))+'</small></div>'
                  :'<div class="roster-status-banner complete"><strong>✓ Every rostered player has a scheduled match</strong><small>Based on the current fantasy scoring period.</small></div>';
              }
            }
          }else{
            rosterPlayers=[];
          }
        }catch{
          rosterPlayers=[];
        }
      }else{
        rosterPlayers=[];
      }
      drawSchedule();
    })();
  }
  if(view==="players"){
    const list=document.querySelector("#freeAgentList");
    const search=document.querySelector("#playerSearch");
    const livePlayers=(window.ESPORTS_DATA&&Array.isArray(window.ESPORTS_DATA.players))?window.ESPORTS_DATA.players:[];
    const notice=document.querySelector("#playerDataNotice");
    if(notice)notice.hidden=livePlayers.length>0;
    let role="ALL";
    let leagueRosters=[];
    let currentUser=null;
    let leagueStatus=null;
    let leagueCompetition=null;
    let leagueWaiversEnabled=true;
    let playerStatusMap=new Map();

    const draw=()=>{
      const q=search.value.trim().toLowerCase();
      const source=getActiveLeagueId()?eligibleFantasyPlayers():allFantasyPlayers();
      const hiddenStatuses=new Set(["inactive","eliminated","season_complete","substitute","no_upcoming_match"]);
      const filtered=source.filter(p=>{
        if(role!=="ALL"&&p.role!==role)return false;
        if(!(`${p.name} ${p.team} ${p.role}`.toLowerCase().includes(q)))return false;
        if(!getActiveLeagueId()||q)return true;
        const pid=playerKey(p);
        const ownership=leagueRosters.find(r=>String(r.player_id)===String(pid));
        const availability=playerStatusMap.get(String(pid));
        return Boolean(ownership)||!hiddenStatuses.has(String(availability?.status||""));
      });
      list.innerHTML=filtered.map(p=>playerRow(p,true)).join("") || '<div class="empty-state"><strong>No players found</strong><small>Try a different name, team, or role.</small></div>';

      list.querySelectorAll(".add-btn").forEach((b,i)=>{
        const p=filtered[i];
        const pid=playerKey(p);
        const ownership=leagueRosters.find(r=>String(r.player_id)===String(pid));
        const state=b.closest(".player-fantasy-state")?.querySelector(".player-status-label");
        const availability=playerStatusMap.get(String(pid));
        const draftable=playerIsDraftable(p);
        const unavailable=!draftable||!playerAvailableForAcquisition(p,leagueCompetition);
        if(ownership){
          if(String(ownership.user_id)===String(currentUser?.id)){
            b.textContent="OWNED";
            b.classList.add("owned");
            if(state)state.textContent="On your roster";
          }else{
            b.textContent="ROSTERED";
            if(state)state.textContent="Rostered";
          }
          b.disabled=true;
        }else if(unavailable){
          const status=String(availability?.status||"");
          const label=!draftable?"SUBSTITUTE":playerAvailabilityLabel(status);
          b.textContent="UNAVAILABLE";
          if(state)state.textContent=label;
          b.disabled=true;
        }else if(leagueStatus&&leagueStatus!=="active"){
          b.textContent=leagueStatus==="drafting"?"DRAFTING":"LOCKED";
          if(state)state.textContent=leagueStatus==="drafting"?"Drafting":"Unavailable";
          b.disabled=true;
        }else if(!getActiveLeagueId()){
          if(state)state.textContent="Free agent";
          b.hidden=true;
        }else{
          if(state){
            state.textContent=leagueWaiversEnabled
              ?"Waiver eligible"
              :(availability?String(availability.status).replaceAll("_"," "):"Free agent");
          }
          b.textContent=leagueWaiversEnabled?"WAIVER":"ADD";
          b.onclick=async e=>{
            e.stopPropagation();
            b.disabled=true;
            if(leagueWaiversEnabled)await createWaiverClaim(p);
            else await addPlayerToRoster(p);
            await refreshOwnership();
          };
        }
      });

      list.querySelectorAll("[data-open-player]").forEach(row=>{
        row.onclick=(e)=>{if(e.target.closest(".add-btn"))return;openPlayer(row.dataset.openPlayer);};
        row.onkeydown=(e)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openPlayer(row.dataset.openPlayer);}};
      });
    };

    const refreshOwnership=async()=>{
      const leagueId=getActiveLeagueId();
      if(!leagueId||!cloudReady()){leagueRosters=[];leagueStatus=null;draw();return;}
      try{
        const b=backend();
        const [user,rosters,leagues]=await Promise.all([b.currentUser(),b.listRosters(leagueId),b.listLeagues()]);
        currentUser=user;
        leagueRosters=rosters;
        const activeLeague=leagues.find(l=>String(l.id)===String(leagueId));
        if(!activeLeague){
          setActiveLeagueId(null);
          leagueStatus=null;
          leagueCompetition=null;
          leagueRosters=[];
          draw();
          return;
        }
        leagueStatus=activeLeague.status||null;
        leagueCompetition=normalizeCompetitionCode(activeLeague.settings?.competition)||null;
        leagueWaiversEnabled=activeLeague.settings?.waivers!==false;
        const statuses=leagueCompetition?await b.listPlayerCompetitionStatus(leagueCompetition).catch(()=>[]):[];
        cacheCompetitionStatuses(leagueCompetition,statuses);
        playerStatusMap=new Map(statuses.map(x=>[String(x.player_id),x]));
      }catch{
        leagueRosters=[];
      }
      draw();
    };

    search.oninput=draw;
    document.querySelectorAll(".chip").forEach(c=>c.onclick=()=>{role=c.dataset.role;document.querySelectorAll(".chip").forEach(x=>x.classList.remove("active"));c.classList.add("active");draw();});
    void refreshOwnership();
  }
  if(view==="trade"){
    const leagueId=getActiveLeagueId();
    if(leagueId&&cloudReady()){
      void backend().listLeagues().then(leagues=>{
        const league=leagues.find(l=>String(l.id)===String(leagueId));
        if(league?.status!=="active"){
          showToast(league?.status==="completed"?"This league is complete. Trades are closed.":"Trades are not available in this league yet.");
          render("league",{replace:true});
        }
      }).catch(()=>{});
    }
    const partnerSelect=document.querySelector("#tradePartner");
    const myList=document.querySelector("#tradeMyPlayers");
    const theirList=document.querySelector("#tradeTheirPlayers");
    const summary=document.querySelector("#tradeSummaryBox");
    const submit=document.querySelector("#submitTradeBtn");
    const expirationSelect=document.querySelector("#tradeExpiration");
    const content=document.querySelector("#tradeContent");
    const incomingBadge=document.querySelector("#incomingTradeBadge");
    const routeIntent={...tradeRouteIntent};
    tradeRouteIntent={tab:null,id:null};
    let tab=routeIntent.tab||"offers";
    let focusTradeId=routeIntent.id||null;
    let counterSourceTradeId=null;
    let activeAcceptanceTradeId=null;
    const selectedMine=new Set();
    const selectedTheirs=new Set();
    if(tradePrefill.side==="mine"&&tradePrefill.id)selectedMine.add(String(tradePrefill.id));
    if(tradePrefill.side==="theirs"&&tradePrefill.id)selectedTheirs.add(String(tradePrefill.id));
    tradePrefill={id:null,side:null};
    let user=null,members=[],rosters=[],trades=[];
    let tradeCompetition=null;
    let tradePlayerStatusMap=new Map();
    let isCommissioner=false;
    const playerFromId=id=>playerById(id)||{id,name:id,team:"",role:""};
    const partnerName=id=>members.find(m=>String(m.user_id)===String(id))?.team_name||"Manager";
    const currentPartner=()=>partnerSelect?.value||"";
    const myRoster=()=>rosters.filter(r=>String(r.user_id)===String(user?.id)&&String(r.manager_type||"human")==="human");
    const theirRoster=()=>rosters.filter(r=>String(r.user_id)===String(currentPartner())&&String(r.manager_type||"human")==="human");
    const offerIds=(trade,side)=>{
      const plural=trade?.offer?.[side+"_player_ids"];
      if(Array.isArray(plural))return [...new Set(plural.map(String).filter(Boolean))];
      const one=trade?.offer?.[side+"_player_id"];
      return one?[String(one)]:[];
    };
    const effectiveStatus=t=>{
      const status=String(t?.status||"pending");
      if(["pending","review_pending"].includes(status)&&t?.expires_at&&new Date(t.expires_at).getTime()<=Date.now())return "expired";
      return status;
    };
    const staleTradeMessage=status=>{
      switch(String(status||"")){
        case "canceled": return "This trade offer was canceled by the sender.";
        case "declined": return "This trade offer was declined.";
        case "expired": return "This trade offer expired and can no longer be accepted.";
        case "accepted": return "This trade has already been completed.";
        case "review_pending": return "This trade is already awaiting commissioner review.";
        case "rejected": return "This trade was rejected.";
        default: return "This trade is no longer available.";
      }
    };
    const closeStaleAcceptance=(status)=>{
      if(!activeAcceptanceTradeId)return;
      activeAcceptanceTradeId=null;
      const modal=document.querySelector("#transactionModal");
      if(modal&&!modal.hidden)closeTransactionModal();
      showToast(staleTradeMessage(status));
    };

    const expiryText=t=>{
      if(effectiveStatus(t)==="expired")return "Expired";
      if(!t?.expires_at)return "";
      const ms=new Date(t.expires_at).getTime()-Date.now();
      if(ms<=0)return "Expired";
      const mins=Math.ceil(ms/60000);
      if(mins<60)return "Expires in "+mins+" minute"+(mins===1?"":"s");
      const hours=Math.ceil(ms/3600000);
      if(hours<48)return "Expires in "+hours+" hour"+(hours===1?"":"s");
      const days=Math.ceil(ms/86400000);
      return "Expires in "+days+" day"+(days===1?"":"s");
    };
    const playerStack=ids=>ids.map(id=>{
      const p=playerFromId(id);
      return `<span><strong>${h(p.name)}</strong><small>${h(p.role||"")} · ${h(p.team||"")}</small></span>`;
    }).join("");
    const selectedNames=(set,source)=>[...set].map(id=>{
      const row=source.find(r=>String(r.player_id)===String(id));
      return row?playerFromId(row.player_id).name:id;
    });
    const rosterBalanceFor=(currentCount,outgoingCount,incomingCount)=>{
      const post=currentCount-outgoingCount+incomingCount;
      return {post,drops:Math.max(0,post-rosterLimit()),adds:Math.max(0,rosterLimit()-post)};
    };
    const recipientBalanceForTrade=t=>rosterBalanceFor(myRoster().length,offerIds(t,"receive").length,offerIds(t,"send").length);
    const tradeFreeAgents=()=>allFantasyPlayers().filter(p=>{
      const id=playerKey(p);
      const status=String(tradePlayerStatusMap.get(id)?.status||"");
      if(!playerAvailableForAcquisition(p,tradeCompetition))return false;
      if(status!=="starter")return false;
      return !rosters.some(r=>String(r.player_id)===String(id));
    });

    if(tradeRealtimeCleanup){try{tradeRealtimeCleanup();}catch{}tradeRealtimeCleanup=null;}
    let liveRefreshPending=false;
    const refreshTradeData=async()=>{
      if(!leagueId||!cloudReady())throw new Error("Select an online league before trading.");
      const b=backend();
      const leaguesPromise=b.listLeagues();
      [user,members,rosters,trades]=await Promise.all([
        b.currentUser(),
        b.listLeagueMembers(leagueId),
        b.listRosters(leagueId),
        b.listTrades(leagueId)
      ]);
      if(!user)throw new Error("Sign in before trading.");
      const leagues=await leaguesPromise;
      const activeLeague=leagues.find(l=>String(l.id)===String(leagueId));
      tradeCompetition=normalizeCompetitionCode(activeLeague?.settings?.competition)||null;
      const tradeStatuses=tradeCompetition?await b.listPlayerCompetitionStatus(tradeCompetition).catch(()=>[]):[];
      cacheCompetitionStatuses(tradeCompetition,tradeStatuses);
      tradePlayerStatusMap=new Map(tradeStatuses.map(x=>[String(x.player_id),x]));
      if(activeLeague?.settings){
        cacheLeagueSettings({
          ...defaultLeagueSettings,
          ...activeLeague.settings,
          scoring:{...defaultLeagueSettings.scoring,...(activeLeague.settings.scoring||{})}
        })
      }
      isCommissioner=members.some(m=>String(m.user_id)===String(user.id)&&m.role==="owner");
    };

    const updateTabButtons=()=>{
      document.querySelectorAll("[data-trade-tab]").forEach(btn=>btn.classList.toggle("active",btn.dataset.tradeTab===tab));
    };

    const renderBuilder=()=>{
      const mine=myRoster();
      const theirs=theirRoster();
      [...selectedMine].forEach(id=>{if(!mine.some(r=>String(r.player_id)===id))selectedMine.delete(id);});
      [...selectedTheirs].forEach(id=>{if(!theirs.some(r=>String(r.player_id)===id))selectedTheirs.delete(id);});

      myList.innerHTML=mine.length?mine.map(r=>{
        const p=playerFromId(r.player_id);
        const status=String(tradePlayerStatusMap.get(String(r.player_id))?.status||"");
        const unavailable=status!=="starter";
        if(unavailable)selectedMine.delete(String(r.player_id));
        return `<button class="trade-option ${selectedMine.has(String(r.player_id))?"selected":""}" data-trade-mine="${h(r.player_id)}" ${unavailable?"disabled":""}><strong>${h(p.name)}</strong><small>${h(p.role||r.slot)} · ${h(p.team)}${unavailable?" · "+h(playerAvailabilityLabel(status)):""}</small></button>`;
      }).join(""):'<div class="empty-state"><strong>No rostered players</strong><small>Your drafted roster will appear here.</small></div>';

      theirList.innerHTML=theirs.length?theirs.map(r=>{
        const p=playerFromId(r.player_id);
        const status=String(tradePlayerStatusMap.get(String(r.player_id))?.status||"");
        const unavailable=status!=="starter";
        if(unavailable)selectedTheirs.delete(String(r.player_id));
        return `<button class="trade-option ${selectedTheirs.has(String(r.player_id))?"selected":""}" data-trade-theirs="${h(r.player_id)}" ${unavailable?"disabled":""}><strong>${h(p.name)}</strong><small>${h(p.role||r.slot)} · ${h(p.team)}${unavailable?" · "+h(playerAvailabilityLabel(status)):""}</small></button>`;
      }).join(""):'<div class="empty-state"><strong>No players to trade for</strong><small>This manager does not have a roster yet.</small></div>';

      const mineNames=selectedNames(selectedMine,mine);
      const theirNames=selectedNames(selectedTheirs,theirs);
      const valid=mineNames.length>0&&theirNames.length>0&&mineNames.length<=5&&theirNames.length<=5;
      if(valid){
        const mineBalance=rosterBalanceFor(mine.length,mineNames.length,theirNames.length);
        const theirBalance=rosterBalanceFor(theirs.length,theirNames.length,mineNames.length);
        const mineAfter=mineBalance.post;
        const theirsAfter=theirBalance.post;
        summary.innerHTML=`
          <strong class="trade-summary-title">${counterSourceTradeId?"Counteroffer":"Trade Offer"}</strong>
          <div class="trade-summary-lists">
            <div class="trade-summary-side"><span>YOU SEND</span><strong>${h(mineNames.join(", "))}</strong></div>
            <div class="trade-summary-side"><span>YOU RECEIVE</span><strong>${h(theirNames.join(", "))}</strong></div>
          </div>
          <div class="trade-impact">
            <strong>Roster Impact</strong>
            <small>Your roster: ${mine.length} → ${mineAfter} players before balance moves</small>
            <small>${h(partnerName(currentPartner()))}: ${theirs.length} → ${theirsAfter} players before balance moves</small>
            ${mineBalance.drops?`<small class="warning">You must choose ${mineBalance.drops} player${mineBalance.drops===1?"":"s"} to drop before sending.</small>`:""}
            ${mineBalance.adds?`<small class="warning">You must choose ${mineBalance.adds} eligible free agent${mineBalance.adds===1?"":"s"} to add before sending.</small>`:""}
            ${theirBalance.drops?`<small class="warning">${h(partnerName(currentPartner()))} must choose ${theirBalance.drops} player${theirBalance.drops===1?"":"s"} to drop before accepting.</small>`:""}
            ${theirBalance.adds?`<small class="warning">${h(partnerName(currentPartner()))} must choose ${theirBalance.adds} eligible free agent${theirBalance.adds===1?"":"s"} to add before accepting.</small>`:""}
          </div>`;
        submit.disabled=false;
        submit.textContent=counterSourceTradeId?"Send Counteroffer":"Send Trade Offer";
      }else{
        summary.textContent="Select at least one player from each side to build an offer. You can select up to 5 players per side.";
        submit.disabled=true;
        submit.textContent=counterSourceTradeId?"Send Counteroffer":"Send Trade Offer";
      }

      const toggle=(set,id)=>{
        id=String(id);
        if(set.has(id))set.delete(id);
        else if(set.size>=5)showToast("You can select up to 5 players per side.");
        else set.add(id);
        renderBuilder();
      };
      myList.querySelectorAll("[data-trade-mine]").forEach(btn=>btn.onclick=()=>toggle(selectedMine,btn.dataset.tradeMine));
      theirList.querySelectorAll("[data-trade-theirs]").forEach(btn=>btn.onclick=()=>toggle(selectedTheirs,btn.dataset.tradeTheirs));
    };

    const openTradeAcceptance=(trade,balance)=>{
      activeAcceptanceTradeId=String(trade.id);
      const modal=document.querySelector("#transactionModal");
      const list=document.querySelector("#transactionDropList");
      const copy=document.querySelector("#transactionCopy");
      const title=document.querySelector("#transactionTitle");
      if(!modal||!list||!copy)return;
      const sendIds=offerIds(trade,"receive");
      const receiveIds=offerIds(trade,"send");
      const outbound=new Set(sendIds);
      const dropEligible=myRoster().filter(r=>!outbound.has(String(r.player_id)));
      const senderAdds=new Set(Array.isArray(trade?.offer?.sender_add_player_ids)?trade.offer.sender_add_player_ids.map(String):[]);
      const addEligible=tradeFreeAgents().filter(p=>!receiveIds.includes(playerKey(p))&&!senderAdds.has(playerKey(p)));
      const pickedDrops=new Set();
      const pickedAdds=new Set();
      const neededDrops=Number(balance?.drops)||0;
      const neededAdds=Number(balance?.adds)||0;
      if(title)title.textContent=(neededDrops||neededAdds)?"Complete Trade":"Confirm Trade";
      copy.textContent=neededDrops
        ? `Review the trade and choose exactly ${neededDrops} player${neededDrops===1?"":"s"} to drop so your roster stays full.`
        : neededAdds
          ? `Review the trade and choose exactly ${neededAdds} eligible free agent${neededAdds===1?"":"s"} to add so your roster stays full.`
          : "Review the full trade package before completing it. Rosters update immediately once the trade is accepted.";
      const packageSummary=`
        <div class="trade-accept-summary">
          <div><span>YOU RECEIVE</span><strong>${h(receiveIds.map(id=>playerFromId(id).name).join(", "))}</strong></div>
          <div><span>YOU SEND</span><strong>${h(sendIds.map(id=>playerFromId(id).name).join(", "))}</strong></div>
          ${neededDrops?`<div class="trade-accept-drop-summary"><span>YOU DROP</span><strong id="tradeDropSummary">Choose ${neededDrops} player${neededDrops===1?"":"s"}</strong></div>`:""}
          ${neededAdds?`<div class="trade-accept-add-summary"><span>YOU ADD</span><strong id="tradeAddSummary">Choose ${neededAdds} free agent${neededAdds===1?"":"s"}</strong></div>`:""}
        </div>`;
      const draw=()=>{
        const dropChoices=neededDrops?dropEligible.map(r=>{
          const p=playerFromId(r.player_id);
          const on=pickedDrops.has(String(r.player_id));
          return `<button class="drop-option trade-drop-choice ${on?"selected":""}" data-trade-drop-id="${h(r.player_id)}"><span class="role-badge">${h(r.slot||p.role)}</span><span><strong>${h(p.name)}</strong><small>${h(p.team)} · ${h(p.role||r.slot)}</small></span><span class="drop-action">${on?"SELECTED":"DROP"}</span></button>`;
        }).join(""):"";
        const addChoices=neededAdds?addEligible.map(p=>{
          const id=playerKey(p),on=pickedAdds.has(id);
          return `<button class="drop-option trade-add-choice ${on?"selected":""}" data-trade-add-id="${h(id)}"><span class="role-badge">${h(p.role)}</span><span><strong>${h(p.name)}</strong><small>${h(p.team)} · ${h(p.role)}</small></span><span class="drop-action">${on?"SELECTED":"ADD"}</span></button>`;
        }).join(""):"";
        const ready=pickedDrops.size===neededDrops&&pickedAdds.size===neededAdds;
        list.innerHTML=packageSummary+dropChoices+addChoices+`<button class="primary-btn trade-drop-confirm" id="completeTradeWithDrops" ${ready?"":"disabled"}>Accept Trade</button>`;
        const dropSummary=list.querySelector("#tradeDropSummary");
        if(dropSummary)dropSummary.textContent=pickedDrops.size?[...pickedDrops].map(id=>playerFromId(id).name).join(", "):`Choose ${neededDrops} player${neededDrops===1?"":"s"}`;
        const addSummary=list.querySelector("#tradeAddSummary");
        if(addSummary)addSummary.textContent=pickedAdds.size?[...pickedAdds].map(id=>playerFromId(id).name).join(", "):`Choose ${neededAdds} free agent${neededAdds===1?"":"s"}`;
        list.querySelectorAll("[data-trade-drop-id]").forEach(btn=>btn.onclick=()=>{
          const id=String(btn.dataset.tradeDropId);
          if(pickedDrops.has(id))pickedDrops.delete(id);
          else if(pickedDrops.size<neededDrops)pickedDrops.add(id);
          else showToast(`Choose exactly ${neededDrops} player${neededDrops===1?"":"s"} to drop.`);
          draw();
        });
        list.querySelectorAll("[data-trade-add-id]").forEach(btn=>btn.onclick=()=>{
          const id=String(btn.dataset.tradeAddId);
          if(pickedAdds.has(id))pickedAdds.delete(id);
          else if(pickedAdds.size<neededAdds)pickedAdds.add(id);
          else showToast(`Choose exactly ${neededAdds} free agent${neededAdds===1?"":"s"} to add.`);
          draw();
        });
        const confirm=list.querySelector("#completeTradeWithDrops");
        if(confirm)confirm.onclick=async()=>{
          confirm.disabled=true;
          try{
            await refreshTradeData();
            const liveTrade=trades.find(t=>String(t.id)===String(trade.id));
            const liveStatus=liveTrade?effectiveStatus(liveTrade):"unavailable";
            if(!liveTrade||liveStatus!=="pending"){
              closeStaleAcceptance(liveStatus);
              renderBuilder();
              renderTabs();
              return;
            }
            const result=await backend().acceptTrade(trade.id,[...pickedDrops],[...pickedAdds]);
            activeAcceptanceTradeId=null;
            await loadRosterFromCloud(leagueId);
            closeTransactionModal();
            showToast(result?.status==="review_pending"?"Trade accepted · Awaiting commissioner review":"Trade accepted");
            await init();
          }catch(err){
            try{
              await refreshTradeData();
              const latest=trades.find(t=>String(t.id)===String(trade.id));
              const latestStatus=latest?effectiveStatus(latest):"unavailable";
              if(!latest||latestStatus!=="pending"){
                closeStaleAcceptance(latestStatus);
                renderBuilder();
                renderTabs();
                return;
              }
            }catch{}
            showToast(err.message||"Could not accept trade");
            confirm.disabled=false;
          }
        };
      };
      draw();
      modalReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
      modal.hidden=false;
      document.body.classList.add("modal-open");
      const shell=document.querySelector(".app-shell");
      if(shell)shell.inert=true;
      queueMicrotask(()=>list.querySelector("[data-trade-drop-id],[data-trade-add-id],#completeTradeWithDrops")?.focus());
    };
    const renderTabs=()=>{
      const active=t=>effectiveStatus(t)==="pending";
      const outgoing=trades.filter(t=>String(t.from_user)===String(user?.id)&&active(t));
      const incoming=trades.filter(t=>String(t.to_user)===String(user?.id)&&active(t));
      const history=trades.filter(t=>effectiveStatus(t)!=="pending"&&(
        String(t.from_user)===String(user?.id)||
        String(t.to_user)===String(user?.id)||
        (isCommissioner&&effectiveStatus(t)==="review_pending")
      ));
      if(incomingBadge){
        incomingBadge.textContent=String(incoming.length);
        incomingBadge.hidden=incoming.length===0;
      }
      updateTabButtons();

      const renderCard=t=>{
        const sendIds=offerIds(t,"send");
        const receiveIds=offerIds(t,"receive");
        const isOutgoing=String(t.from_user)===String(user?.id);
        const counterpart=isOutgoing?partnerName(t.to_user):partnerName(t.from_user);
        const status=effectiveStatus(t);
        const commissionerQueue=isCommissioner&&status==="review_pending";
        const userParty=String(t.from_user)===String(user?.id)||String(t.to_user)===String(user?.id);
        const leftIds=commissionerQueue&&!userParty?sendIds:(isOutgoing?sendIds:receiveIds);
        const rightIds=commissionerQueue&&!userParty?receiveIds:(isOutgoing?receiveIds:sendIds);
        const leftLabel=commissionerQueue&&!userParty?partnerName(t.from_user)+" SENDS":"YOU SEND";
        const rightLabel=commissionerQueue&&!userParty?partnerName(t.to_user)+" SENDS":"YOU RECEIVE";
        const drops=Array.isArray(t.acceptance_drop_player_ids)?t.acceptance_drop_player_ids:[];
        const actions=status==="pending"
          ?(isOutgoing
            ?`<div class="trade-card-actions"><button class="secondary-btn" data-cancel-trade="${h(t.id)}">Cancel Offer</button></div>`
            :`<div class="trade-card-actions"><button class="primary-btn" data-accept-trade="${h(t.id)}">Accept</button><button class="secondary-btn" data-counter-trade="${h(t.id)}">Counter</button><button class="secondary-btn" data-decline-trade="${h(t.id)}">Decline</button></div>`)
          :(commissionerQueue
            ?`<div class="trade-card-actions"><button class="primary-btn" data-approve-trade="${h(t.id)}">Approve</button><button class="secondary-btn" data-reject-trade="${h(t.id)}">Reject</button></div>`
            :"");
        const focused=focusTradeId&&String(t.id)===String(focusTradeId);
        return `<div class="trade-card ${focused?"trade-card-focus":""}" data-trade-card="${h(t.id)}">
          <div class="trade-card-head"><div><h4>${h(commissionerQueue?"Commissioner Review":counterpart)}</h4><small>${new Date(t.created_at).toLocaleString()}</small></div><span class="trade-status ${h(status)}">${h(status.replaceAll("_"," ").toUpperCase())}</span></div>
          <div class="trade-swap">
            <div class="trade-side"><span>${h(leftLabel)}</span><div class="trade-player-stack">${playerStack(leftIds)}</div></div>
            <div class="trade-arrow">⇄</div>
            <div class="trade-side"><span>${h(rightLabel)}</span><div class="trade-player-stack">${playerStack(rightIds)}</div></div>
          </div>
          ${drops.length?`<small class="trade-expiry">Roster drops: ${h(drops.map(id=>playerFromId(id).name).join(", "))}</small>`:""}
          ${status==="pending"&&expiryText(t)?`<small class="trade-expiry">${h(expiryText(t))}</small>`:""}
          ${status==="review_pending"?'<small class="trade-review-copy">Recipient accepted. Rosters do not change until commissioner approval.</small>':""}
          ${actions}
        </div>`;
      };
      const rows=tab==="offers"?outgoing:tab==="incoming"?incoming:history;
      content.innerHTML=rows.length?rows.map(renderCard).join(""):`<div class="empty-state"><strong>No ${tab==="offers"?"outgoing offers":tab==="incoming"?"incoming offers":"trade history"}</strong><small>Trades from your active league will appear here.</small></div>`;

      content.querySelectorAll("[data-cancel-trade]").forEach(btn=>btn.onclick=async()=>{
        if(btn.disabled)return;
        btn.disabled=true;
        try{await backend().updateTrade(btn.dataset.cancelTrade,"canceled");showToast("Trade offer canceled");await init();}
        catch(err){showToast(err.message||"Could not cancel trade");btn.disabled=false;}
      });
      content.querySelectorAll("[data-decline-trade]").forEach(btn=>btn.onclick=async()=>{
        if(btn.disabled)return;
        btn.disabled=true;
        try{await backend().updateTrade(btn.dataset.declineTrade,"declined");showToast("Trade declined");await init();}
        catch(err){showToast(err.message||"Could not decline trade");btn.disabled=false;}
      });
      content.querySelectorAll("[data-accept-trade]").forEach(btn=>btn.onclick=()=>{
        const trade=trades.find(t=>String(t.id)===String(btn.dataset.acceptTrade));
        if(!trade)return;
        openTradeAcceptance(trade,recipientBalanceForTrade(trade));
      });
      content.querySelectorAll("[data-counter-trade]").forEach(btn=>btn.onclick=()=>{
        const trade=trades.find(t=>String(t.id)===String(btn.dataset.counterTrade));
        if(!trade)return;
        const partnerId=String(trade.from_user);
        if([...partnerSelect.options].some(option=>String(option.value)===partnerId))partnerSelect.value=partnerId;
        selectedMine.clear();
        selectedTheirs.clear();
        offerIds(trade,"receive").forEach(id=>selectedMine.add(String(id)));
        offerIds(trade,"send").forEach(id=>selectedTheirs.add(String(id)));
        counterSourceTradeId=String(trade.id);
        renderBuilder();
        document.querySelector(".trade-builder")?.scrollIntoView({behavior:"smooth",block:"start"});
        showToast("Counteroffer loaded. Adjust the package and send when ready.");
      });
      content.querySelectorAll("[data-approve-trade]").forEach(btn=>btn.onclick=async()=>{
        if(btn.disabled)return;
        btn.disabled=true;
        try{await backend().reviewTrade(btn.dataset.approveTrade,true);await loadRosterFromCloud(leagueId);showToast("Trade approved");await init();}
        catch(err){showToast(err.message||"Could not approve trade");btn.disabled=false;}
      });
      content.querySelectorAll("[data-reject-trade]").forEach(btn=>btn.onclick=async()=>{
        if(btn.disabled)return;
        btn.disabled=true;
        try{await backend().reviewTrade(btn.dataset.rejectTrade,false);showToast("Trade rejected");await init();}
        catch(err){showToast(err.message||"Could not reject trade");btn.disabled=false;}
      });

      if(focusTradeId){
        const target=content.querySelector('[data-trade-card="'+CSS.escape(String(focusTradeId))+'"]');
        if(target)queueMicrotask(()=>target.scrollIntoView({behavior:"smooth",block:"center"}));
        focusTradeId=null;
      }
    };

    const syncTradeView=async({reloadRoster=false}={})=>{
      if(liveRefreshPending)return;
      liveRefreshPending=true;
      try{
        await refreshTradeData();
        if(activeAcceptanceTradeId){
          const liveTrade=trades.find(t=>String(t.id)===String(activeAcceptanceTradeId));
          const liveStatus=liveTrade?effectiveStatus(liveTrade):"unavailable";
          if(!liveTrade||liveStatus!=="pending")closeStaleAcceptance(liveStatus);
        }
        if(reloadRoster)await loadRosterFromCloud(leagueId).catch(()=>{});
        renderBuilder();
        renderTabs();
        if(!tradeRealtimeCleanup&&typeof backend().subscribeLeagueTradeUpdates==="function"){
          tradeRealtimeCleanup=await backend().subscribeLeagueTradeUpdates(leagueId,change=>{
            void syncTradeView({reloadRoster:change?.type==="roster"||change?.type==="trade"});
          });
        }
      }catch(err){
        console.warn("Trade live refresh failed",err);
      }finally{
        liveRefreshPending=false;
      }
    };

    const init=async()=>{
      try{
        await refreshTradeData();
        const partners=members.filter(m=>String(m.user_id)!==String(user.id));
        if(!partners.length){
          partnerSelect.innerHTML="";
          myList.innerHTML='<div class="empty-state"><strong>No trade partners yet</strong><small>Another manager must join this league first.</small></div>';
          theirList.innerHTML="";
          submit.disabled=true;
          renderTabs();
          return;
        }
        const prior=partnerSelect.value;
        partnerSelect.innerHTML=partners.map(m=>`<option value="${h(m.user_id)}">${h(m.team_name||"Manager")}</option>`).join("");
        if(partners.some(m=>String(m.user_id)===String(prior)))partnerSelect.value=prior;
        renderBuilder();
        renderTabs();
      }catch(err){
        content.innerHTML=`<div class="empty-state cloud-error"><strong>Trades unavailable</strong><small>${h(err.message||"Could not load trades.")}</small></div>`;
        submit.disabled=true;
      }
    };

    const openSenderTradeBalance=(balance,onReady)=>{
      const modal=document.querySelector("#transactionModal");
      const list=document.querySelector("#transactionDropList");
      const copy=document.querySelector("#transactionCopy");
      const title=document.querySelector("#transactionTitle");
      if(!modal||!list||!copy)return;
      const outgoing=new Set([...selectedMine]);
      const dropEligible=myRoster().filter(r=>!outgoing.has(String(r.player_id)));
      const addEligible=tradeFreeAgents().filter(p=>![...selectedTheirs].includes(playerKey(p)));
      const pickedDrops=new Set();
      const pickedAdds=new Set();
      const neededDrops=Number(balance?.drops)||0;
      const neededAdds=Number(balance?.adds)||0;
      if(title)title.textContent="Balance Your Roster";
      copy.textContent=neededDrops
        ? `Choose exactly ${neededDrops} player${neededDrops===1?"":"s"} to drop as part of this trade so your roster stays full.`
        : `Choose exactly ${neededAdds} eligible free agent${neededAdds===1?"":"s"} to add as part of this trade so your roster stays full.`;
      const draw=()=>{
        const rows=neededDrops?dropEligible.map(r=>{
          const p=playerFromId(r.player_id),id=String(r.player_id),on=pickedDrops.has(id);
          return `<button class="drop-option trade-drop-choice ${on?"selected":""}" data-sender-drop-id="${h(id)}"><span class="role-badge">${h(r.slot||p.role)}</span><span><strong>${h(p.name)}</strong><small>${h(p.team)} · ${h(p.role||r.slot)}</small></span><span class="drop-action">${on?"SELECTED":"DROP"}</span></button>`;
        }).join(""):addEligible.map(p=>{
          const id=playerKey(p),on=pickedAdds.has(id);
          return `<button class="drop-option trade-add-choice ${on?"selected":""}" data-sender-add-id="${h(id)}"><span class="role-badge">${h(p.role)}</span><span><strong>${h(p.name)}</strong><small>${h(p.team)} · ${h(p.role)}</small></span><span class="drop-action">${on?"SELECTED":"ADD"}</span></button>`;
        }).join("");
        const ready=pickedDrops.size===neededDrops&&pickedAdds.size===neededAdds;
        list.innerHTML=rows+`<button class="primary-btn trade-drop-confirm" id="confirmSenderBalance" ${ready?"":"disabled"}>Continue Trade</button>`;
        list.querySelectorAll("[data-sender-drop-id]").forEach(btn=>btn.onclick=()=>{
          const id=String(btn.dataset.senderDropId);
          if(pickedDrops.has(id))pickedDrops.delete(id);
          else if(pickedDrops.size<neededDrops)pickedDrops.add(id);
          draw();
        });
        list.querySelectorAll("[data-sender-add-id]").forEach(btn=>btn.onclick=()=>{
          const id=String(btn.dataset.senderAddId);
          if(pickedAdds.has(id))pickedAdds.delete(id);
          else if(pickedAdds.size<neededAdds)pickedAdds.add(id);
          draw();
        });
        const confirm=list.querySelector("#confirmSenderBalance");
        if(confirm)confirm.onclick=()=>{
          const drops=[...pickedDrops],adds=[...pickedAdds];
          closeTransactionModal();
          onReady(drops,adds);
        };
      };
      draw();
      modalReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
      modal.hidden=false;
      document.body.classList.add("modal-open");
      const shell=document.querySelector(".app-shell");
      if(shell)shell.inert=true;
      queueMicrotask(()=>list.querySelector("[data-sender-drop-id],[data-sender-add-id]")?.focus());
    };

    partnerSelect.onchange=()=>{selectedTheirs.clear();counterSourceTradeId=null;renderBuilder();};
    submit.onclick=async()=>{
      const sendIds=[...selectedMine];
      const receiveIds=[...selectedTheirs];
      if(!sendIds.length||!receiveIds.length)return;
      const balance=rosterBalanceFor(myRoster().length,sendIds.length,receiveIds.length);
      const sendOffer=async(senderDropIds=[],senderAddIds=[])=>{
        submit.disabled=true;
        try{
          const offerPayload={
            send_player_ids:sendIds,
            receive_player_ids:receiveIds,
            sender_drop_player_ids:senderDropIds,
            sender_add_player_ids:senderAddIds,
            expires_in_hours:Number(expirationSelect?.value)||48
          };
          const wasCounter=Boolean(counterSourceTradeId);
          if(wasCounter)await backend().createCounterTrade(counterSourceTradeId,offerPayload);
          else await backend().createTrade(leagueId,currentPartner(),offerPayload);
          selectedMine.clear();
          selectedTheirs.clear();
          counterSourceTradeId=null;
          showToast(wasCounter?"Counteroffer sent":"Trade offer sent");
          await init();
        }catch(err){
          showToast(err.message||"Could not send trade offer");
          renderBuilder();
        }
      };
      if(balance.drops||balance.adds){
        openSenderTradeBalance(balance,sendOffer);
        return;
      }
      await sendOffer();
    };

    document.querySelectorAll("[data-trade-tab]").forEach(btn=>btn.onclick=()=>{
      tab=btn.dataset.tradeTab;
      focusTradeId=null;
      updateTabButtons();
      renderTabs();
    });
    updateTabButtons();
    if(tradeTimerId)clearInterval(tradeTimerId);
    tradeTimerId=setInterval(()=>{
      if(document.querySelector("#tradeContent"))void syncTradeView({reloadRoster:true});
    },20000);
    void init();
  }
  if(view==="transactions"){
    const completedTransactionsLeagueId=getActiveLeagueId();
    if(completedTransactionsLeagueId&&cloudReady()){
      void backend().listLeagues().then(leagues=>{
        const league=leagues.find(l=>String(l.id)===String(completedTransactionsLeagueId));
        if(league?.status!=="active"){
          showToast(league?.status==="completed"?"This league is complete. Transactions are closed.":"Transactions are not available in this league yet.");
          render("league",{replace:true});
        }
      }).catch(()=>{});
    }
    let tab="pending";
    const content=document.querySelector("#transactionContent");
    const count=document.querySelector("#pendingClaimCount");
    const moveCount=document.querySelector("#transactionMoveCount");
    const leagueName=document.querySelector("#transactionLeagueName");
    const leagueId=getActiveLeagueId();
    let user=null,claims=[],moves=[],members=[],leagues=[];
    const fmt=iso=>{const d=new Date(iso);return Number.isNaN(d.getTime())?"":d.toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});};
    const memberName=id=>members.find(m=>String(m.user_id)===String(id))?.team_name||"Manager";
    const playerFromId=id=>playerById(id)||{id,name:id,team:"",role:""};

    const draw=()=>{
      const mineClaims=claims.filter(c=>String(c.user_id)===String(user?.id)&&c.status==="pending");
      count.textContent=mineClaims.length;
      moveCount.textContent=moves.length;
      if(tab==="pending"){
        content.innerHTML=mineClaims.length?mineClaims.map(c=>{const p=playerFromId(c.player_id);return `<div class="transaction-item"><span class="transaction-icon claim">W</span><div class="transaction-info"><strong>${h(p.name)}<span class="status-pill pending">PENDING</span></strong><small>${h(p.team)} · Priority ${h(c.priority)}${c.process_after?" · Processes "+h(fmt(c.process_after)):""}</small><div class="claim-actions"><button class="claim-btn cancel" data-cancel-claim="${h(c.id)}">Cancel</button></div></div><span class="transaction-time">${fmt(c.created_at)}</span></div>`;}).join(""):'<div class="empty-state"><strong>No pending waiver claims</strong><small>Open a player profile and tap Waiver Claim to submit one.</small></div>';
        content.querySelectorAll("[data-cancel-claim]").forEach(btn=>btn.onclick=async()=>{
          if(btn.disabled)return;
          btn.disabled=true;
          try{await backend().cancelWaiver(btn.dataset.cancelClaim);showToast("Waiver claim canceled");await init();}
          catch(err){showToast(err.message||"Could not cancel claim");btn.disabled=false;}
        });
      }else if(tab==="history"){
        const mineMoves=moves.filter(m=>String(m.user_id)===String(user?.id)).map(m=>({kind:"move",at:m.created_at,row:m}));
        const mineClaims=claims.filter(c=>String(c.user_id)===String(user?.id)&&c.status!=="pending").map(c=>({kind:"waiver",at:c.resolved_at||c.created_at,row:c}));
        const history=[...mineMoves,...mineClaims].sort((a,b)=>new Date(b.at||0)-new Date(a.at||0));
        content.innerHTML=history.length?history.map(item=>{
          if(item.kind==="move"){
            const m=item.row,p=playerFromId(m.player_id);
            return `<div class="transaction-item"><span class="transaction-icon ${m.action==="drop"?"drop":""}">${m.action==="add"?"+":"−"}</span><div class="transaction-info"><strong>${m.action==="add"?"Added":"Dropped"} ${h(p.name)}<span class="status-pill success">COMPLETE</span></strong><small>${h(p.team)} · ${h(p.role||"")}</small></div><span class="transaction-time">${fmt(m.created_at)}</span></div>`;
          }
          const c=item.row,p=playerFromId(c.player_id);
          const status=String(c.status||"").toUpperCase();
          const success=c.status==="won";
          const note=c.resolution_note?String(c.resolution_note):c.status==="canceled"?"Claim canceled":"Waiver claim resolved";
          return `<div class="transaction-item"><span class="transaction-icon claim">W</span><div class="transaction-info"><strong>${h(p.name)}<span class="status-pill ${success?"success":""}">${h(status)}</span></strong><small>${h(note)}</small></div><span class="transaction-time">${fmt(c.resolved_at||c.created_at)}</span></div>`;
        }).join(""):'<div class="empty-state"><strong>No transaction history yet</strong><small>Resolved waiver claims and completed roster moves will appear here.</small></div>';
      }else{
        content.innerHTML=moves.length?moves.map(m=>{const p=playerFromId(m.player_id);return `<div class="transaction-item"><span class="transaction-icon ${m.action==="drop"?"drop":""}">${m.action==="add"?"+":"−"}</span><div class="transaction-info"><strong>${h(memberName(m.user_id))} ${m.action==="add"?"added":"dropped"} ${h(p.name)}</strong><small>${h(p.team)} · ${h(p.role||"")}</small></div><span class="transaction-time">${fmt(m.created_at)}</span></div>`;}).join(""):'<div class="empty-state"><strong>No league activity yet</strong><small>Roster moves from every manager will appear here.</small></div>';
      }
    };

    const init=async()=>{
      if(!leagueId||!cloudReady()){
        content.innerHTML='<div class="empty-state"><strong>No active online league</strong><small>Join or select a league to use transactions.</small></div>';
        return;
      }
      try{
        const b=backend();
        [user,claims,moves,members,leagues]=await Promise.all([
          b.currentUser(),b.listWaivers(leagueId),b.listTransactions(leagueId),
          b.listLeagueMembers(leagueId),b.listLeagues()
        ]);
        leagueName.textContent=leagues.find(l=>String(l.id)===String(leagueId))?.name||"League";
        draw();
      }catch(err){content.innerHTML=`<div class="empty-state cloud-error"><strong>Could not load transactions</strong><small>${h(err.message||"Please try again.")}</small></div>`;}
    };
    document.querySelectorAll("[data-transaction-tab]").forEach(btn=>btn.onclick=()=>{tab=btn.dataset.transactionTab;document.querySelectorAll("[data-transaction-tab]").forEach(x=>x.classList.toggle("active",x===btn));draw();});
    void init();
  }
  if(view==="league"){
    const settings=getLeagueSettings();
    const cloudCard=document.querySelector("#cloudLeagueCard");
    const cloudTitle=document.querySelector("#cloudLeagueTitle");
    const cloudCopy=document.querySelector("#cloudLeagueCopy");
    const cloudList=document.querySelector("#cloudLeagueList");
    const overviewCard=document.querySelector("#leagueOverviewCard");
    const activeLeagueEntryCard=document.querySelector("#activeLeagueEntryCard");
    const completedLeaguesCard=document.querySelector("#completedLeaguesCard");
    const completedLeagueList=document.querySelector("#completedLeagueList");
    const completedLeagueReviewPanel=document.querySelector("#completedLeagueReviewPanel");
    const completedLeagueCount=document.querySelector("#completedLeagueCount");
    const managerReadiness=document.querySelector("#leagueManagerReadiness");
    const quickAccess=document.querySelector("#leagueQuickAccess");
    const toolsEyebrow=document.querySelector("#leagueToolsEyebrow");
    const toolsTitle=document.querySelector("#leagueToolsTitle");
    const toolsGrid=document.querySelector("#leagueToolsGrid");
    const inviteField=document.querySelector("#leagueOverviewInviteField");
    const commissionerBtn=document.querySelector("#leagueSetupBtn");
    const rulesModal=document.querySelector("#leagueRulesModal");
    const entryActions=document.querySelector("#leagueEntryActions");
    const renderLeagueSettingsSummary=summarySettings=>{
      const summary=document.querySelector("#leagueSettingsSummary");
      if(summary)summary.innerHTML=`
        <div><span>Teams</span><strong>${h(String(summarySettings.managers))}</strong></div>
        <div><span>Draft</span><strong>${h(summarySettings.draftType)}</strong></div>
        <div><span>Scoring</span><strong>${h(summarySettings.scoringFormat)}</strong></div>
        <div><span>Competition</span><strong>${h(competitionName(summarySettings.competition))}</strong></div>
        <div><span>Roster</span><strong>TOP · JNG · MID · ADC · SUP · FLEX · ${h(String(summarySettings.bench))} BN</strong></div>`;
      const signedScore=value=>{
        const n=Number(value);
        if(!Number.isFinite(n))return "—";
        return n>0?"+"+n:String(n);
      };
      const scoringSummary=document.querySelector("#leagueScoringSummary");
      if(scoringSummary)scoringSummary.innerHTML=`
        <div><span>Kills</span><strong>${signedScore(summarySettings.scoring.kills)}</strong></div>
        <div><span>Deaths</span><strong>${signedScore(summarySettings.scoring.deaths)}</strong></div>
        <div><span>Assists</span><strong>${signedScore(summarySettings.scoring.assists)}</strong></div>
        <div><span>CS</span><strong>${signedScore(summarySettings.scoring.cs)}</strong></div>
        <div><span>Win</span><strong>${signedScore(summarySettings.scoring.win)}</strong></div>
        <div><span>First Blood</span><strong>${signedScore(summarySettings.scoring.firstBlood)}</strong></div>`;
    };
    renderLeagueSettingsSummary(settings);

    if(!getActiveLeagueId()){
      if(overviewCard)overviewCard.hidden=true;
      if(activeLeagueEntryCard)activeLeagueEntryCard.hidden=true;
      if(managerReadiness)managerReadiness.hidden=true;
      if(quickAccess)quickAccess.hidden=true;
      if(rulesModal)rulesModal.hidden=true;
    }

    (async()=>{
      if(!cloudReady()){
        if(overviewCard)overviewCard.hidden=true;
        if(managerReadiness)managerReadiness.hidden=true;
        if(quickAccess)quickAccess.hidden=true;
        if(rulesModal)rulesModal.hidden=true;
        if(cloudList)cloudList.hidden=true;
        cloudCard?.classList.add("empty-league-mode");
        cloudTitle.textContent="League";
        cloudCopy.textContent="Create, join, or play with AI managers.";
        return;
      }

      const b=backend();
      const user=await b.currentUser().catch(()=>null);
      if(!user){
        render("login",{replace:true});
        return;
      }

      const applyLeaguePermissions=async(activeId)=>{
        const controls=document.querySelectorAll(".commissioner-only");
        controls.forEach(el=>el.hidden=true);
        if(!activeId)return;
        try{
          const members=await b.listLeagueMembers(activeId);
          const mine=members.find(m=>String(m.user_id)===String(user.id));
          controls.forEach(el=>el.hidden=mine?.role!=="owner");
        }catch{
          controls.forEach(el=>el.hidden=true);
        }
      };

      const renderCompletedLeagueCard=async completedLeagues=>{
        if(!completedLeaguesCard||!completedLeagueList)return;
        completedLeaguesCard.hidden=completedLeagues.length===0;
        if(completedLeagueCount)completedLeagueCount.textContent=String(completedLeagues.length);
        if(!completedLeagues.length){
          completedLeaguesCard.open=false;
          completedLeagueList.innerHTML="";
          if(completedLeagueReviewPanel){
            completedLeagueReviewPanel.hidden=true;
            completedLeagueReviewPanel.innerHTML="";
          }
          return;
        }

        const summaries=await Promise.all(completedLeagues.map(async league=>{
          try{
            const [standings,champion,members,bots]=await Promise.all([
              b.listLeagueStandings(league.id).catch(()=>[]),
              b.getLeagueChampion(league.id).catch(()=>null),
              b.listLeagueMembers(league.id).catch(()=>[]),
              b.listLeagueBots(league.id).catch(()=>[])
            ]);
            const mine=(standings||[]).find(s=>String(s.manager_type||"human")==="human"&&String(s.manager_id)===String(user.id));
            let championName="No Champion";
            if(champion){
              championName=(String(champion.manager_type||"human")==="bot"
                ?bots.find(x=>String(x.id)===String(champion.manager_id))?.team_name
                :members.find(x=>String(x.user_id)===String(champion.manager_id))?.team_name)||"Champion";
            }
            return {league,finish:mine?.rank?"#"+Number(mine.rank):"—",championName};
          }catch{
            return {league,finish:"—",championName:"—"};
          }
        }));
        completedLeagueList.innerHTML=summaries.map(({league,finish,championName})=>`
          <button class="league-choice-card completed-league-choice" type="button" data-review-completed-league="${h(league.id)}">
            <span class="league-choice-icon">✓</span>
            <span>
              <strong>${h(league.name)}</strong>
              <small>${h(competitionName(league.settings?.competition||""))} ${h(String(league.settings?.competitionSeason||""))} · Finish ${h(finish)} · ${h(championName)}</small>
            </span>
            <span class="league-choice-arrow">›</span>
          </button>`).join("");

        completedLeagueList.querySelectorAll("[data-review-completed-league]").forEach(btn=>{
          btn.onclick=async()=>{
            const league=completedLeagues.find(item=>String(item.id)===String(btn.dataset.reviewCompletedLeague));
            if(!league||!completedLeagueReviewPanel)return;
            completedLeaguesCard.open=true;
            completedLeagueReviewPanel.hidden=false;
            completedLeagueReviewPanel.innerHTML='<div class="empty-state"><strong>Loading completed league…</strong><small>Preparing final results.</small></div>';
            try{
              const [members,bots,rounds,draft,champion,standings,matchups,rosters]=await Promise.all([
                b.listLeagueMembers(league.id),
                b.listLeagueBots(league.id).catch(()=>[]),
                b.listFantasyRounds(league.id).catch(()=>[]),
                b.getLeagueDraft(league.id).catch(()=>null),
                b.getLeagueChampion(league.id).catch(()=>null),
                b.listLeagueStandings(league.id).catch(()=>[]),
                b.listLeagueMatchups(league.id).catch(()=>[]),
                b.listRosters(league.id).catch(()=>[])
              ]);
              const membership=members.find(m=>String(m.user_id)===String(user.id));
              const hasScoringPeriods=Array.isArray(rounds)&&rounds.length>0;
              const hasDraft=Boolean(draft&&String(draft.status||"")==="complete");
              const myStanding=(standings||[]).find(s=>String(s.manager_type||"human")==="human"&&String(s.manager_id)===String(user.id));
              const myMatchups=(matchups||[]).filter(m=>
                (String(m.home_manager_type||"human")==="human"&&String(m.home_manager_id)===String(user.id))||
                (String(m.away_manager_type||"human")==="human"&&String(m.away_manager_id)===String(user.id))
              );
              const weeklyScores=myMatchups.map(m=>String(m.home_manager_id)===String(user.id)?Number(m.home_score):Number(m.away_score)).filter(Number.isFinite);
              const bestWeek=weeklyScores.length?Math.max(...weeklyScores):null;
              const myRosterCount=(rosters||[]).filter(r=>String(r.manager_type||"human")==="human"&&String(r.user_id)===String(user.id)).length;
              const order=Array.isArray(draft?.manager_order)?draft.manager_order:[];
              const draftSlot=Math.max(-1,order.findIndex(id=>String(id)===String(user.id)));
              const championMember=champion
                ?(String(champion.manager_type||"human")==="bot"
                  ?bots.find(x=>String(x.id)===String(champion.manager_id))
                  :members.find(x=>String(x.user_id)===String(champion.manager_id)))
                :null;
              const championName=championMember?.team_name||(champion?"Champion":"No Champion");
              const championStanding=champion
                ?(standings||[]).find(s=>String(s.manager_type||"human")===String(champion.manager_type||"human")&&String(s.manager_id)===String(champion.manager_id))
                :null;
              const championRecord=championStanding
                ?((Number(championStanding.wins)||0)+"-"+(Number(championStanding.losses)||0)+"-"+(Number(championStanding.ties)||0))
                :"";
              const record=myStanding?((Number(myStanding.wins)||0)+"-"+(Number(myStanding.losses)||0)+"-"+(Number(myStanding.ties)||0)):"—";
              const finish=myStanding?.rank?"#"+Number(myStanding.rank):"—";
              const hasStandings=Array.isArray(standings)&&standings.some(s=>Number(s.completed_matchups)>0||Number(s.points_for)!==0||Number(s.wins)>0||Number(s.losses)>0||Number(s.ties)>0);
              const tools=[
                ...(hasStandings?[{view:"standings",icon:"≡",title:"Final Standings"}]:[]),
                ...(hasScoringPeriods?[{view:"matchup",icon:"⚔",title:"Season Results"}]:[]),
                {view:"team",icon:"◈",title:"Final Roster"},
                ...(hasDraft?[{view:"draft",icon:"◎",title:"Draft Results"}]:[])
              ];
              const completionCopy=hasScoringPeriods
                ?"Final results are locked."
                :"No fantasy scoring periods were played.";
              completedLeagueReviewPanel.innerHTML=`
                <div class="completed-review-head">
                  <div><div class="eyebrow">COMPLETED LEAGUE</div><h3>${h(league.name)}</h3></div>
                  <span class="status-pill">READ ONLY</span>
                </div>
                <div class="league-completion-banner completed-review-banner">
                  <strong>Season Complete</strong>
                  <small>${h(completionCopy)}</small>
                </div>
                <div class="completed-season-summary">
                  <div><small>Finish</small><strong>${h(finish)}</strong></div>
                  <div><small>Record</small><strong>${h(record)}</strong></div>
                  <div><small>PF</small><strong>${myStanding?formatFantasyPoints(myStanding.points_for):"—"}</strong></div>
                  <div><small>PA</small><strong>${myStanding?formatFantasyPoints(myStanding.points_against):"—"}</strong></div>
                  <div><small>Best Week</small><strong>${bestWeek===null?"—":formatFantasyPoints(bestWeek)}</strong></div>
                  <div><small>Draft Slot</small><strong>${draftSlot>=0?"#"+(draftSlot+1):"—"}</strong></div>
                  <div><small>Final Roster</small><strong>${h(String(myRosterCount))}</strong></div>
                </div>
                <div class="completed-champion-row"><span>Champion</span><strong>${h(championName)}${championRecord?" · "+h(championRecord):""}</strong></div>
                <div class="league-quick-grid league-hub-tools completed-review-tools">
                  ${tools.map(tool=>`<button class="league-tool-btn ${tools.length%2===1&&tool===tools[tools.length-1]?"league-tool-wide":""}" type="button" data-completed-view="${h(tool.view)}"><span class="action-icon">${tool.icon}</span><span><strong>${h(tool.title)}</strong></span><span class="league-tool-arrow" aria-hidden="true">›</span></button>`).join("")}
                </div>`;
              completedLeagueReviewPanel.querySelectorAll("[data-completed-view]").forEach(viewBtn=>{
                viewBtn.onclick=()=>{
                  render(viewBtn.dataset.completedView,{historyLeagueId:league.id});
                };
              });
            }catch(err){
              completedLeagueReviewPanel.innerHTML='<div class="empty-state cloud-error"><strong>Could not load completed league</strong><small>'+h(err.message||"Please try again.")+'</small></div>';
            }
          };
        });
      };

      try{
        const leagues=await b.listLeagues();
        const regularLeagues=leagues.filter(l=>!isSimulationLeague(l));
        const completedLeagues=regularLeagues.filter(l=>leagueLifecycleState(l)==="completed");
        const liveLeagues=regularLeagues.filter(playableLeague);
        await renderCompletedLeagueCard(completedLeagues);

        let activeId=getActiveLeagueId();
        if(activeId&&!liveLeagues.some(l=>String(l.id)===String(activeId))){
          setActiveLeagueId(null);
          activeId=null;
        }
        if(!activeId&&liveLeagues.length){
          const fallbackLeague=chooseDefaultPlayableLeague(liveLeagues);
          activeId=fallbackLeague?String(fallbackLeague.id):null;
          if(activeId){
            setActiveLeagueId(activeId);
            await loadRosterFromCloud(activeId);
          }
        }

        if(!regularLeagues.length){
          if(overviewCard)overviewCard.hidden=true;
          if(activeLeagueEntryCard)activeLeagueEntryCard.hidden=true;
          if(managerReadiness)managerReadiness.hidden=true;
          if(quickAccess)quickAccess.hidden=true;
          if(rulesModal)rulesModal.hidden=true;
          if(cloudCard)cloudCard.hidden=false;
          if(cloudList)cloudList.hidden=true;
          cloudCard?.classList.add("empty-league-mode");
          cloudTitle.textContent="Create or join a fantasy league to get started.";
          cloudCopy.textContent="Choose one of the options below.";
          if(entryActions)entryActions.classList.add("empty-league-actions");
          await applyLeaguePermissions(null);
          return;
        }

        if(!liveLeagues.length){
          setActiveLeagueId(null);
          if(overviewCard)overviewCard.hidden=true;
          if(managerReadiness)managerReadiness.hidden=true;
          if(quickAccess)quickAccess.hidden=true;
          if(rulesModal)rulesModal.hidden=true;
          if(activeLeagueEntryCard){
            activeLeagueEntryCard.hidden=false;
            activeLeagueEntryCard.open=false;
          }
          if(cloudCard)cloudCard.hidden=true;
          await applyLeaguePermissions(null);
          return;
        }

        const memberships=await Promise.all(liveLeagues.map(async league=>{
          try{
            const members=await b.listLeagueMembers(league.id);
            return members.find(m=>String(m.user_id)===String(user.id))||null;
          }catch{return null;}
        }));
        const activeLeague=liveLeagues.find(l=>String(l.id)===String(activeId))||liveLeagues[0];
        const activeIndex=liveLeagues.findIndex(l=>String(l.id)===String(activeLeague.id));
        const activeMembership=memberships[activeIndex]||null;
        const activeSettings={
          ...defaultLeagueSettings,
          ...(activeLeague.settings||{}),
          competition:normalizeCompetitionCode(activeLeague.settings?.competition)||"worlds",
          competitionSeason:Number(activeLeague.settings?.competitionSeason)||2026,
          competitionType:competitionType(activeLeague.settings?.competition),
          scoring:{...defaultLeagueSettings.scoring,...(activeLeague.settings?.scoring||{})}
        };
        cacheLeagueSettings(activeSettings);
        renderLeagueSettingsSummary(activeSettings);

        if(overviewCard)overviewCard.hidden=false;
        if(activeLeagueEntryCard){
          activeLeagueEntryCard.hidden=false;
          activeLeagueEntryCard.open=false;
        }
        if(managerReadiness)managerReadiness.hidden=false;
        if(quickAccess)quickAccess.hidden=false;
        if(rulesModal)rulesModal.hidden=true;
        if(cloudCard)cloudCard.hidden=true;
        cloudCard?.classList.remove("empty-league-mode");
        if(entryActions)entryActions.classList.remove("empty-league-actions");

        const overviewStatus=String(activeLeague.status||"pre_draft");
        const overviewEyebrow=document.querySelector("#leagueOverviewEyebrow");
        const completionBanner=document.querySelector("#leagueCompletionBanner");
        const completionTitle=document.querySelector("#leagueCompletionTitle");
        const completionCopy=document.querySelector("#leagueCompletionCopy");
        document.querySelector("#leagueOverviewName").textContent=activeLeague.name;
        document.querySelector("#leagueOverviewTeam").textContent=activeMembership?.team_name||"Your team";
        document.querySelector("#leagueOverviewRole").textContent=activeMembership?.role==="owner"?"Commissioner":"Manager";
        document.querySelector("#leagueOverviewInvite").textContent=activeLeague.invite_code||"—";
        if(overviewEyebrow)overviewEyebrow.textContent=overviewStatus==="completed"?"COMPLETED LEAGUE":"ACTIVE LEAGUE";
        if(completionBanner){
          completionBanner.hidden=overviewStatus!=="completed";
          if(overviewStatus==="completed"){
            const hadGames=activeLeague.settings?.seasonHadGames!==false;
            if(completionTitle)completionTitle.textContent="Season Complete";
            if(completionCopy)completionCopy.textContent=hadGames
              ? competitionName(activeSettings.competition)+" is complete. Rosters and transactions are locked."
              : competitionName(activeSettings.competition)+" ended before this fantasy league had any scoring periods. No champion was awarded.";
          }
        }
        try{
          const [playoffs,champion,membersNow,botsNow,roundsNow,draftNow]=await Promise.all([
            b.listPlayoffs(activeId),b.getLeagueChampion(activeId),
            b.listLeagueMembers(activeId),b.listLeagueBots(activeId),
            b.listFantasyRounds(activeId).catch(()=>[]),b.getLeagueDraft(activeId).catch(()=>null)
          ]);
          const managerName=function(id,type){
            if(type==="bot")return botsNow.find(x=>String(x.id)===String(id))?.team_name||"Bot Manager";
            return membersNow.find(x=>String(x.user_id)===String(id))?.team_name||"Manager";
          };
          const activeLifecycle=leagueLifecycleConfig(activeLeague,{playoffs});
          if(overviewEyebrow){
            overviewEyebrow.textContent=activeLifecycle.state==="playoffs"?"PLAYOFFS":activeLifecycle.label.toUpperCase()+" LEAGUE";
          }
          const expectedManagers=Math.max(1,Number(activeSettings.managers)||membersNow.length+botsNow.length||1);
          const humanManagers=membersNow.length;
          const botManagers=botsNow.length;
          const readyManagers=humanManagers+botManagers;
          const readinessCount=document.querySelector("#leagueManagerReadinessCount");
          const readinessTitle=document.querySelector("#leagueManagerReadinessTitle");
          const readinessCopy=document.querySelector("#leagueManagerReadinessCopy");
          const readinessBar=document.querySelector("#leagueManagerProgressBar");
          const readinessBtn=managerReadiness?.querySelector(".league-manager-draft-btn");
          if(readinessCount)readinessCount.textContent=readyManagers+" / "+expectedManagers;
          if(readinessBar)readinessBar.style.width=Math.min(100,(readyManagers/expectedManagers)*100)+"%";
          const managerBreakdown=botManagers
            ? humanManagers+" human · "+botManagers+" bot"+(botManagers===1?"":"s")
            : humanManagers+" human manager"+(humanManagers===1?"":"s");
          const leagueStatus=activeLifecycle.state;
          if(inviteField)inviteField.hidden=false;
          if(toolsEyebrow)toolsEyebrow.textContent=leagueStatus==="playoffs"?"POSTSEASON":"LEAGUE TOOLS";
          if(toolsTitle)toolsTitle.textContent=leagueStatus==="pre_draft"
            ?"Prepare for the draft"
            :leagueStatus==="drafting"
              ?"Draft in progress"
              :leagueStatus==="playoffs"
                ?"Playoffs"
                :"Manage this league";

          const draftComplete=Boolean(draftNow&&String(draftNow.status||"")==="complete");
          const activeTools=(leagueStatus==="pre_draft"||leagueStatus==="drafting")
            ?[{view:"draft",icon:"◎",title:"Draft Room"}]
            :[
                {view:"team",icon:"◈",title:"My Team"},
                {view:"matchup",icon:"⚔",title:"Matchup"},
                {view:"standings",icon:"≡",title:"Standings"},
                ...(draftComplete?[{view:"draft",icon:"◎",title:"Draft Results"}]:[]),
                {view:"transactions",icon:"↕",title:"Transactions"}
              ];
          if(toolsGrid){
            toolsGrid.innerHTML=activeTools.map(tool=>`<button class="league-tool-btn ${activeTools.length%2===1&&tool===activeTools[activeTools.length-1]?"league-tool-wide":""}" data-jump="${h(tool.view)}"><span class="action-icon">${tool.icon}</span><span><strong>${h(tool.title)}</strong></span><span class="league-tool-arrow" aria-hidden="true">›</span></button>`).join("");
            toolsGrid.querySelectorAll("[data-jump]").forEach(btn=>{btn.onclick=()=>render(btn.dataset.jump);});
          }
          if(readinessTitle&&readinessCopy){
            if(leagueStatus==="pre_draft"&&readyManagers>=expectedManagers){
              readinessTitle.textContent="✓ All "+expectedManagers+" managers have joined";
              readinessCopy.textContent="Draft Room Ready · "+managerBreakdown;
              managerReadiness?.classList.add("ready");
            }else if(leagueStatus==="pre_draft"){
              const remaining=Math.max(0,expectedManagers-readyManagers);
              readinessTitle.textContent=readyManagers+" / "+expectedManagers+" managers joined";
              readinessCopy.textContent="Waiting for "+remaining+" more manager"+(remaining===1?"":"s")+" · "+managerBreakdown;
              managerReadiness?.classList.remove("ready");
            }else if(leagueStatus==="drafting"){
              readinessTitle.textContent="Draft in progress";
              readinessCopy.textContent=readyManagers+" / "+expectedManagers+" managers ready · "+managerBreakdown;
              managerReadiness?.classList.add("ready");
            }else{
              readinessTitle.textContent="Draft complete";
              readinessCopy.textContent=readyManagers+" / "+expectedManagers+" managers · "+managerBreakdown;
              managerReadiness?.classList.add("ready");
            }
          }
          if(managerReadiness)managerReadiness.hidden=leagueStatus==="active"||leagueStatus==="completed";
          if(readinessBtn)readinessBtn.textContent=leagueStatus==="active"?"View Draft Board":"Open Draft Room";
          const playoffCard=document.querySelector("#leaguePlayoffCard");
          const playoffContent=document.querySelector("#leaguePlayoffContent");
          if(playoffCard&&playoffContent&&(playoffs.length||champion)){
            playoffCard.hidden=false;
            const pill=document.querySelector("#leagueChampionPill");
            if(champion){
              pill.textContent="CHAMPION";
              const championName=managerName(champion.manager_id,champion.manager_type);
              playoffContent.innerHTML='<div class="champion-banner"><strong>🏆 '+h(championName)+'</strong><small>League Champion · Seed #'+h(champion.seed||"—")+'</small></div>';
              if(overviewStatus==="completed"&&completionCopy)completionCopy.textContent=competitionName(activeSettings.competition)+" is complete · Champion: "+championName+".";
            }else{
              playoffContent.innerHTML=playoffs.map(function(x){return '<div class="playoff-row"><div><strong>'+h(x.stage==="championship"?"Championship":"Semifinal "+x.bracket_slot)+'</strong><small>Seed '+h(x.home_seed??"—")+' vs Seed '+h(x.away_seed??"—")+'</small></div><div><strong>'+formatFantasyPoints(x.home_score)+' - '+formatFantasyPoints(x.away_score)+'</strong><small>'+h(String(x.status||"upcoming").toUpperCase())+'</small></div></div>';}).join("");
            }
          }
        }catch{}

        const rulesToggle=document.querySelector("#leagueRulesToggle");
        const closeRules=()=>{
          if(!rulesModal||rulesModal.hidden)return;
          rulesModal.hidden=true;
          document.body.classList.remove("modal-open");
          rulesToggle?.setAttribute("aria-expanded","false");
          rulesToggle?.focus?.();
        };
        const openRules=()=>{
          if(!rulesModal)return;
          rulesModal.hidden=false;
          document.body.classList.add("modal-open");
          rulesToggle?.setAttribute("aria-expanded","true");
          rulesModal.querySelector("[data-close-league-rules]")?.focus?.();
        };
        if(rulesToggle)rulesToggle.onclick=openRules;
        rulesModal?.querySelectorAll("[data-close-league-rules]").forEach(el=>el.onclick=closeRules);
        if(rulesModal)rulesModal.onkeydown=e=>{if(e.key==="Escape")closeRules();};

        const switchRow=document.querySelector("#leagueSwitchRow");
        const switcher=document.querySelector("#leagueSwitcherSelect");
        if(switchRow&&switcher){
          switchRow.hidden=liveLeagues.length<2;
          switcher.innerHTML=liveLeagues.map(l=>'<option value="'+h(l.id)+'" '+(String(l.id)===String(activeId)?"selected":"")+'>'+h(l.name)+'</option>').join("");
          switcher.onchange=async()=>{
            if(String(switcher.value)===String(getActiveLeagueId()))return;
            setActiveLeagueId(switcher.value);
            const loaded=await loadRosterFromCloud(switcher.value);
            showToast(loaded?"League switched · roster loaded":"League switched");
            render("league",{replace:true});
          };
        }

        await applyLeaguePermissions(activeId);
        if(String(activeLeague.status||"")==="completed"&&commissionerBtn)commissionerBtn.hidden=true;
      }catch(err){
        if(overviewCard)overviewCard.hidden=true;
        if(quickAccess)quickAccess.hidden=true;
        if(rulesModal)rulesModal.hidden=true;
        if(cloudCard)cloudCard.hidden=false;
        if(cloudList)cloudList.hidden=true;
        cloudTitle.textContent="Could not load leagues";
        if(cloudCopy){
          cloudCopy.textContent=err.message||"A network or league-service error occurred.";
          cloudCopy.hidden=false;
        }
      }
    })();

  }
  if(view==="draft"){
    if(draftTimerId){clearInterval(draftTimerId);draftTimerId=null;}
    const leagueId=getLeagueContextId();
    mockDraftPoolOverride=null;
    const liveState=document.querySelector("#draftLiveState");
    const completeState=document.querySelector("#draftCompleteState");
    const pageEyebrow=document.querySelector("#draftPageEyebrow");
    const exitBtn=document.querySelector("#draftExitBtn");
    const search=document.querySelector("#draftSearch");
    const list=document.querySelector("#draftPlayerList");
    const fullBoard=document.querySelector("#fullDraftBoard");
    const completedFullBoard=document.querySelector("#completedFullDraftBoard");
    const completedFullBoardCard=document.querySelector("#completedFullBoardCard");
    const completedPickList=document.querySelector("#completedDraftPickList");
    const rosterEl=document.querySelector("#myDraftRoster");
    const startBtn=document.querySelector("#startDraftBtn");
    const refreshBtn=document.querySelector("#refreshDraftBtn");
    const openCompletedBoardBtn=document.querySelector("#openCompletedDraftBoard");
    const closeCompletedBoardBtn=document.querySelector("#closeCompletedDraftBoard");
    const completeTeamBtn=document.querySelector("#draftCompleteTeamBtn");
    const completeTeamBtnLabel=document.querySelector("#draftCompleteTeamBtnLabel");
    const completedListEyebrow=document.querySelector("#completedDraftListEyebrow");
    const completedListTitle=document.querySelector("#completedDraftListTitle");
    const completedListHint=document.querySelector("#completedDraftListHint");
    let role="ALL";
    let currentUser=null;
    let members=[];
    let bots=[];
    let memberById=new Map();
    let draft=null;
    let picks=[];
    let botPickPending=false;

    const managerForPick=(pickIndex,order)=>{
      const count=order.length;
      if(!count)return null;
      const round=Math.floor(pickIndex/count);
      const within=pickIndex%count;
      const pos=round%2===0?within:count-1-within;
      return order[pos]||null;
    };

    const wireProfileRows=root=>{
      root?.querySelectorAll("[data-open-player]").forEach(row=>{
        row.onclick=e=>{
          if(e.target.closest(".draft-btn"))return;
          openPlayer(row.dataset.openPlayer,"draft");
        };
        row.onkeydown=e=>{
          if(e.key!=="Enter"&&e.key!==" ")return;
          if(e.target.closest(".draft-btn"))return;
          e.preventDefault();
          openPlayer(row.dataset.openPlayer,"draft");
        };
      });
    };

    const renderBoard=(target,draftData,pickRows)=>{
      if(!target)return;
      const historicalBoard=!!historicalLeagueContextId;
      if(draftData?.manager_order?.length){
        const headers=draftData.manager_order.map(uid=>`<div class="board-head">${h(memberById.get(String(uid))?.team_name||"Manager")}</div>`).join("");
        let cells="";
        const total=(draftData.total_rounds||0)*draftData.manager_order.length;
        for(let i=0;i<total;i++){
          const uid=managerForPick(i,draftData.manager_order);
          const pick=pickRows.find(p=>Number(p.pick_number)===i+1);
          const player=pick?draftPool.find(x=>String(x.id)===String(pick.player_id)):null;
          cells+=`<div class="board-cell ${String(uid)===String(currentUser.id)?"mine":""} ${draftData.status==="drafting"&&i===Number(draftData.current_pick)?"on-clock":""}" ${player&&!historicalBoard?`data-open-player="${h(player.id)}" tabindex="0" role="button" aria-label="View ${h(player.name)} details"`:""}><small>R${Math.floor(i/draftData.manager_order.length)+1} · #${i+1}</small><strong>${h(player?.name||"—")}</strong><span>${h(memberById.get(String(uid))?.team_name||"")}</span></div>`;
        }
        target.innerHTML=`<div class="full-board-grid" style="grid-template-columns:repeat(${draftData.manager_order.length},minmax(92px,1fr))">${headers}${cells}</div>`;
        if(!historicalBoard)wireProfileRows(target);
      }else{
        target.innerHTML='<div class="muted">The draft board will appear when the commissioner starts the draft.</div>';
      }
    };

    const renderCompletedState=(draftData,mine,league)=>{
      liveState.hidden=true;
      completeState.hidden=false;
      const historical=String(league?.status||"")==="completed"&&!!historicalLeagueContextId;
      if(pageEyebrow)pageEyebrow.textContent=historical?"DRAFT RESULTS · READ ONLY":"DRAFT SUMMARY";
      if(exitBtn)exitBtn.hidden=true;
      const order=draftData.manager_order||[];
      const position=Math.max(0,order.findIndex(id=>String(id)===String(currentUser.id)))+1;
      document.querySelector("#draftRecapRounds").textContent=String(draftData.total_rounds||0);
      document.querySelector("#draftRecapPosition").textContent=position>0?"#"+position:"—";
      document.querySelector("#draftRecapPlayers").textContent=String(mine.length);

      if(historical){
        const hero=completeState.querySelector(".draft-complete-hero");
        const heroEyebrow=hero?.querySelector(".eyebrow");
        const heroTitle=hero?.querySelector("h2");
        const heroCopy=hero?.querySelector("p");
        if(heroEyebrow)heroEyebrow.textContent="FINAL DRAFT";
        if(heroTitle)heroTitle.textContent="Draft Results";
        if(heroCopy)heroCopy.textContent="The draft is complete. Review every recorded selection from this finished league.";
        if(openCompletedBoardBtn)openCompletedBoardBtn.hidden=true;
        if(completeTeamBtnLabel)completeTeamBtnLabel.textContent="View Final Rosters";
        if(completeTeamBtn){
          completeTeamBtn.removeAttribute("data-jump");
          completeTeamBtn.onclick=()=>render("team",{historyLeagueId:leagueId});
        }
        if(completedListEyebrow)completedListEyebrow.textContent="LEAGUE DRAFT RESULTS";
        if(completedListTitle)completedListTitle.textContent="Every pick";
        if(completedListHint)completedListHint.textContent="Final draft order · read only";
        const ordered=picks.slice().sort((a,b)=>Number(a.pick_number)-Number(b.pick_number));
        completedPickList.innerHTML=ordered.length?ordered.map(p=>{
          const player=draftPool.find(x=>String(x.id)===String(p.player_id));
          const manager=memberById.get(String(p.user_id));
          return `<div class="completed-pick-row"><span class="completed-pick-round">R${h(p.round_number)}</span><div class="completed-pick-info"><strong>${h(player?.name||p.player_id)}</strong><small>${h(manager?.team_name||"Manager")} · ${h(player?.team||p.role||"")}</small></div><div class="completed-pick-number"><small>Pick</small><strong>#${h(p.pick_number)}</strong></div></div>`;
        }).join(""):'<div class="muted">No draft picks were recorded for this league.</div>';
      }else{
        if(openCompletedBoardBtn)openCompletedBoardBtn.hidden=false;
        if(league?.settings?.simulation){
          if(completeTeamBtnLabel)completeTeamBtnLabel.textContent="Back to Creator Lab";
          if(completeTeamBtn){
            completeTeamBtn.removeAttribute("data-jump");
            completeTeamBtn.onclick=()=>render("creator-lab");
          }
        }else if(completeTeamBtnLabel)completeTeamBtnLabel.textContent="View My Team";
        if(completedListEyebrow)completedListEyebrow.textContent="YOUR DRAFT";
        if(completedListTitle)completedListTitle.textContent="Your picks";
        if(completedListHint)completedListHint.textContent="Tap a player for details.";
        completedPickList.innerHTML=mine.length?mine
          .slice()
          .sort((x,y)=>Number(x.pick_number)-Number(y.pick_number))
          .map(p=>{
            const player=draftPool.find(x=>String(x.id)===String(p.player_id));
            return `<div class="completed-pick-row clickable" data-open-player="${h(p.player_id)}" tabindex="0" role="button" aria-label="View ${h(player?.name||p.player_id)} details"><span class="completed-pick-round">R${h(p.round_number)}</span><div class="completed-pick-info"><strong>${h(player?.name||p.player_id)}</strong><small>${h(player?.team||p.role||"")}</small></div><div class="completed-pick-number"><small>Pick</small><strong>#${h(p.pick_number)}</strong></div><span class="completed-pick-chevron" aria-hidden="true">›</span></div>`;
          }).join("")
          :'<div class="muted">No picks were recorded for your team.</div>';
        wireProfileRows(completedPickList);
      }
      renderBoard(completedFullBoard,draftData,picks);
      if(historical&&completedFullBoardCard)completedFullBoardCard.hidden=false;
    };

    const refresh=async()=>{
      if(!leagueId||!cloudReady()){
        completeState.hidden=true;
        liveState.hidden=false;
        document.querySelector("#draftTurnLabel").textContent="Join a league first";
        document.querySelector("#draftHint").textContent="The live Draft Room belongs to your active online league.";
        startBtn.hidden=true;
        list.innerHTML='<div class="empty-state"><strong>No active league</strong><small>Go to League to create or join one.</small></div>';
        return;
      }
      try{
        const b=backend();
        currentUser=currentUser||await b.currentUser();
        const leagues=await b.listLeagues();
        const league=leagues.find(l=>String(l.id)===String(leagueId));
        const leagueCompetition=normalizeCompetitionCode(league?.settings?.competition)||"worlds";
        if(league?.settings?.simulation===true){
          const rows=await b.listMockDraftPool(leagueId);
          mockDraftPoolOverride=(Array.isArray(rows)?rows:[]).map(p=>({
            ...p,
            teamCode:p.team_code??p.teamCode,
            teamId:p.team_id??p.teamId,
            rosterStatus:"starter",
            fp:Number(p.fp??20)
          }));
        }else{
          mockDraftPoolOverride=null;
        }
        const draftStatusRows=league?.settings?.simulation===true
          ?[]
          :await b.listPlayerCompetitionStatus(leagueCompetition).catch(()=>[]);
        cacheCompetitionStatuses(leagueCompetition,draftStatusRows);
        members=await b.listLeagueMembers(leagueId);
        bots=await b.listLeagueBots(leagueId);
        memberById=new Map([
          ...members.map(m=>[String(m.user_id),m]),
          ...bots.map(bot=>[String(bot.id),{user_id:bot.id,team_name:bot.team_name,role:"bot",manager_type:"bot",difficulty:bot.difficulty}])
        ]);
        draft=await b.getLeagueDraft(leagueId);
        picks=await b.listDraftPicks(leagueId);
        const me=memberById.get(String(currentUser.id));
        document.querySelector("#draftMyTeamName").textContent=me?.team_name||"My Team";

        const mine=picks.filter(p=>String(p.user_id)===String(currentUser.id));
        if(draft?.status==="complete"){
          renderCompletedState(draft,mine,league);
          if(league?.status!=="completed")await loadRosterFromCloud(leagueId);
          if(draftTimerId){clearInterval(draftTimerId);draftTimerId=null;}
          return;
        }

        completeState.hidden=true;
        liveState.hidden=false;
        if(pageEyebrow)pageEyebrow.textContent="LIVE LEAGUE DRAFT";
        if(exitBtn)exitBtn.hidden=false;
        if(completedFullBoardCard)completedFullBoardCard.hidden=true;

        const owner=me?.role==="owner";
        const expected=Number(league?.settings?.managers)||(members.length+bots.length);
        const presentManagers=members.length+bots.length;
        startBtn.hidden=!(owner && (!draft||draft.status!=="drafting") && league?.status==="pre_draft");
        startBtn.disabled=presentManagers!==expected;
        startBtn.textContent=presentManagers===expected?"Start Draft":`Waiting for ${expected-presentManagers} Manager${expected-presentManagers===1?"":"s"}`;

        if(!draft){
          document.querySelector("#draftRoundLabel").textContent="PRE-DRAFT";
          document.querySelector("#draftTurnLabel").textContent=presentManagers===expected?"League is ready":"Waiting for managers";
          document.querySelector("#draftHint").textContent=owner
            ?"Start the draft once every manager has joined."
            :"The commissioner will start the draft when the league is ready.";
          document.querySelector("#draftClock").textContent="—";
        }else{
          const order=draft.manager_order||[];
          const currentManager=managerForPick(Number(draft.current_pick)||0,order);
          const currentMember=memberById.get(String(currentManager));
          const currentIsBot=currentMember?.role==="bot"||currentMember?.manager_type==="bot";
          const round=Math.floor((Number(draft.current_pick)||0)/Math.max(1,order.length))+1;
          document.querySelector("#draftRoundLabel").textContent=`ROUND ${round} · PICK ${Number(draft.current_pick||0)+1}`;
          document.querySelector("#draftTurnLabel").textContent=String(currentManager)===String(currentUser.id)?"You're on the clock":`${currentMember?.team_name||"Another manager"}${currentIsBot?" 🤖":""} is on the clock`;
          document.querySelector("#draftHint").textContent="Picks sync across every manager's device.";
          document.querySelector("#draftClock").textContent=draft.status==="drafting"?"LIVE":"—";
          const botOnClock=currentIsBot&&draft.status==="drafting";
          if(botOnClock&&!botPickPending){
            botPickPending=true;
            setTimeout(async()=>{
              try{await b.makeBotDraftPick(leagueId);}catch(err){console.warn("Bot draft pick:",err.message||err);}
              finally{botPickPending=false;void refresh();}
            },850);
          }
        }

        const taken=new Set(picks.map(p=>String(p.player_id)));
        const q=search.value.trim().toLowerCase();
        const myTurn=league?.status==="drafting"&&draft?.status==="drafting"&&String(managerForPick(Number(draft.current_pick)||0,draft.manager_order||[]))===String(currentUser.id);
        const assignedMine=draftAssignments(mine);
        const activeDraftSettings={
          ...defaultLeagueSettings,
          ...(league?.settings||{}),
          scoring:{...defaultLeagueSettings.scoring,...(league?.settings?.scoring||{})}
        };
        const draftValidation=validateRoster(assignedMine,activeDraftSettings);
        const draftStatus=document.querySelector("#draftRosterStatus");
        const draftStatusTitle=document.querySelector("#draftRosterStatusTitle");
        const draftStatusCopy=document.querySelector("#draftRosterStatusCopy");
        if(draftStatus&&draftStatusTitle&&draftStatusCopy){
          draftStatus.classList.toggle("complete",draftValidation.isComplete);
          draftStatus.classList.toggle("incomplete",!draftValidation.isComplete);
          draftStatusTitle.textContent=draftValidation.isComplete?"✓ Roster Complete":"⚠ Roster Incomplete";
          draftStatusCopy.textContent=draftValidation.isComplete?"Your draft roster is legal and complete.":`Roster needs: ${rosterStatusText(draftValidation).replace(/^You still need:\s*/,"")}`;
        }

        const picksRemaining=Math.max(0,Number(draft?.total_rounds||0)-mine.length);
        const missingRoleSet=new Set(draftValidation.missingStarterPositions);
        const mustFillMissingRole=picksRemaining<=missingRoleSet.size;

        const filtered=eligibleDraftPool(activeDraftSettings).filter(p=>!taken.has(String(p.id))&&(role==="ALL"||p.role===role)&&(`${p.name} ${p.team} ${p.role}`.toLowerCase().includes(q)));
        list.innerHTML=filtered.map(p=>{
          const blockedForCompletion=myTurn&&mustFillMissingRole&&!missingRoleSet.has(p.role);
          const disabled=!myTurn||blockedForCompletion;
          const label=blockedForCompletion?"NEED ROLE":"DRAFT";
          return `<div class="player-row draft-player clickable" data-open-player="${h(p.id)}" tabindex="0" role="button" aria-label="View ${h(p.name)} details"><span class="role-badge">${h(p.role)}</span><div class="player-info"><strong>${h(p.name)}</strong><small>${h(p.team)}</small></div><button class="draft-btn" data-player-id="${h(p.id)}" ${disabled?"disabled":""}>${label}</button></div>`;
        }).join("")||'<div class="empty-state"><strong>No available players</strong><small>Try another role or search.</small></div>';

        list.querySelectorAll("[data-player-id]").forEach(btn=>btn.onclick=async e=>{
          e.stopPropagation();
          const player=draftPool.find(p=>String(p.id)===String(btn.dataset.playerId));
          if(!player)return;
          btn.disabled=true;
          try{
            await b.makeDraftPick(leagueId,player.id,player.role);
            await refresh();
          }catch(err){showToast(err.message||"Could not make draft pick");await refresh();}
        });
        wireProfileRows(list);
        renderBoard(fullBoard,draft,picks);

        rosterEl.innerHTML=assignedMine.length?assignedMine.map(p=>{
          const player=draftPool.find(x=>String(x.id)===String(p.player_id));
          return `<div class="draft-roster-slot filled-start"><small>${h(p.slot)}</small><strong>${h(player?.name||p.player_id)}</strong></div>`;
        }).join(""):'<div class="muted">Your picks will appear here.</div>';
      }catch(err){
        completeState.hidden=true;
        liveState.hidden=false;
        if(pageEyebrow)pageEyebrow.textContent="LIVE LEAGUE DRAFT";
        if(exitBtn)exitBtn.hidden=false;
        document.querySelector("#draftTurnLabel").textContent="Draft unavailable";
        document.querySelector("#draftHint").textContent=err.message||"Could not load the draft.";
      }
    };

    startBtn.onclick=async()=>{
      startBtn.disabled=true;
      try{await backend().startLeagueDraft(leagueId);showToast("Live draft started");await refresh();}
      catch(err){showToast(err.message||"Could not start draft");await refresh();}
    };
    refreshBtn.onclick=refresh;
    search.oninput=refresh;
    document.querySelectorAll("[data-draft-role]").forEach(c=>c.onclick=()=>{
      role=c.dataset.draftRole;
      document.querySelectorAll("[data-draft-role]").forEach(x=>x.classList.toggle("active",x===c));
      refresh();
    });
    if(openCompletedBoardBtn)openCompletedBoardBtn.onclick=()=>{
      completedFullBoardCard.hidden=false;
      completedFullBoardCard.scrollIntoView({behavior:"smooth",block:"start"});
    };
    if(closeCompletedBoardBtn)closeCompletedBoardBtn.onclick=()=>{
      completedFullBoardCard.hidden=true;
      openCompletedBoardBtn?.focus();
    };

    void refresh();
    draftTimerId=setInterval(refresh,3000);
  }

  if(view==="create-league"){
    if(!cloudReady()){
      showToast("League services are unavailable.");
      render("league",{replace:true});
    }else{
      const managerSelect=document.querySelector("#createManagerCount");
      const benchSelect=document.querySelector("#createBenchCount");
      const competition=document.querySelector("#createCompetition");
      const nameInput=document.querySelector("#createLeagueName");
      const teamInput=document.querySelector("#createTeamName");
      const createBtn=document.querySelector("#confirmCreateLeagueBtn");
      const defaults=getLeagueSettings();
      competition.value=normalizeCompetitionCode(defaults.competition)||"lcs";
      if(competitionCapacity(competition.value,benchSelect.value).maxManagers<1)competition.value="lcs";
      const competitionHelp=document.querySelector("#createCompetitionHelp");
      const capacityHelp=document.querySelector("#createManagerCapacityHelp");
      const capacityCard=document.querySelector("#createPoolCapacity");
      const updateCreateCapacity=()=>{
        const cap=competitionCapacity(competition.value,benchSelect.value);
        if(competitionHelp)competitionHelp.textContent=competitionHelpText(competition.value);
        if(capacityHelp)capacityHelp.textContent=capacityMessage(competition.value,benchSelect.value);
        if(capacityCard)capacityCard.innerHTML=cap.maxManagers
          ? `<strong>${cap.maxManagers} max managers</strong><small>${cap.poolSize} eligible draftable players · ${cap.rosterSize} roster spots per team</small>`
          : `<strong>Draft unavailable</strong><small>No complete eligible ${competitionName(competition.value)} player pool is available yet.</small>`;
        document.querySelectorAll("[data-create-managers]").forEach(btn=>{
          const value=Number(btn.dataset.createManagers);
          btn.disabled=value>cap.maxManagers||cap.maxManagers<1;
          btn.classList.toggle("capacity-disabled",btn.disabled);
        });
        const current=Number(managerSelect.value)||1;
        if(cap.maxManagers>0&&current>cap.maxManagers)managerSelect.value=String(cap.maxManagers);
        if(cap.maxManagers<1)managerSelect.value="";
        document.querySelectorAll("[data-create-managers]").forEach(btn=>btn.classList.toggle("active",Number(btn.dataset.createManagers)===Number(managerSelect.value)));
        createBtn.disabled=cap.maxManagers<1;
      };
      competition.addEventListener("change",updateCreateCapacity);
      benchSelect.addEventListener("change",updateCreateCapacity);
      document.querySelectorAll("[data-create-managers]").forEach(btn=>btn.onclick=()=>{
        if(btn.disabled)return;
        managerSelect.value=btn.dataset.createManagers;
        document.querySelectorAll("[data-create-managers]").forEach(x=>x.classList.toggle("active",x===btn));
      });
      updateCreateCapacity();
      void applyCompetitionScheduleAvailability(competition,updateCreateCapacity);

      createBtn.onclick=async()=>{
        const name=nameInput.value.trim();
        const teamName=teamInput.value.trim();
        if(!name)return showToast("Enter a league name.");
        if(!teamName)return showToast("Enter your team name.");
        const capacity=competitionCapacity(competition.value,benchSelect.value);
        if(capacity.maxManagers<1)return showToast(`${competitionName(competition.value)} is not open for fantasy drafting yet.`);
        if(Number(managerSelect.value)>capacity.maxManagers)return showToast(`This ${competitionName(competition.value)} league supports up to ${capacity.maxManagers} managers with the current roster size.`);

        const numberOr=(id,fallback)=>{const n=Number(document.querySelector(id).value);return Number.isFinite(n)?n:fallback;};
        const next={
          ...defaultLeagueSettings,
          name,
          managers:managerSelect.value,
          bench:benchSelect.value,
          draftType:"Snake",
          scoringFormat:"Head-to-head",
          competition:normalizeCompetitionCode(competition.value)||"worlds",
          competitionSeason:2026,
          competitionType:competitionType(competition.value),
          teamSlot:false,
          waivers:document.querySelector("#leagueWaivers")?.checked!==false,
          trades:document.querySelector("#leagueTrades")?.checked!==false,
          tradeReview:document.querySelector("#leagueTradeReview")?.checked===true,
          scoring:{
            kills:numberOr("#createScoreKills",defaultLeagueSettings.scoring.kills),
            deaths:numberOr("#createScoreDeaths",defaultLeagueSettings.scoring.deaths),
            assists:numberOr("#createScoreAssists",defaultLeagueSettings.scoring.assists),
            cs:numberOr("#createScoreCs",defaultLeagueSettings.scoring.cs),
            win:numberOr("#createScoreWin",defaultLeagueSettings.scoring.win),
            firstBlood:numberOr("#createScoreFb",defaultLeagueSettings.scoring.firstBlood)
          }
        };

        createBtn.disabled=true;
        try{
          const b=backend();
          const created=await b.createLeague(name,next);
          const league=Array.isArray(created)?created[0]:created;
          if(!league?.id)throw new Error("League was not created.");
          await b.updateTeamName(league.id,teamName);
          setActiveLeagueId(league.id);
          cacheLeagueSettings(next)
          showToast("League created"+(league.invite_code?": "+league.invite_code:""));
          render("league",{replace:true});
        }catch(err){
          showToast(err.message||"Could not create league");
          createBtn.disabled=false;
        }
      };
    }
  }

  if(view==="join-league"){
    if(!cloudReady()){
      showToast("League services are unavailable.");
      render("league",{replace:true});
    }else{
      const code=document.querySelector("#joinLeagueCode");
      const team=document.querySelector("#joinLeagueTeamName");
      const joinBtn=document.querySelector("#confirmJoinLeagueBtn");
      const update=()=>{joinBtn.disabled=!(code.value.trim()&&team.value.trim());};
      code.addEventListener("input",update);
      team.addEventListener("input",update);
      update();

      joinBtn.onclick=async()=>{
        const inviteCode=code.value.trim();
        const teamName=team.value.trim();
        if(!inviteCode)return showToast("Enter an invite code.");
        if(!teamName)return showToast("Enter your team name.");
        joinBtn.disabled=true;
        try{
          const joined=await backend().joinLeague(inviteCode,teamName);
          const leagueId=Array.isArray(joined)?joined[0]?.league_id:joined?.league_id;
          if(!leagueId)throw new Error("League could not be joined.");
          setActiveLeagueId(leagueId);
          await loadRosterFromCloud(leagueId);
          showToast("League joined");
          render("league",{replace:true});
        }catch(err){
          showToast(err.message||"Could not join league");
          joinBtn.disabled=false;
        }
      };
    }
  }

  if(view==="bot-league"){
    const stored=(()=>{try{return JSON.parse(sessionStorage.getItem("riftBotLeagueSetup")||"{}");}catch{return {};}})();
    let total=Number(stored.totalManagers)||4;
    let humans=Number(stored.humanManagers)||1;
    let difficulty=stored.difficulty||"competitive";
    const competition=document.querySelector("#botSetupCompetition");
    competition.value=normalizeCompetitionCode(stored.competition)||"lcs";
    if(competitionCapacity(competition.value,1).maxManagers<1)competition.value="lcs";
    const botCountEl=document.querySelector("#botManagerCount");
    const capacityEl=document.querySelector("#botPoolCapacity");
    const competitionHelp=document.querySelector("#botSetupCompetitionHelp");
    const nextBtn=document.querySelector("#botSetupNext");
    const update=()=>{
      const cap=competitionCapacity(competition.value,1);
      if(total>cap.maxManagers&&cap.maxManagers>0)total=cap.maxManagers;
      if(cap.maxManagers<1)total=0;
      humans=Math.min(humans,total||1);
      document.querySelectorAll("[data-bot-size]").forEach(btn=>{
        const value=Number(btn.dataset.botSize);
        btn.disabled=value>cap.maxManagers||cap.maxManagers<1;
        btn.classList.toggle("capacity-disabled",btn.disabled);
        btn.classList.toggle("active",value===total);
      });
      document.querySelectorAll("[data-human-count]").forEach(btn=>{
        const value=Number(btn.dataset.humanCount);
        btn.disabled=value>total||total<1;
        btn.classList.toggle("active",value===humans&&total>0);
      });
      document.querySelectorAll("[data-bot-difficulty]").forEach(btn=>btn.classList.toggle("active",btn.dataset.botDifficulty===difficulty));
      const bots=Math.max(0,total-humans);
      botCountEl.textContent=total>0?`${bots} Bot Manager${bots===1?"":"s"}`:"No league size available";
      if(competitionHelp)competitionHelp.textContent=capacityMessage(competition.value,1);
      if(capacityEl)capacityEl.innerHTML=cap.maxManagers
        ? `<strong>${cap.maxManagers} max managers</strong><small>${cap.poolSize} eligible draftable players · 7 roster spots per team</small>`
        : `<strong>Draft unavailable</strong><small>${competitionName(competition.value)} does not have a complete eligible fantasy pool yet.</small>`;
      nextBtn.disabled=cap.maxManagers<1||total<1;
    };
    competition.addEventListener("change",update);
    document.querySelectorAll("[data-bot-size]").forEach(btn=>btn.onclick=()=>{if(btn.disabled)return;total=Number(btn.dataset.botSize);humans=Math.min(humans,total);update();});
    document.querySelectorAll("[data-human-count]").forEach(btn=>btn.onclick=()=>{if(btn.disabled)return;humans=Number(btn.dataset.humanCount);update();});
    document.querySelectorAll("[data-bot-difficulty]").forEach(btn=>btn.onclick=()=>{difficulty=btn.dataset.botDifficulty;update();});
    nextBtn.onclick=()=>{
      const cap=competitionCapacity(competition.value,1);
      if(total<1||total>cap.maxManagers)return showToast("Choose an available league size.");
      sessionStorage.setItem("riftBotLeagueSetup",JSON.stringify({
        totalManagers:total,
        humanManagers:humans,
        difficulty,
        competition:normalizeCompetitionCode(competition.value)||"lcs"
      }));
      render("bot-settings");
    };
    update();
    void applyCompetitionScheduleAvailability(competition,update);
  }

  if(view==="bot-settings"){
    const setup=(()=>{try{return JSON.parse(sessionStorage.getItem("riftBotLeagueSetup")||"{}");}catch{return {};}})();
    if(!setup.totalManagers)return render("bot-league",{replace:true});
    let timer=30;
    document.querySelectorAll("[data-bot-timer]").forEach(btn=>btn.onclick=()=>{
      timer=Number(btn.dataset.botTimer);
      document.querySelectorAll("[data-bot-timer]").forEach(x=>x.classList.toggle("active",x===btn));
    });
    document.querySelector("#botSettingsNext").onclick=()=>{
      const name=document.querySelector("#botLeagueName").value.trim();
      const teamName=document.querySelector("#botTeamName").value.trim();
      if(!name)return showToast("Enter a league name.");
      if(!teamName)return showToast("Enter your team name.");
      sessionStorage.setItem("riftBotLeagueSettings",JSON.stringify({
        name,teamName,draftTimer:timer,
        competition:normalizeCompetitionCode(setup.competition)||"lcs",
        waivers:document.querySelector("#botWaivers").checked,
        trades:document.querySelector("#botTrades").checked,
        autoBotLineups:document.querySelector("#botAutoLineups").checked
      }));
      render("bot-confirm");
    };
  }

  if(view==="bot-confirm"){
    const setup=(()=>{try{return JSON.parse(sessionStorage.getItem("riftBotLeagueSetup")||"{}");}catch{return {};}})();
    const config=(()=>{try{return JSON.parse(sessionStorage.getItem("riftBotLeagueSettings")||"{}");}catch{return {};}})();
    if(!setup.totalManagers||!config.name)return render("bot-league",{replace:true});
    const bots=Math.max(0,Number(setup.totalManagers)-Number(setup.humanManagers));
    document.querySelector("#botConfirmName").textContent=config.name;
    document.querySelector("#botConfirmManagers").textContent=`${setup.humanManagers} Human${Number(setup.humanManagers)===1?"":"s"} · ${bots} Bot${bots===1?"":"s"}`;
    document.querySelector("#botConfirmDifficulty").textContent=`${String(setup.difficulty||"competitive").replace(/^./,c=>c.toUpperCase())} Difficulty`;
    document.querySelector("#botConfirmSettings").innerHTML=`
      <div><span>League Size</span><strong>${setup.totalManagers} managers</strong></div>
      <div><span>Competition</span><strong>${competitionName(config.competition)}</strong></div>
      <div><span>Draft Type</span><strong>Snake Draft</strong></div>
      <div><span>Draft Timer</span><strong>${config.draftTimer}s</strong></div>
      <div><span>Waivers</span><strong>${config.waivers?"Enabled":"Disabled"}</strong></div>
      <div><span>Trades</span><strong>${config.trades?"Enabled":"Disabled"}</strong></div>
      <div><span>Bot Lineups</span><strong>${config.autoBotLineups?"Automatic":"Manual"}</strong></div>`;

    const createBtn=document.querySelector("#botCreateLeagueBtn");
    createBtn.onclick=async()=>{
      createBtn.disabled=true;
      try{
        const settings={
          ...defaultLeagueSettings,
          name:config.name,
          managers:String(setup.totalManagers),
          bench:"1",
          draftType:"Snake",
          scoringFormat:"Head-to-head",
          competition:normalizeCompetitionCode(config.competition)||"worlds",
          competitionSeason:2026,
          competitionType:competitionType(config.competition),
          draftTimer:Number(config.draftTimer)||30,
          waivers:!!config.waivers,
          trades:!!config.trades,
          botLeague:true,
          botDifficulty:setup.difficulty,
          autoBotLineups:!!config.autoBotLineups
        };
        const created=await backend().createBotLeague(
          config.name,config.teamName,setup.totalManagers,setup.humanManagers,setup.difficulty,settings
        );
        const league=Array.isArray(created)?created[0]:created;
        if(!league?.id)throw new Error("Bot League was not created.");
        setActiveLeagueId(league.id);
        cacheLeagueSettings(settings)
        sessionStorage.setItem("riftBotLeagueCreated",JSON.stringify({name:config.name,human:setup.humanManagers,bots}));
        sessionStorage.removeItem("riftBotLeagueSetup");
        sessionStorage.removeItem("riftBotLeagueSettings");
        render("bot-success",{replace:true});
      }catch(err){
        showToast(err.message||"Could not create Bot League");
        createBtn.disabled=false;
      }
    };
  }

  if(view==="bot-success"){
    const created=(()=>{try{return JSON.parse(sessionStorage.getItem("riftBotLeagueCreated")||"{}");}catch{return {};}})();
    const copy=document.querySelector("#botSuccessCopy");
    if(copy&&created.name)copy.textContent=`${created.name} is ready to go. ${created.human} human and ${created.bots} bot manager${created.bots===1?" is":"s are"} in the league.`;
  }


  if(view==="creator-lab"){
    const b=backend();
    const loadingCard=document.querySelector("#creatorLabLoadingCard");
    const createCard=document.querySelector("#creatorLabCreateCard");
    const activeCard=document.querySelector("#creatorLabActiveCard");
    const simCard=document.querySelector("#creatorSimulationCard");
    const statsCard=document.querySelector("#creatorSimulationStatsCard");
    const createBtn=document.querySelector("#creatorCreateMockBtn");
    const createCompetition=document.querySelector("#creatorCompetitionSelect");
    const createCompetitionHelp=document.querySelector("#creatorCompetitionHelp");
    const activeTournamentControl=document.querySelector("#creatorActiveTournamentControl");
    const activeCompetition=document.querySelector("#creatorActiveCompetitionSelect");
    const activeCompetitionHelp=document.querySelector("#creatorActiveCompetitionHelp");
    const applyTournamentBtn=document.querySelector("#creatorApplyTournamentBtn");
    const openDraftBtn=document.querySelector("#creatorOpenDraftBtn");
    const startBtn=document.querySelector("#creatorStartSimulationBtn");
    const refreshBtn=document.querySelector("#creatorRefreshSimulationBtn");
    const deleteBtn=document.querySelector("#creatorDeleteMockBtn");
    let mockLeague=null;
    let mockCompetitions=[];
    let mockDuration=5;

    const competitionOptionLabel=row=>{
      const count=Number(row?.pool_count)||0;
      return (row?.display_name||competitionName(row?.code))+" · "+count+" players";
    };
    const competitionHelp=row=>{
      if(!row)return "Choose which tournament player pool to use for this mock draft.";
      if(row.available){
        return competitionOptionLabel(row)+" · TOP "+row.top_count+" · JNG "+row.jng_count+" · MID "+row.mid_count+" · ADC "+row.adc_count+" · SUP "+row.sup_count;
      }
      return competitionOptionLabel(row)+" · Not enough eligible players for a complete 2-team mock draft.";
    };
    const populateCompetitionSelect=(select,value)=>{
      if(!select)return;
      select.innerHTML=mockCompetitions.map(row=>`<option value="${h(row.code)}" ${row.available?"":"disabled"}>${h(competitionOptionLabel(row))}${row.available?"":" · UNAVAILABLE"}</option>`).join("");
      const preferred=normalizeCompetitionCode(value)||"worlds";
      if([...select.options].some(option=>option.value===preferred&&!option.disabled))select.value=preferred;
      else{
        const first=[...select.options].find(option=>!option.disabled);
        if(first)select.value=first.value;
      }
    };
    const updateCompetitionHelp=(select,target)=>{
      if(!select||!target)return;
      target.textContent=competitionHelp(mockCompetitions.find(row=>row.code===select.value));
    };
    const syncMockDurationUI=()=>{
      document.querySelectorAll("[data-mock-duration]").forEach(btn=>{
        const active=Number(btn.dataset.mockDuration)===mockDuration;
        btn.classList.toggle("active",active);
        btn.setAttribute("aria-pressed",active?"true":"false");
      });
      if(createBtn)createBtn.textContent=`Create ${mockDuration}-Minute Mock`;
    };

    document.querySelectorAll("[data-mock-duration]").forEach(btn=>{
      btn.onclick=()=>{
        mockDuration=Number(btn.dataset.mockDuration)===35?35:5;
        syncMockDurationUI();
      };
    });
    syncMockDurationUI();

    const drawSnapshot=snapshot=>{
      const run=snapshot?.run||{};
      const matchup=snapshot?.matchup||{};
      const stats=Array.isArray(snapshot?.stats)?snapshot.stats:[];
      const running=["running","completed"].includes(String(run.status||""));
      simCard.hidden=!running;
      statsCard.hidden=!running;
      if(!running)return;

      const elapsed=Math.min(Number(run.duration_minutes)||35,Number(run.elapsed_minutes)||0);
      document.querySelector("#creatorSimulationClock").textContent=elapsed+" / "+(Number(run.duration_minutes)||35)+" MIN";
      document.querySelector("#creatorSimulationProgress").style.width=Math.max(0,Math.min(100,(elapsed/(Number(run.duration_minutes)||35))*100))+"%";
      const statHomeScore=stats.filter(row=>row.manager_type==="human").reduce((sum,row)=>sum+(Number(row.fantasy_points)||0),0);
      const statAwayScore=stats.filter(row=>row.manager_type==="bot").reduce((sum,row)=>sum+(Number(row.fantasy_points)||0),0);
      const homeScore=stats.length?statHomeScore:(Number(matchup.home_score)||0);
      const awayScore=stats.length?statAwayScore:(Number(matchup.away_score)||0);
      document.querySelector("#creatorHomeScore").textContent=formatFantasyPoints(homeScore);
      document.querySelector("#creatorAwayScore").textContent=formatFantasyPoints(awayScore);
      const statsRoot=document.querySelector("#creatorSimulationStats");
      const lineupSlots=["TOP","JNG","MID","ADC","SUP","FLEX"];
      const arrangeSide=managerType=>{
        const sideRows=stats.filter(row=>row.manager_type===managerType);
        const used=new Set();
        const bySlot=new Map();
        ["TOP","JNG","MID","ADC","SUP"].forEach(slot=>{
          const index=sideRows.findIndex((row,i)=>!used.has(i)&&String(row.role||"").toUpperCase()===slot);
          if(index>=0){used.add(index);bySlot.set(slot,sideRows[index]);}
        });
        const remaining=sideRows.filter((row,i)=>!used.has(i));
        if(remaining.length)bySlot.set("FLEX",remaining[0]);
        return bySlot;
      };
      const home=arrangeSide("human");
      const away=arrangeSide("bot");
      const playerCell=(row,side)=>{
        if(!row)return `<div class="creator-matchup-player empty"><strong>—</strong><small>No starter</small><span>0.00 FP</span></div>`;
        const record=(Number(row.kills)||0)+"/"+(Number(row.deaths)||0)+"/"+(Number(row.assists)||0);
        const event=row.first_blood?' <b class="creator-first-blood">FIRST BLOOD</b>':"";
        return `<div class="creator-matchup-player ${side}">
          <strong>${h(row.name||row.player_id)}</strong>
          <small>${h(row.team||"")} · ${h(record)} · ${Number(row.cs)||0} CS${event}</small>
          <span>${formatFantasyPoints(row.fantasy_points||0)} FP</span>
        </div>`;
      };
      statsRoot.innerHTML=stats.length?`<div class="creator-matchup-board">
        <div class="creator-matchup-header">
          <div><small>YOU</small><strong>Creator Team</strong></div>
          <span>POSITION</span>
          <div><small>BOT</small><strong>Rift Bot</strong></div>
        </div>
        ${lineupSlots.map(slot=>`<div class="creator-matchup-row">
          ${playerCell(home.get(slot),"home")}
          <div class="creator-matchup-role">${h(slot)}</div>
          ${playerCell(away.get(slot),"away")}
        </div>`).join("")}
      </div>`:'<div class="muted">Simulation stats will appear after the first scoring tick.</div>';
    };


    const primeFromResumeCache=()=>{
      const cached=creatorLabResumeCache;
      if(!cached?.league?.id)return false;
      mockLeague=cached.league;
      const snapshot=cached.snapshot||{};
      const run=snapshot?.run||{};
      const leagueStatus=String(mockLeague.status||"pre_draft");
      if(loadingCard)loadingCard.hidden=true;
      createCard.hidden=true;
      activeCard.hidden=false;
      document.querySelector("#creatorMockTitle").textContent=mockLeague.name||"Creator Mock Draft";
      document.querySelector("#creatorMockStatus").textContent=run.status==="running"?"SIMULATING":run.status==="completed"?"COMPLETE":leagueStatus.replaceAll("_"," ").toUpperCase();

      const mockCopy=document.querySelector("#creatorMockCopy");
      const copy=run.status==="running"?"":run.status==="completed"?"Test complete.":leagueStatus==="drafting"?"Draft in progress.":leagueStatus==="active"?"Draft complete.":"";
      if(mockCopy){mockCopy.textContent=copy;mockCopy.hidden=!copy;}

      if(activeTournamentControl)activeTournamentControl.hidden=true;
      openDraftBtn.hidden=run.status==="running";
      openDraftBtn.textContent=leagueStatus==="pre_draft"||leagueStatus==="drafting"?"Open Draft Room":"Review Draft Results";
      startBtn.hidden=!(leagueStatus==="active"&&run.status!=="running"&&run.status!=="completed");
      refreshBtn.hidden=false;
      drawSnapshot(snapshot);
      return true;
    };

    primeFromResumeCache();

    const load=async({refreshCompetitions=false}={})=>{
      const admin=await b.isPlatformAdmin().catch(()=>false);
      if(!admin){
        showToast("Creator access required");
        return render("account",{replace:true});
      }

      const leagues=await b.listLeagues();
      mockLeague=leagues.find(l=>isSimulationLeague(l))||null;

      // Render the known league state immediately. Tournament availability can be
      // comparatively expensive and must never make an active mock look like a fresh test.
      if(loadingCard)loadingCard.hidden=true;
      createCard.hidden=!!mockLeague;
      activeCard.hidden=!mockLeague;

      if(!mockLeague){
        simCard.hidden=true;
        statsCard.hidden=true;
        if(activeTournamentControl)activeTournamentControl.hidden=true;

        if(refreshCompetitions||!mockCompetitions.length){
          const competitionRows=await b.listMockCompetitions();
          mockCompetitions=Array.isArray(competitionRows)?competitionRows:[];
          populateCompetitionSelect(createCompetition,"worlds");
          updateCompetitionHelp(createCompetition,createCompetitionHelp);
        }
        return;
      }

      // An existing mock does not need the tournament-list query just to resume.
      // Load the live state first so returning to a running matchup is immediate.
      const [snapshot,draftState,draftPicks]=await Promise.all([
        b.getMockSimulation(mockLeague.id),
        b.getLeagueDraft(mockLeague.id),
        b.listDraftPicks(mockLeague.id)
      ]);
      const run=snapshot?.run||{};
      creatorLabResumeCache={league:mockLeague,snapshot,storedAt:Date.now()};
      document.querySelector("#creatorMockTitle").textContent=mockLeague.name||"Creator Mock Draft";
      const leagueStatus=String(mockLeague.status||"pre_draft");
      document.querySelector("#creatorMockStatus").textContent=run.status==="running"?"SIMULATING":run.status==="completed"?"COMPLETE":leagueStatus.replaceAll("_"," ").toUpperCase();
      const mockCopy=document.querySelector("#creatorMockCopy");
      const mockCopyText=leagueStatus==="pre_draft"
        ?"Open the real Draft Room and start the draft when you're ready."
        :leagueStatus==="drafting"
          ?"Your mock draft is live. The bot will make its own picks."
          :run.status==="running"
            ?""
            :run.status==="completed"
              ?"The test game is complete. Review the final fantasy scores or delete the test league."
              :`Draft complete. Start the ${Number(run.duration_minutes)||5}-minute simulation when you're ready.`;
      if(mockCopy){
        mockCopy.textContent=mockCopyText;
        mockCopy.hidden=!mockCopyText;
      }

      const pickCount=Array.isArray(draftPicks)?draftPicks.length:0;
      const canChangeTournament=(leagueStatus==="pre_draft"||leagueStatus==="drafting")&&pickCount===0;

      if(canChangeTournament&&(refreshCompetitions||!mockCompetitions.length)){
        try{
          const competitionRows=await b.listMockCompetitions();
          mockCompetitions=Array.isArray(competitionRows)?competitionRows:[];
        }catch(err){
          console.warn("Creator Lab tournament availability could not refresh",err);
        }
      }

      if(activeTournamentControl)activeTournamentControl.hidden=!canChangeTournament;
      if(activeCompetition){
        populateCompetitionSelect(activeCompetition,mockLeague?.settings?.competition);
        activeCompetition.disabled=!canChangeTournament;
        updateCompetitionHelp(activeCompetition,activeCompetitionHelp);
      }
      if(applyTournamentBtn){
        applyTournamentBtn.hidden=!canChangeTournament;
        applyTournamentBtn.disabled=!canChangeTournament;
      }

      openDraftBtn.hidden=run.status==="running";
      openDraftBtn.textContent=leagueStatus==="pre_draft"||leagueStatus==="drafting"?"Open Draft Room":"Review Draft Results";
      startBtn.hidden=!(leagueStatus==="active"&&run.status!=="running"&&run.status!=="completed");
      refreshBtn.hidden=false;
      drawSnapshot(snapshot);
    };

    if(createCompetition){
      createCompetition.onchange=()=>updateCompetitionHelp(createCompetition,createCompetitionHelp);
    }
    if(activeCompetition){
      activeCompetition.onchange=()=>updateCompetitionHelp(activeCompetition,activeCompetitionHelp);
    }

    createBtn.onclick=async()=>{
      createBtn.disabled=true;
      try{
        const competition=createCompetition?.value||"worlds";
        const created=await b.createMockLeague(competition,mockDuration);
        const league=Array.isArray(created)?created[0]:created;
        if(!league?.id)throw new Error("Mock league was not created.");
        mockLeague=league;
        setActiveLeagueId(league.id);
        showToast(`${mockDuration}-minute mock league created`);
        await load();
      }catch(err){showToast(err.message||"Could not create mock league");}
      finally{createBtn.disabled=false;}
    };

    applyTournamentBtn.onclick=async()=>{
      if(!mockLeague||!activeCompetition)return;
      applyTournamentBtn.disabled=true;
      try{
        const updated=await b.setMockCompetition(mockLeague.id,activeCompetition.value);
        mockLeague=Array.isArray(updated)?updated[0]:updated;
        showToast("Mock tournament changed to "+competitionName(activeCompetition.value));
        await load();
      }catch(err){
        showToast(err.message||"Could not change mock tournament");
      }finally{
        applyTournamentBtn.disabled=false;
      }
    };

    openDraftBtn.onclick=()=>{
      if(!mockLeague)return;
      setActiveLeagueId(mockLeague.id);
      render("draft");
    };

    startBtn.onclick=async()=>{
      if(!mockLeague)return;
      startBtn.disabled=true;
      try{
        const snapshot=await b.startMockSimulation(mockLeague.id);
        showToast(`${Number(snapshot?.run?.duration_minutes)||5}-minute simulation started`);
        drawSnapshot(snapshot);
        await load();
      }catch(err){showToast(err.message||"Could not start simulation");}
      finally{startBtn.disabled=false;}
    };

    refreshBtn.onclick=()=>load().catch(err=>showToast(err.message||"Could not refresh simulation"));

    deleteBtn.onclick=async()=>{
      if(!mockLeague)return;
      if(!window.confirm("Delete this mock league and all simulated game data?"))return;
      deleteBtn.disabled=true;
      try{
        const id=mockLeague.id;
        await b.deleteMockLeague(id);
        if(String(getActiveLeagueId()||"")===String(id))setActiveLeagueId(null);
        mockLeague=null;
        creatorLabResumeCache=null;
        showToast("Mock league deleted");
        await load();
      }catch(err){showToast(err.message||"Could not delete mock league");}
      finally{deleteBtn.disabled=false;}
    };

    void load({refreshCompetitions:true}).catch(err=>showToast(err.message||"Could not open Creator Lab"));
    creatorSimulationTimerId=setInterval(()=>{
      if(document.querySelector("#creatorSimulationCard"))void load().catch(()=>{});
    },10000);
  }

  if(view==="setup"){
    const setupScreen=document.querySelector("#setupScreen");
    const activeLeagueId=getActiveLeagueId();

    const populate=(settings)=>{
      document.querySelector("#leagueName").value=settings.name;
      const managerSelect=document.querySelector("#managerCount");
      if([...managerSelect.options].some(o=>o.value===String(settings.managers)))managerSelect.value=String(settings.managers);
      else managerSelect.value="4";
      document.querySelector("#benchCount").value=settings.bench;
      const competitionSelect=document.querySelector("#competition");
      competitionSelect.value=normalizeCompetitionCode(settings.competition)||"worlds";
      const competitionHelp=document.querySelector("#competitionHelp");
      if(competitionHelp)competitionHelp.textContent=competitionHelpText(competitionSelect.value)+" Competition cannot be changed after the draft starts.";
      const fantasyFormat=document.querySelector("#fantasyFormat");
      const fantasyFormatHelp=document.querySelector("#fantasyFormatHelp");
      const inferredFormat=(code)=>code==="first_stand"?"short_event":(competitionType(code)==="regional"?"season":"tournament");
      if(fantasyFormat)fantasyFormat.value=settings.fantasyFormat||inferredFormat(competitionSelect.value);
      const syncFormatHelp=()=>{
        if(!fantasyFormatHelp||!fantasyFormat)return;
        fantasyFormatHelp.textContent=fantasyFormat.value==="season"
          ?"Season League uses the regional schedule, regular head-to-head periods, then postseason stages."
          :fantasyFormat.value==="short_event"
            ?"Short Event League is optimized for compact international events with fewer scoring periods."
            :"Tournament League follows stage-based scoring periods and a postseason bracket.";
      };
      if(fantasyFormat)fantasyFormat.onchange=syncFormatHelp;
      syncFormatHelp();
      document.querySelector("#teamSlot").checked=false;
      const waiversToggle=document.querySelector("#leagueWaivers");
      const tradesToggle=document.querySelector("#leagueTrades");
      const tradeReviewToggle=document.querySelector("#leagueTradeReview");
      if(waiversToggle)waiversToggle.checked=settings.waivers!==false;
      if(tradesToggle)tradesToggle.checked=settings.trades!==false;
      if(tradeReviewToggle)tradeReviewToggle.checked=settings.tradeReview===true;
      document.querySelector("#scoreKills").value=settings.scoring.kills;
      document.querySelector("#scoreDeaths").value=settings.scoring.deaths;
      document.querySelector("#scoreAssists").value=settings.scoring.assists;
      document.querySelector("#scoreCs").value=settings.scoring.cs;
      document.querySelector("#scoreWin").value=settings.scoring.win;
      document.querySelector("#scoreFb").value=settings.scoring.firstBlood;
      const applyCapacity=()=>{
        const cap=competitionCapacity(competitionSelect.value,document.querySelector("#benchCount").value);
        const help=document.querySelector("#managerCapacityHelp");
        if(help)help.textContent=capacityMessage(competitionSelect.value,document.querySelector("#benchCount").value);
        [...managerSelect.options].forEach(option=>{option.disabled=Number(option.value)>cap.maxManagers||cap.maxManagers<1;});
        if(cap.maxManagers>0&&Number(managerSelect.value)>cap.maxManagers)managerSelect.value=String(cap.maxManagers);
      };
      competitionSelect.onchange=()=>{
        applyCapacity();
        if(fantasyFormat)fantasyFormat.value=inferredFormat(competitionSelect.value);
        syncFormatHelp();
      };
      document.querySelector("#benchCount").onchange=applyCapacity;
      applyCapacity();
    };

    (async()=>{
      let settings=getLeagueSettings();
      let league=null;
      if(cloudReady()&&activeLeagueId){
        setupScreen.hidden=true;
        try{
          const b=backend();
          const user=await b.currentUser();
          const [members,bots,leagues]=await Promise.all([b.listLeagueMembers(activeLeagueId),b.listLeagueBots(activeLeagueId),b.listLeagues()]);
          const mine=members.find(m=>String(m.user_id)===String(user?.id));
          league=leagues.find(l=>String(l.id)===String(activeLeagueId));
          if(leagueLifecycleConfig(league).readOnly){
            showToast("This league is complete. League settings are read-only.");
            render("league",{replace:true});
            return;
          }
          const memberList=document.querySelector("#commissionerMemberList");
          const drawMembers=()=>{
            if(!memberList)return;
            const humanRows=members.map(m=>{
              const isOwner=m.role==="owner";
              return `<div class="commissioner-member-row"><div><strong>${h(m.team_name||"My Team")}</strong><small>${isOwner?"Commissioner":"Manager"}</small></div>${isOwner?"<span class=\"status-pill success\">OWNER</span>":'<button class="mini-btn danger" data-remove-member="'+h(m.user_id)+'">REMOVE</button>'}</div>`;
            });
            const botRows=bots.map(bot=>`<div class="commissioner-member-row bot-manager-row"><div><strong>🤖 ${h(bot.team_name)}</strong><small>${h(String(bot.difficulty||"competitive").replace(/^./,c=>c.toUpperCase()))} Bot</small></div><span class="status-pill bot-pill">BOT</span></div>`);
            memberList.innerHTML=[...humanRows,...botRows].join("");
            memberList.querySelectorAll("[data-remove-member]").forEach(btn=>btn.onclick=async()=>{
              const target=members.find(m=>String(m.user_id)===String(btn.dataset.removeMember));
              if(!target)return;
              if(!window.confirm(`Remove ${target.team_name||"this manager"} from the league?`))return;
              btn.disabled=true;
              try{
                await b.removeLeagueMember(activeLeagueId,target.user_id);
                const idx=members.findIndex(m=>String(m.user_id)===String(target.user_id));
                if(idx>=0)members.splice(idx,1);
                drawMembers();
                showToast("Manager removed from league");
              }catch(err){
                showToast(err.message||"Could not remove manager");
                btn.disabled=false;
              }
            });
          };
          drawMembers();
          if(mine?.role!=="owner"){
            showToast("Only the league commissioner can change league settings.");
            render("league",{replace:true});
            return;
          }
          const editable=league?.status==="pre_draft";
          settings={...defaultLeagueSettings,...(league?.settings||{}),name:league?.name||settings.name,competition:normalizeCompetitionCode(league?.settings?.competition)||"worlds",competitionSeason:Number(league?.settings?.competitionSeason)||2026,competitionType:competitionType(league?.settings?.competition),scoring:{...defaultLeagueSettings.scoring,...(league?.settings?.scoring||{})}};
          cacheLeagueSettings(settings)
          setupScreen.hidden=false;

          const saveBtn=document.querySelector("#saveLeagueBtn");
          const managementPill=document.querySelector("#managementStatusPill");
          const managementCopy=document.querySelector("#managementStatusCopy");
          const deleteBtn=document.querySelector("#deleteLeagueBtn");

          managementPill.textContent=String(league?.status||"pre_draft").replace("_"," ").toUpperCase();
          managementCopy.textContent="Permanently delete this league and all league-specific data.";

          const lockNotice=document.querySelector("#commissionerLockNotice");
          if(lockNotice)lockNotice.hidden=editable;
          if(!editable){
            document.querySelectorAll("#setupScreen input:not([type=button]), #setupScreen select, #setupScreen .choice").forEach(el=>{el.disabled=true;el.setAttribute("aria-disabled","true");});
            if(saveBtn){saveBtn.disabled=true;saveBtn.textContent="League Settings Locked";}
          }

          deleteBtn.onclick=async()=>{
            const leagueName=String(league?.name||"").trim();
            const typed=window.prompt(`Permanent deletion cannot be undone. Type the league name exactly to delete it:\n\n${leagueName}`);
            if(String(typed||"").trim()!==leagueName)return showToast("League deletion canceled");
            if(!window.confirm("Final confirmation: permanently delete this league and all league-specific data?"))return;
            deleteBtn.disabled=true;
            try{
              await b.deleteLeague(activeLeagueId);
              setActiveLeagueId(null);
              storageRemove("riftDraftState");
              showToast("League permanently deleted");
              render("league",{replace:true});
            }catch(err){
              showToast(err.message||"Could not delete league");
              deleteBtn.disabled=false;
            }
          };
        }catch(err){
          showToast(err.message||"Could not load league settings.");
          render("league",{replace:true});
          return;
        }
      }
      populate(settings);

      document.querySelector("#saveLeagueBtn").onclick=async()=>{
        const numberOr=(id,fallback)=>{const n=Number(document.querySelector(id).value);return Number.isFinite(n)?n:fallback;};
        const capacity=competitionCapacity(document.querySelector("#competition").value,document.querySelector("#benchCount").value);
        if(capacity.maxManagers<1)return showToast(`${competitionName(document.querySelector("#competition").value)} is not open for fantasy drafting yet.`);
        if(Number(document.querySelector("#managerCount").value)>capacity.maxManagers)return showToast(`This competition supports up to ${capacity.maxManagers} managers with the current roster size.`);
        const next={
          name:document.querySelector("#leagueName").value.trim()||"Fantasy League",
          managers:document.querySelector("#managerCount").value,
          bench:document.querySelector("#benchCount").value,
          draftType:"Snake",
          scoringFormat:"Head-to-head",
          competition:normalizeCompetitionCode(document.querySelector("#competition").value)||"worlds",
          competitionSeason:2026,
          competitionType:competitionType(document.querySelector("#competition").value),
          fantasyFormat:document.querySelector("#fantasyFormat")?.value||"tournament",
          teamSlot:false,
          scoring:{
            kills:numberOr("#scoreKills",defaultLeagueSettings.scoring.kills),
            deaths:numberOr("#scoreDeaths",defaultLeagueSettings.scoring.deaths),
            assists:numberOr("#scoreAssists",defaultLeagueSettings.scoring.assists),
            cs:numberOr("#scoreCs",defaultLeagueSettings.scoring.cs),
            win:numberOr("#scoreWin",defaultLeagueSettings.scoring.win),
            firstBlood:numberOr("#scoreFb",defaultLeagueSettings.scoring.firstBlood)
          }
        };
        const btn=document.querySelector("#saveLeagueBtn");btn.disabled=true;
        try{
          if(cloudReady()&&activeLeagueId)await backend().updateLeagueSettings(activeLeagueId,next.name,next);
          cacheLeagueSettings(next)
          storageRemove("riftDraftState");
          showToast("League settings saved for everyone");
          render("league",{replace:true});
        }catch(err){showToast(err.message||"Could not save league settings");}
        finally{btn.disabled=false;}
      };
    })();
  }
  document.querySelectorAll("[data-lock-help]").forEach(btn=>{
    btn.onclick=()=>{
      const panel=document.querySelector("#lineupLockHelp");
      if(!panel)return;
      const isOpen=!panel.hidden&&panel.dataset.helpType===btn.dataset.lockHelp;
      document.querySelectorAll("[data-lock-help]").forEach(x=>x.setAttribute("aria-expanded","false"));
      if(isOpen){
        panel.hidden=true;
        panel.dataset.helpType="";
        return;
      }
      const next=btn.dataset.lockHelp==="next";
      panel.innerHTML=next
        ? "<strong>Next Lineup Lock</strong><small>The next time one of your rostered players becomes locked because their scheduled match is starting. Once locked, that player cannot be moved between the starting lineup, FLEX, and bench until the lock clears.</small>"
        : "<strong>Lock Status</strong><small>Shows how many players on your roster are currently locked versus still available to move. A locked player has already reached their lineup lock for the active scoring period.</small>";
      panel.dataset.helpType=btn.dataset.lockHelp;
      panel.hidden=false;
      btn.setAttribute("aria-expanded","true");
    };
  });
  document.querySelectorAll("[data-open-player]").forEach(row=>{
    if(row.dataset.profileBound)return;
    row.dataset.profileBound="1";
    row.addEventListener("click",(e)=>{if(e.target.closest(".add-btn,.draft-btn"))return;openPlayer(row.dataset.openPlayer);});
    row.addEventListener("keydown",(e)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openPlayer(row.dataset.openPlayer);}});
  });
  document.querySelectorAll("[data-jump]").forEach(b=>b.onclick=()=>{
    const target=b.dataset.jump;
    if(historicalLeagueContextId){
      const historicalViews=new Set(["team","matchup","standings","draft"]);
      if(historicalViews.has(target)){
        render(target,{historyLeagueId:historicalLeagueContextId});
        return;
      }
      render("league");
      return;
    }
    render(target);
  });
}

let reportingClientError=false;
window.addEventListener("error",event=>{
  if(reportingClientError)return;
  reportingClientError=true;
  Promise.resolve(backend()?.logClientError?.(event.message,event.error?.stack||"",{filename:event.filename||"",lineno:event.lineno||0,colno:event.colno||0})).catch(()=>{}).finally(()=>{reportingClientError=false;});
});
window.addEventListener("unhandledrejection",event=>{
  if(reportingClientError)return;
  reportingClientError=true;
  const reason=event.reason;
  Promise.resolve(backend()?.logClientError?.(reason?.message||String(reason||"Unhandled rejection"),reason?.stack||"",{type:"unhandledrejection"})).catch(()=>{}).finally(()=>{reportingClientError=false;});
});
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>render(b.dataset.view)));
document.querySelectorAll("[data-close-transaction]").forEach(el=>el.addEventListener("click",closeTransactionModal));
document.querySelectorAll("[data-close-lineup-swap]").forEach(el=>el.addEventListener("click",closeLineupSwapModal));
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape")return;
  closeTransactionModal();
  closeLineupSwapModal();
});
window.addEventListener("popstate",e=>{
  navigationDepth=Number(e.state?.depth)||0;
  render(e.state?.view||location.hash.slice(1)||"home",{
    fromHistory:true,
    historyLeagueId:e.state?.historyLeagueId||null
  });
});
document.querySelector("#accountBtn").onclick=()=>render("account");

const notificationBtn=document.querySelector("#notificationBtn");
const notificationBadge=document.querySelector("#notificationBadge");
const notificationPanel=document.querySelector("#notificationPanel");
const notificationList=document.querySelector("#notificationList");
const notificationSummary=document.querySelector("#notificationSummary");
const markNotificationsReadBtn=document.querySelector("#markNotificationsRead");
let notificationTimerId=null;

function closeNotifications(){
  if(notificationPanel)notificationPanel.hidden=true;
  document.body.classList.remove("notifications-open");
}

async function loadNotifications({open=false}={}){
  if(!cloudReady()){
    notificationBadge.hidden=true;
    return [];
  }
  try{
    const b=backend();
    const user=await b.currentUser().catch(()=>null);
    if(!user){
      notificationBadge.hidden=true;
      return [];
    }

    const notifications=await b.listNotifications(60);
    const unread=notifications.filter(n=>!n.read_at);
    notificationBadge.textContent=unread.length>99?"99+":String(unread.length);
    notificationBadge.hidden=unread.length===0;

    if(!open)return notifications;

    const leagueIds=[...new Set(notifications.map(n=>String(n.league_id)).filter(Boolean))];
    const leagueRows=await b.listLeagues();
    const leagueMap=new Map(leagueRows.map(l=>[String(l.id),l]));
    const memberMap=new Map();
    await Promise.all(leagueIds.map(async id=>{
      try{memberMap.set(id,await b.listLeagueMembers(id));}catch{memberMap.set(id,[]);}
    }));

    const teamName=(leagueId,userId)=>{
      const members=memberMap.get(String(leagueId))||[];
      return members.find(m=>String(m.user_id)===String(userId))?.team_name||"Manager";
    };
    const playerName=id=>playerById(id)?.name||String(id||"Player");
    const fmt=iso=>{const d=new Date(iso);return Number.isNaN(d.getTime())?"":d.toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});};

    const describe=n=>{
      const p=n.payload||{};
      const actor=teamName(n.league_id,n.actor_user);
      const target=teamName(n.league_id,p.to_user);
      const send=playerName(p.send_player_id);
      const receive=playerName(p.receive_player_id);
      const rosterPlayer=playerName(p.player_id);
      switch(n.kind){
        case "trade_offer": return {title:`Trade offer from ${actor}`,body:"Tap to review the incoming offer.",view:"trade",tradeId:p.trade_id,tradeTab:"incoming"};
        case "trade_activity": return {title:`${actor} sent a trade offer`,body:`Trade proposed with ${target}.`,view:"trade",tradeId:p.trade_id,tradeTab:"history"};
        case "trade_accepted": return {title:"Trade completed",body:`${actor} accepted a trade offer.`,view:"trade",tradeId:p.trade_id,tradeTab:"history"};
        case "trade_declined": return {title:"Trade declined",body:`${actor} declined a trade offer.`,view:"trade",tradeId:p.trade_id,tradeTab:"history"};
        case "trade_canceled": return {title:"Trade canceled",body:`${actor} canceled a trade offer.`,view:"trade",tradeId:p.trade_id,tradeTab:"history"};
        case "trade_expired": return {title:"Trade expired",body:"This offer is no longer active.",view:"trade",tradeId:p.trade_id,tradeTab:"history"};
        case "trade_review_required": return {title:"Trade awaiting commissioner review",body:`${actor} accepted a trade. Review it before rosters change.`,view:"trade",tradeId:p.trade_id,tradeTab:"history"};
        case "trade_approved": return {title:"Trade approved",body:"The commissioner approved the trade and rosters were updated.",view:"trade",tradeId:p.trade_id,tradeTab:"history"};
        case "trade_rejected": return {title:"Trade rejected",body:"The commissioner rejected the trade.",view:"trade",tradeId:p.trade_id,tradeTab:"history"};
        case "roster_add": return {title:`${actor} added ${rosterPlayer}`,body:"League roster move",view:"transactions"};
        case "roster_drop": return {title:`${actor} dropped ${rosterPlayer}`,body:"League roster move",view:"transactions"};
        case "roster_swap": return {title:`${actor} made a roster move`,body:"Roster swap",view:"transactions",swap:{dropped:playerName(p.dropped_player_id),added:playerName(p.added_player_id)}};
        case "waiver_submitted": return {title:`Waiver claim submitted: ${rosterPlayer}`,body:`Priority ${p.priority||1}. The claim remains subject to league lock rules.`,view:"transactions"};
        case "waiver_won": return {title:`Waiver won: ${rosterPlayer}`,body:"The player has been added to your roster and your waiver priority moved to the back.",view:"transactions"};
        case "waiver_lost": return {title:`Waiver not awarded: ${rosterPlayer}`,body:"Another manager acquired the player first.",view:"transactions"};
        case "waiver_failed": return {title:`Waiver failed: ${rosterPlayer}`,body:p.resolution_note||"The claim could not be completed.",view:"transactions"};
        case "waiver_expired": return {title:`Waiver expired: ${rosterPlayer}`,body:p.resolution_note||"The player became unavailable before the claim processed.",view:"transactions"};
        case "waiver_canceled": return {title:`Waiver canceled: ${rosterPlayer}`,body:"Your waiver claim was canceled.",view:"transactions"};
        case "draft_started": return {title:"Draft started",body:"Your league draft is now live.",view:"draft"};
        case "draft_complete": return {title:"Draft complete",body:"All rosters have been created. Review the draft results.",view:"draft"};
        case "league_completed": {
          const competition=competitionName(p.competition);
          return p.had_games===false
            ? {title:"Season complete",body:competition+" ended before this league had any fantasy scoring periods. No champion was awarded.",view:"league"}
            : {title:"Season complete",body:competition+" is complete. Final standings and results are available.",view:"league"};
        }
        case "roster_incomplete_warning": {
          const missing=Array.isArray(p.missing_slots)&&p.missing_slots.length?p.missing_slots.join(", "):"roster spots";
          const count=(p.roster_count!=null&&p.required_count!=null)?`${p.roster_count}/${p.required_count} players · `:"";
          return {title:"Roster incomplete",body:`${count}Missing: ${missing}. Complete your roster before making other roster-reducing moves.`,view:"team"};
        }
        case "lineup_lock_warning": {
          const start=p.starts_at?new Date(p.starts_at):null;
          const when=start&&!Number.isNaN(start.getTime())?start.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}):"soon";
          return {title:`${rosterPlayer} locks soon`,body:`Lineup locks at ${when}. Check your starter/bench decision now.`,view:"team"};
        }
        case "fantasy_period_started": return {title:p.label||`Fantasy Round ${p.round_number||""} started`,body:`${p.match_count||0} pro match${Number(p.match_count)===1?"":"es"} in this scoring period.`,view:"matchup",roundNumber:p.round_number};
        case "matchup_final": {
          const outcome=String(p.outcome||"").toUpperCase();
          return {title:`Matchup final · ${outcome}`,body:`${formatFantasyPoints(p.your_score)} - ${formatFantasyPoints(p.opponent_score)} FP`,view:"matchup",roundNumber:p.round_number};
        }
        default:return {title:"League update",body:"New activity in your league.",view:"league"};
      }
    };

    notificationSummary.textContent=unread.length?`${unread.length} unread notification${unread.length===1?"":"s"}`:"You're all caught up.";
    notificationList.innerHTML=notifications.length?notifications.map(n=>{
      const d=describe(n);
      const league=leagueMap.get(String(n.league_id));
      const detail=d.swap
        ? `<span class="notification-swap"><span class="swap-drop">${h(d.swap.dropped)}</span><span class="swap-arrow">→</span><span class="swap-add">${h(d.swap.added)}</span></span><small>Dropped one player and added another.</small>`
        : `<small>${h(d.body)}</small>`;
      return `<button class="notification-item ${n.read_at?"":"unread"}" data-notification-view="${h(d.view)}" data-notification-id="${h(n.id)}" data-notification-league="${h(n.league_id||"")}" data-notification-trade-id="${h(d.tradeId||"")}" data-notification-trade-tab="${h(d.tradeTab||"")}" data-notification-round="${h(d.roundNumber||"")}"><span class="notification-dot"></span><span class="notification-copy"><strong>${h(d.title)}</strong>${detail}<em>${h(league?.name||"League")} · ${h(fmt(n.created_at))}</em></span></button>`;
    }).join(""):'<div class="empty-state"><strong>No notifications yet</strong><small>Lineup locks, fantasy periods, matchup results, trades, and roster activity will appear here.</small></div>';

    notificationList.querySelectorAll("[data-notification-view]").forEach(item=>item.onclick=async()=>{
      let destination=item.dataset.notificationView;
      const leagueId=item.dataset.notificationLeague;
      const notificationLeague=leagueMap.get(String(leagueId));
      const completedLeague=String(notificationLeague?.status||"")==="completed";
      const notificationRound=Number(item.dataset.notificationRound);

      if(completedLeague){
        if(["trade","transactions","setup","players"].includes(destination))destination="league";
      }else if(leagueId&&leagueId!==String(getActiveLeagueId()||"")){
        setActiveLeagueId(leagueId);
        await loadRosterFromCloud(leagueId).catch(()=>{});
      }

      if(destination==="trade"){
        let tradeTab=item.dataset.notificationTradeTab||"incoming";
        const tradeId=item.dataset.notificationTradeId||null;
        if(tradeId&&leagueId){
          try{
            const leagueTrades=await b.listTrades(leagueId);
            const currentTrade=leagueTrades.find(t=>String(t.id)===String(tradeId));
            if(currentTrade&&String(currentTrade.status)!=="pending")tradeTab="history";
          }catch{}
        }
        tradeRouteIntent={tab:tradeTab,id:tradeId};
      }

      if(destination==="matchup"&&Number.isFinite(notificationRound)&&notificationRound>0){
        selectedMatchupRound=notificationRound;
      }

      if(item.classList.contains("unread")){
        try{await b.markNotificationsRead([item.dataset.notificationId]);}catch{}
      }
      closeNotifications();
      if(completedLeague&&["team","matchup","standings","draft"].includes(destination)){
        render(destination,{historyLeagueId:leagueId});
      }else{
        render(destination);
      }
      void loadNotifications();
    });

    notificationPanel.hidden=false;
    document.body.classList.add("notifications-open");
    return notifications;
  }catch(err){
    if(open){
      notificationList.innerHTML='<div class="empty-state cloud-error"><strong>Could not load notifications</strong><small>'+h(err.message||"Please try again.")+'</small></div>';
      notificationPanel.hidden=false;
    }
    return [];
  }
}

notificationBtn.onclick=()=>loadNotifications({open:true});
document.querySelectorAll("[data-close-notifications]").forEach(el=>el.addEventListener("click",closeNotifications));
markNotificationsReadBtn.onclick=async()=>{
  if(markNotificationsReadBtn.disabled)return;
  markNotificationsReadBtn.disabled=true;
  try{await backend().markNotificationsRead(null);await loadNotifications({open:true});}
  catch(err){showToast(err.message||"Could not update notifications");}
  finally{markNotificationsReadBtn.disabled=false;}
};
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeNotifications();});

// Brief visual confirmation for button taps. The state clears automatically.
document.addEventListener("pointerdown",e=>{
  const button=e.target.closest?.("button");
  if(!button||button.disabled)return;
  button.classList.add("ui-pressed");
});
const clearPressed=e=>{
  const button=e.target.closest?.("button");
  if(!button)return;
  setTimeout(()=>button.classList.remove("ui-pressed"),120);
};
document.addEventListener("pointerup",clearPressed);
document.addEventListener("pointercancel",clearPressed);
document.addEventListener("pointerleave",e=>{
  const button=e.target.closest?.("button");
  if(button)button.classList.remove("ui-pressed");
},true);

void loadNotifications();
notificationTimerId=setInterval(()=>{if(!document.hidden)void loadNotifications();},8000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)void loadNotifications();});

render(location.hash.slice(1)||"login",{replace:true});