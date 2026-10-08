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
function scheduleCompetitionCode(game){
  return normalizeCompetitionCode(game?.competition||game?.leagueCode||game?.league||"");
}
function normalizeTeamKey(value){return String(value||"").toLowerCase().replace(/[^a-z0-9]/g,"");}

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
function playerIsDraftable(player){
  return player?.draftable!==false && String(player?.rosterStatus||"starter").toLowerCase()!=="reserve";
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
function eligibleDraftPool(settings=getLeagueSettings()){
  const code=normalizeCompetitionCode(settings?.competition);
  return draftPool.filter(p=>playerEligibleForCompetition(p,code)&&playerIsDraftable(p));
}

const draftManagerNames = ["Baron Bandits","Zeuxidamus","Rift Raiders","Pentakill Club","Nexus Breakers","Blue Buff Boys","Dragon Slayers","Iron V","Red Side","First Blood","Scuttle Club","Elder Enjoyers"];
let draftTimerId=null;
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
  scoring:{kills:3,deaths:-1,assists:2,cs:0.02,win:5,firstBlood:2}
};

function getLeagueSettings(){
  try{
    const saved=JSON.parse(storageGet("riftLeagueSettings")||"{}")||{};
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

let selectedPlayerId=null;
let selectedMatchupRound=null;
let tradePrefill={id:null,side:null};
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

function getUserRoster(){
  try{
    const saved=JSON.parse(storageGet("riftUserRoster")||"null");
    return Array.isArray(saved) ? saved : defaultUserRoster();
  }catch{
    return defaultUserRoster();
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
      player_id:key,total:0,live:false,finalized:true,games:0,latest:null,rows:[],
      breakdown:Object.fromEntries(keys.map(k=>[k,{stat:0,multiplier:null,points:0}]))
    };
    current.total+=Number(score.fantasy_points)||0;
    current.games+=1;
    current.live=current.live||!score.finalized;
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
  return map;
}
function getActiveLeagueId(){
  return storageGet("riftActiveLeagueId")||null;
}
function setActiveLeagueId(id){
  if(id)storageSet("riftActiveLeagueId",String(id));
  else storageRemove("riftActiveLeagueId");
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
    storageSet("riftUserRoster",JSON.stringify(loaded.length?normalizeUserRoster(loaded):[]));
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
  storageSet("riftUserRoster",JSON.stringify(normalized));
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
  copy.textContent=`Your roster is full. Choose who to drop for ${incoming.name}.`;
  list.innerHTML=current.map(p=>`<button class="drop-option" data-drop-id="${playerKey(p)}"><span class="role-badge">${h(p.slot||p.role)}</span><span><strong>${h(p.name)}</strong><small>${h(p.team)} · ${h(p.position||p.role)}</small></span><span class="drop-action">DROP</span></button>`).join("");
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
  copy.textContent="Your roster is full. Choose who would be dropped if your waiver claim for "+incoming.name+" wins.";
  list.innerHTML=current.map(p=>'<button class="drop-option" data-waiver-drop-id="'+playerKey(p)+'"><span class="role-badge">'+h(p.slot||p.role)+'</span><span><strong>'+h(p.name)+'</strong><small>'+h(p.team)+' · '+h(p.position||p.role)+'</small></span><span class="drop-action">DROP IF WON</span></button>').join("");
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
  const pool=allFantasyPlayers().filter(p=>playerEligibleForCompetition(p,code)&&playerIsDraftable(p));
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

function openPlayer(id){
  selectedPlayerId=id;
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
    ${manage?(locked?'<div class="team-actions"><span class="locked-action">Match started</span></div>':'<div class="team-actions">'+lineupAction+'<button class="mini-btn danger" data-drop-roster="'+playerKey(p)+'">DROP</button></div>'):""}
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
  if(["home","league","create-league","join-league","bot-league","bot-settings","bot-confirm","bot-success","my-schedule"].includes(view)&&!backend()?.readSession?.()?.access_token){
    return render("login",{...options,replace:true});
  }
  if(view!=="draft"&&draftTimerId){clearInterval(draftTimerId);draftTimerId=null;}
  if(!options.fromHistory){
    const hash="#"+view;
    if(options.replace||currentView===null){
      const depth=Number(history.state?.depth)||0;
      navigationDepth=depth;
      history.replaceState({view,depth},"",hash);
    }else if(currentView!==view){
      navigationDepth+=1;
      history.pushState({view,depth:navigationDepth},"",hash);
    }
  }
  currentView=view;
  app.innerHTML="";
  app.appendChild(template.content.cloneNode(true));
  const titles={login:"Sign In",signup:"Create Account",verify:"Verify Email",home:"Home",account:"Account",team:"My Team",matchup:"Matchup",standings:"Standings",schedule:"Schedule","my-schedule":"My Schedule",players:"Players",player:"Player",league:"League","create-league":"Create League","join-league":"Join League","bot-league":"Create Bot League","bot-settings":"Bot League Settings","bot-confirm":"Confirm Bot League","bot-success":"League Created",transactions:"Transactions",trade:"Trades",draft:"Draft Room",setup:"League Setup"};
  document.title=`${titles[view]||"Rift Fantasy"} · Rift Fantasy`;
  document.body.classList.toggle("login-view",["login","signup","verify"].includes(view));
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
    player:"players"
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
      document.querySelector("#authHelp").textContent="Account services are temporarily unavailable. You can still use the app locally.";
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
        const opsCard=document.querySelector("#opsCard");
        if(opsCard){
          try{
            const ops=await b.getOpsSnapshot();
            opsCard.hidden=false;
            const critical=Number(ops?.critical_anomalies)||0;
            const open=Number(ops?.open_anomalies)||0;
            const opsStatus=document.querySelector("#opsStatus");
            opsStatus.textContent=critical?"ATTENTION":"HEALTHY";
            const summary=document.querySelector("#opsSummary");
            summary.innerHTML=[
              ["Active leagues",ops?.active_leagues??0],
              ["Managers",ops?.active_users??0],
              ["Open anomalies",open],
              ["Critical",critical]
            ].map(function(row){return '<div class="profile-stat"><small>'+h(row[0])+'</small><strong>'+h(row[1])+'</strong></div>';}).join("");
            const sources=Array.isArray(ops?.data_sources)?ops.data_sources:[];
            const jobs=Array.isArray(ops?.cron)?ops.cron:[];
            document.querySelector("#opsDetails").innerHTML=
              '<div class="ops-list"><strong>Data sources</strong>'+(sources.map(function(x){return "<small>"+h(x.source)+" · "+h(String(x.status||"unknown").toUpperCase())+"</small>";}).join("")||"<small>No source telemetry.</small>")+"</div>"+
              '<div class="ops-list"><strong>Background jobs</strong>'+(jobs.map(function(x){return "<small>"+h(x.jobname)+" · "+h(String(x.status||"unknown").toUpperCase())+"</small>";}).join("")||"<small>No cron telemetry.</small>")+"</div>";
          }catch{opsCard.hidden=true;}
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
    const tournamentList=document.querySelector("#homeTournamentList");
    const summary=document.querySelector("#homeEsportsSummary");
    const healthBadge=document.querySelector("#homeDataHealth");
    const healthCopy=document.querySelector("#homeDataHealthCopy");
    const onboardingCard=document.querySelector("#onboardingCard");
    if(onboardingCard){
      let dismissed=false;
      try{dismissed=localStorage.getItem("riftOnboardingDismissed")==="1";}catch{}
      onboardingCard.hidden=dismissed;
      const dismiss=document.querySelector("#dismissOnboarding");
      if(dismiss)dismiss.onclick=function(){try{localStorage.setItem("riftOnboardingDismissed","1");}catch{} onboardingCard.hidden=true;};
    }

    const rows=proSchedule.map(localScheduleRow).sort((a,b)=>{
      const ta=Date.parse(a.startTime||a.date||"");
      const tb=Date.parse(b.startTime||b.date||"");
      if(Number.isFinite(ta)&&Number.isFinite(tb))return ta-tb;
      return 0;
    });

    const upcoming=rows.filter(g=>g.day!=="past").slice(0,3);
    const tournaments=[...new Set(rows.map(g=>String(g.league||"").trim()).filter(Boolean))].slice(0,4);

    if(summary){
      summary.textContent=upcoming.length
        ?`Quick look at the next ${upcoming.length} professional match${upcoming.length===1?"":"es"} currently available in the Rift Fantasy esports feed.`
        :"No upcoming professional matches are currently available in the local esports feed.";
    }

    if(upcomingList){
      upcomingList.innerHTML=upcoming.length?upcoming.map(g=>`
        <div class="home-match-row">
          <div class="home-match-teams">
            <strong>${h(g.a||"TBD")} <span>vs</span> ${h(g.b||"TBD")}</strong>
            <small>${h(g.league||"LoL Esports")}${g.stage?" · "+h(g.stage):""}</small>
          </div>
          <div class="home-match-time">
            <strong>${h(g.time||"TBD")}</strong>
            <small>${h(g.label||"Upcoming")}</small>
          </div>
        </div>`).join("")
        :'<div class="empty-state"><strong>No upcoming matches</strong><small>Check back after the next esports-data refresh.</small></div>';
    }

    if(tournamentList){
      tournamentList.innerHTML=tournaments.length
        ?tournaments.map(name=>`<div class="home-tournament-chip">${h(name)}</div>`).join("")
        :'<div class="empty-state"><strong>Tournament feed unavailable</strong><small>Rift Fantasy will continue using the existing local esports data when it becomes available.</small></div>';
    }

    if(healthBadge&&healthCopy&&cloudReady()){
      (async()=>{
        try{
          const health=await backend().listDataSourceHealth();
          const riot=health.find(x=>x.source==="riot_esports");
          const chain=health.find(x=>x.source==="chaincc");
          const successAt=riot?.last_success_at?Date.parse(riot.last_success_at):0;
          const ageMs=successAt?Date.now()-successAt:Infinity;
          const stale=ageMs>2*60*1000;
          const delayed=riot?.status==="delayed"||riot?.status==="error"||stale;
          healthBadge.textContent=delayed?"DATA DELAYED":"LIVE DATA HEALTHY";
          healthBadge.classList.toggle("delayed",delayed);
          healthBadge.classList.toggle("healthy",!delayed);
          if(delayed){
            const mins=Number.isFinite(ageMs)?Math.max(1,Math.round(ageMs/60000)):null;
            healthCopy.textContent=mins
              ?`Primary live feed delayed. Last good update about ${mins} minute${mins===1?"":"s"} ago; stored scores are being preserved.`
              :"Primary live feed is delayed; stored scores are being preserved until current data returns.";
          }else{
            const secondary=chain?.status==="healthy"?" Historical validation source available.":"";
            healthCopy.textContent="Primary LoL Esports feed is responding normally."+secondary;
          }
        }catch{
          healthBadge.textContent="DATA STATUS UNKNOWN";
          healthBadge.classList.add("delayed");
          healthCopy.textContent="Could not read source-health telemetry. Existing stored fantasy data remains available.";
        }
      })();
    }else if(healthBadge&&healthCopy){
      healthBadge.textContent="LOCAL DATA";
      healthCopy.textContent="Cloud source-health telemetry is available after sign-in.";
    }
  }
  if(view==="team"){
    const leagueId=getActiveLeagueId();
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
    let activeLineupLocks=new Map();
    const refreshTeam=()=>render("team",{replace:true});

    const bindRosterActions=()=>{
      document.querySelectorAll("[data-drop-roster]").forEach(btn=>btn.onclick=async()=>{
        if(!rosterMovesEnabled)return showToast("Roster moves unlock after the draft.");
        const currentNow=getUserRoster();
        const player=currentNow.find(p=>playerKey(p)===btn.dataset.dropRoster);
        if(!player)return;
        const next=currentNow.filter(p=>playerKey(p)!==btn.dataset.dropRoster);
        const nextStatus=validateRoster(next);
        const warning=nextStatus.isComplete?"":` This will leave your roster incomplete. ${rosterStatusText(nextStatus)}`;
        if(!window.confirm(`Drop ${player.name} from your roster?${warning}`))return;
        btn.disabled=true;
        try{
          await saveUserRoster(next);
          logTransaction("drop",player);
          showToast(`${player.name} dropped`);
          refreshTeam();
        }catch(err){showToast(err.message||"Could not drop player");btn.disabled=false;}
      });

      document.querySelectorAll("[data-bench-roster]").forEach(btn=>btn.onclick=async()=>{
        if(!rosterMovesEnabled)return showToast("Lineup changes unlock after the draft.");
        const currentNow=getUserRoster();
        const player=currentNow.find(p=>playerKey(p)===btn.dataset.benchRoster);
        if(!player)return;
        const next=currentNow.map(p=>playerKey(p)===playerKey(player)?{...p,position:playerPosition(p),slot:"BN",role:"BN"}:p);
        if(validateRoster(currentNow).isComplete&&!validateRoster(next).isComplete){
          if(!window.confirm(`Bench ${player.name}? This will leave your starting lineup incomplete until you start another player.`))return;
        }
        btn.disabled=true;
        try{
          await saveUserRoster(next);
          showToast(`${player.name} moved to bench`);
          refreshTeam();
        }catch(err){showToast(err.message||"Could not update lineup");btn.disabled=false;}
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
      const current=getUserRoster().map(p=>({...p,lineupLock:activeLineupLocks.get(playerKey(p))||null}));
      const validation=validateRoster(current);
      const starters=current.filter(p=>ROSTER_RULES.starterSlots.includes(p.slot||p.role));
      const flex=current.filter(p=>(p.slot||p.role)==="FLEX");
      const bench=current.filter(p=>(p.slot||p.role)==="BN");
      rosterCount.textContent=`${current.length}/${validation.totalRequired}`;
      starterCount.textContent=`${starters.length+flex.length}/6`;

      statusBanner.classList.toggle("complete",validation.isComplete);
      statusBanner.classList.toggle("incomplete",!validation.isComplete);
      statusTitle.textContent=validation.isComplete?"✓ Roster Complete":"⚠ Roster Incomplete";
      statusCopy.textContent=rosterStatusText(validation);

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
          badge.textContent=String(activeLeague?.status||"pre_draft").replace("_"," ").toUpperCase();
          badge.hidden=false;
          rosterMovesEnabled=activeLeague?.status==="active";

          document.querySelectorAll('.team-screen [data-jump="players"],.team-screen [data-jump="transactions"]').forEach(el=>{
            if(el.dataset.jump==="players"){
              el.disabled=!rosterMovesEnabled;
              el.title=rosterMovesEnabled?"":"Players can be added after the league draft.";
            }
          });

          await loadRosterFromCloud(leagueId);
          const rounds=await b.listFantasyRounds(leagueId);
          const activeRound=rounds.find(r=>r.status==="live");
          const competition=normalizeCompetitionCode(activeLeague?.settings?.competition)||"worlds";
          const statusRows=await b.listPlayerCompetitionStatus(competition).catch(()=>[]);
          activeLineupLocks=new Map();
          if(activeRound){
            const locks=await b.listLineupLocks(leagueId,activeRound.round_number);
            locks
              .filter(lock=>String(lock.manager_id)===String(user.id)&&String(lock.manager_type)==="human")
              .forEach(lock=>activeLineupLocks.set(String(lock.player_id),lock));
          }
          const rosterNow=getUserRoster();
          const rosterIds=new Set(rosterNow.map(playerKey));
          const relevantStatus=statusRows.filter(x=>rosterIds.has(String(x.player_id)));
          const nextTimes=relevantStatus.map(x=>Date.parse(x.next_match_at||"")).filter(Number.isFinite).filter(t=>t>Date.now()).sort((a,b)=>a-b);
          const nextLockEl=document.querySelector("#teamNextLock");
          const lockStatusEl=document.querySelector("#teamLockStatus");
          if(nextLockEl){
            nextLockEl.textContent=nextTimes.length?new Date(nextTimes[0]).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"No upcoming lock";
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
        const playerStatus=statusRows.find(x=>String(x.player_id)===playerKey(p)&&normalizeCompetitionCode(x.competition)===leagueCompetition);
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

        document.querySelector("#profileStatus").textContent=mine?"On your roster":other?"Rostered by another manager":!eligible?`Not eligible for ${competitionName(leagueCompetition)}`:!draftable?"Reserve · Not currently draftable":"Available";
        if((!eligible||!draftable)&&!mine&&!other){
          addBtn.disabled=true;
          addBtn.textContent=!eligible?"Not Eligible":"Reserve";
          waiverBtn.disabled=true;
          waiverBtn.textContent=!eligible?"Not Eligible":"Reserve";
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
          addBtn.disabled=false;
          addBtn.textContent=getUserRoster().length>=rosterLimit()?"Add / Choose Drop":"Add Player";
          addBtn.onclick=()=>addPlayerToRoster(p);
          waiverBtn.disabled=false;
          waiverBtn.onclick=async()=>{waiverBtn.disabled=true;await createWaiverClaim(p);waiverBtn.disabled=false;};
          tradeBtn.disabled=true;
        }
      }catch(err){
        addBtn.disabled=true;
        waiverBtn.disabled=true;
        tradeBtn.disabled=true;
      }
    };
    void configureLeagueActions();
    document.querySelector("#playerBackBtn").onclick=()=>goBack("players");
  }
  if(view==="standings"){
    const list=document.querySelector("#standingsList");
    const leagueId=getActiveLeagueId();
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
          if(name)name.textContent=String(league?.name||"League").toUpperCase();

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
            const detail=s.isBot?"🤖 Bot":(s.manager.role==="owner"?"Commissioner":"Manager")+(s.mine?" · You":"");
            return `<div class="standing-live-row real-standings-row ${s.mine?"mine":""} ${s.isBot?"bot-manager-row":""}">
              <span class="rank">${Number(s.rank)||"—"}</span>
              <div class="standing-live-team">
                <strong>${h(s.manager.team_name||"Unnamed Team")}</strong>
                <small>${h(detail)}</small>
              </div>
              <div class="standing-live-record">
                <strong>${h(s.record)}</strong>
                <small>${s.completed_matchups?((s.pct*100).toFixed(1)+"%"):"No finals"}</small>
              </div>
              <div class="standing-stat-cell"><strong>${formatFantasyPoints(s.points_for)}</strong><small>PF</small></div>
              <div class="standing-stat-cell"><strong>${formatFantasyPoints(s.points_against)}</strong><small>PA</small></div>
              <div class="standing-stat-cell"><strong>${Number(s.byes)||0}</strong><small>BYE</small></div>
            </div>`;
          }).join(""):'<div class="empty-state"><strong>No standings yet</strong><small>Standings are created automatically after the league draft.</small></div>';
        }catch(err){
          if(status)status.textContent="ERROR";
          list.innerHTML='<div class="empty-state"><strong>Could not load standings</strong><small>'+h(err.message||"Try again later.")+'</small></div>';
        }
      })();
    }
  }
  if(view==="matchup"){
    const leagueId=getActiveLeagueId();
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
      const remaining=items.filter(x=>["LIVE","UPCOMING","MORE GAMES"].includes(x.state)).length;
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
            <div class="matchup-player-state"><span class="${state==="LIVE"?"live":""}">${locked?"🔒 ":""}${h(state)}</span><strong>${formatFantasyPoints(score.total)}</strong></div>
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
          if(leagueTitle)leagueTitle.textContent=String(league?.name||"Matchup");
          if(eyebrow)eyebrow.textContent="HEAD TO HEAD · "+competitionName(league?.settings?.competition||"");

          if(!rounds.length){
            const compName=competitionName(league?.settings?.competition||"");
            board.innerHTML='<div class="empty-state"><strong>No active fantasy scoring period</strong><small>'+h(compName)+' has no scheduled matches after this league\'s draft. Rift Fantasy will create the next scoring period automatically when the pro schedule contains eligible matches.</small></div>';
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
          prevBtn.onclick=()=>{if(roundIndex>0){selectedMatchupRound=Number(rounds[roundIndex-1].round_number);render("matchup",{replace:true});}};
          nextBtn.onclick=()=>{if(roundIndex<rounds.length-1){selectedMatchupRound=Number(rounds[roundIndex+1].round_number);render("matchup",{replace:true});}};

          roundLabel.textContent=round.label||((round.stage?round.stage+" · ":"")+"Round "+round.round_number);
          roundStatus.textContent=round.status==="live"?"LIVE FANTASY PERIOD":round.status==="final"?"FINAL":"UPCOMING";
          roundStatus.classList.toggle("live",round.status==="live");
          const matchText=Number(round.match_count)>0?" · "+Number(round.match_count)+" pro match"+(Number(round.match_count)===1?"":"es"):"";
          roundDates.textContent=formatRoundDate(round.starts_at)+" – "+formatRoundDate(new Date(Date.parse(round.ends_at)-1))+matchText;
          
          const [matchups,proMatches,lineupLocks]=await Promise.all([
            b.listLeagueMatchups(leagueId,round.round_number),
            b.listProMatches(league?.settings?.competition||null,round.starts_at,round.ends_at),
            b.listLineupLocks(leagueId,round.round_number)
          ]);
          const lockMap=new Map(lineupLocks.map(lock=>[
            String(lock.manager_type)+":"+String(lock.manager_id)+":"+String(lock.player_id),
            lock
          ]));
          const myMatchup=matchups.find(m=>
            (String(m.home_manager_id||"")===String(user?.id))||
            (String(m.away_manager_id||"")===String(user?.id))
          );
          if(!myMatchup){
            board.innerHTML='<div class="empty-state"><strong>No matchup found</strong><small>Your team is not paired in this fantasy round.</small></div>';
            return;
          }

          const managerNames=new Map();
          members.forEach(m=>managerNames.set(managerKey(m.user_id,"human"),m.team_name||"Unnamed Team"));
          bots.forEach(m=>managerNames.set(managerKey(m.id,"bot"),m.team_name||"Bot Manager"));
          const source=allFantasyPlayers();

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
      }).join(""):(rosterOnly
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
            if(title&&leagueCompetition)title.textContent=rosterOnly?"My "+competitionName(leagueCompetition)+" Schedule":competitionName(leagueCompetition)+" Schedule";
            if(copy&&leagueCompetition)copy.textContent=rosterOnly
              ?"Only "+competitionName(leagueCompetition)+" matches involving players on your current fantasy roster."
              :"Official "+competitionName(leagueCompetition)+" matches in the current schedule window.";
            const [loaded,matches,user,rounds,matchups,allRosters]=await Promise.all([
              loadRosterFromCloud(leagueId),
              backend().listProMatches?.(leagueCompetition),
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
    let playerStatusMap=new Map();

    const draw=()=>{
      const q=search.value.trim().toLowerCase();
      const source=getActiveLeagueId()?eligibleFantasyPlayers():allFantasyPlayers();
      const filtered=source.filter(p=>(role==="ALL"||p.role===role)&&(`${p.name} ${p.team} ${p.role}`.toLowerCase().includes(q)));
      list.innerHTML=filtered.map(p=>playerRow(p,true)).join("") || '<div class="empty-state"><strong>No players found</strong><small>Try a different name, team, or role.</small></div>';

      list.querySelectorAll(".add-btn").forEach((b,i)=>{
        const p=filtered[i];
        const pid=playerKey(p);
        const ownership=leagueRosters.find(r=>String(r.player_id)===String(pid));
        const state=b.closest(".player-fantasy-state")?.querySelector(".player-status-label");
        const availability=playerStatusMap.get(String(pid));
        const unavailable=availability&&["inactive","eliminated","season_complete"].includes(String(availability.status));
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
          const label=String(availability.status).replaceAll("_"," ").toUpperCase();
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
            state.textContent=availability
              ?String(availability.status).replaceAll("_"," ")
              :"Free agent";
          }
          b.onclick=async e=>{e.stopPropagation();b.disabled=true;await addPlayerToRoster(p);await refreshOwnership();};
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
        leagueStatus=activeLeague?.status||null;
        leagueCompetition=normalizeCompetitionCode(activeLeague?.settings?.competition)||null;
        const statuses=leagueCompetition?await b.listPlayerCompetitionStatus(leagueCompetition).catch(()=>[]):[];
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
    const partnerSelect=document.querySelector("#tradePartner");
    const myList=document.querySelector("#tradeMyPlayers");
    const theirList=document.querySelector("#tradeTheirPlayers");
    const summary=document.querySelector("#tradeSummaryBox");
    const submit=document.querySelector("#submitTradeBtn");
    const content=document.querySelector("#tradeContent");
    let tab="offers";
    let selectedMine=tradePrefill.side==="mine"?tradePrefill.id:null;
    let selectedTheirs=tradePrefill.side==="theirs"?tradePrefill.id:null;
    tradePrefill={id:null,side:null};
    let user=null,members=[],rosters=[],trades=[];
    let isCommissioner=false;
    const playerFromId=id=>playerById(id)||{id,name:id,team:"",role:""};

    const partnerName=id=>members.find(m=>String(m.user_id)===String(id))?.team_name||"Manager";
    const currentPartner=()=>partnerSelect.value;
    const myRoster=()=>rosters.filter(r=>String(r.user_id)===String(user?.id));
    const theirRoster=()=>rosters.filter(r=>String(r.user_id)===String(currentPartner()));

    const refreshTradeData=async()=>{
      if(!leagueId||!cloudReady())throw new Error("Select an online league before trading.");
      const b=backend();
      [user,members,rosters,trades]=await Promise.all([
        b.currentUser(),
        b.listLeagueMembers(leagueId),
        b.listRosters(leagueId),
        b.listTrades(leagueId)
      ]);
      if(!user)throw new Error("Sign in before trading.");
      isCommissioner=members.some(m=>String(m.user_id)===String(user.id)&&m.role==="owner");
    };

    const renderBuilder=()=>{
      const mine=myRoster();
      const theirs=theirRoster();
      if(selectedMine&&!mine.some(r=>String(r.player_id)===String(selectedMine)))selectedMine=null;
      if(selectedTheirs&&!theirs.some(r=>String(r.player_id)===String(selectedTheirs)))selectedTheirs=null;

      myList.innerHTML=mine.length?mine.map(r=>{
        const p=playerFromId(r.player_id);
        return `<button class="trade-option ${String(selectedMine)===String(r.player_id)?"selected":""}" data-trade-mine="${h(r.player_id)}"><strong>${h(p.name)}</strong><small>${h(p.role||r.slot)} · ${h(p.team)}</small></button>`;
      }).join(""):'<div class="empty-state"><strong>No rostered players</strong><small>Your drafted roster will appear here.</small></div>';

      theirList.innerHTML=theirs.length?theirs.map(r=>{
        const p=playerFromId(r.player_id);
        return `<button class="trade-option ${String(selectedTheirs)===String(r.player_id)?"selected":""}" data-trade-theirs="${h(r.player_id)}"><strong>${h(p.name)}</strong><small>${h(p.role||r.slot)} · ${h(p.team)}</small></button>`;
      }).join(""):'<div class="empty-state"><strong>No players to trade for</strong><small>This manager does not have a roster yet.</small></div>';

      const mineP=mine.find(r=>String(r.player_id)===String(selectedMine));
      const theirP=theirs.find(r=>String(r.player_id)===String(selectedTheirs));
      if(mineP&&theirP){
        summary.innerHTML=`You send <strong>${h(playerFromId(mineP.player_id).name)}</strong> to ${h(partnerName(currentPartner()))} and receive <strong>${h(playerFromId(theirP.player_id).name)}</strong>.`;
        submit.disabled=false;
      }else{
        summary.textContent="Select one player from each side to build an offer.";
        submit.disabled=true;
      }

      myList.querySelectorAll("[data-trade-mine]").forEach(btn=>btn.onclick=()=>{selectedMine=btn.dataset.tradeMine;renderBuilder();});
      theirList.querySelectorAll("[data-trade-theirs]").forEach(btn=>btn.onclick=()=>{selectedTheirs=btn.dataset.tradeTheirs;renderBuilder();});
    };

    const renderTabs=()=>{
      const outgoing=trades.filter(t=>String(t.from_user)===String(user?.id)&&t.status==="pending");
      const incoming=trades.filter(t=>String(t.to_user)===String(user?.id)&&t.status==="pending");
      const history=trades.filter(t=>t.status!=="pending"&&(
        String(t.from_user)===String(user?.id)||
        String(t.to_user)===String(user?.id)||
        (isCommissioner&&t.status==="review_pending")
      ));
      const renderCard=t=>{
        const sent=playerFromId(t.offer?.send_player_id);
        const received=playerFromId(t.offer?.receive_player_id);
        const isOutgoing=String(t.from_user)===String(user?.id);
        const counterpart=isOutgoing?partnerName(t.to_user):partnerName(t.from_user);
        const status=String(t.status||"pending");
        const commissionerQueue=isCommissioner&&status==="review_pending";
        const userParty=String(t.from_user)===String(user?.id)||String(t.to_user)===String(user?.id);
        const swapMarkup=commissionerQueue&&!userParty
          ?`<div class="trade-swap"><div class="trade-side"><span>${h(partnerName(t.from_user))} SENDS</span><strong>${h(sent.name)}</strong></div><div class="trade-arrow">⇄</div><div class="trade-side"><span>${h(partnerName(t.to_user))} SENDS</span><strong>${h(received.name)}</strong></div></div>`
          :`<div class="trade-swap"><div class="trade-side"><span>YOU SEND</span><strong>${h(isOutgoing?sent.name:received.name)}</strong></div><div class="trade-arrow">⇄</div><div class="trade-side"><span>YOU RECEIVE</span><strong>${h(isOutgoing?received.name:sent.name)}</strong></div></div>`;
        const actions=status==="pending"
          ?(isOutgoing
            ?`<div class="trade-card-actions"><button class="secondary-btn" data-cancel-trade="${h(t.id)}">Cancel Offer</button></div>`
            :`<div class="trade-card-actions"><button class="primary-btn" data-accept-trade="${h(t.id)}">Accept</button><button class="secondary-btn" data-decline-trade="${h(t.id)}">Decline</button></div>`)
          :(commissionerQueue
            ?`<div class="trade-card-actions"><button class="primary-btn" data-approve-trade="${h(t.id)}">Approve</button><button class="secondary-btn" data-reject-trade="${h(t.id)}">Reject</button></div>`
            :"");
        return `<div class="trade-card">
          <div class="trade-card-head"><div><h4>${h(commissionerQueue?"Commissioner Review":counterpart)}</h4><small>${new Date(t.created_at).toLocaleString()}</small></div><span class="trade-status ${h(status)}">${h(status.replaceAll("_"," ").toUpperCase())}</span></div>
          ${swapMarkup}
          ${status==="review_pending"?'<small class="trade-review-copy">Recipient accepted. Rosters do not change until commissioner approval.</small>':""}
          ${actions}
        </div>`;
      };
      const rows=tab==="offers"?outgoing:tab==="incoming"?incoming:history;
      content.innerHTML=rows.length?rows.map(renderCard).join(""):`<div class="empty-state"><strong>No ${tab==="offers"?"outgoing offers":tab==="incoming"?"incoming offers":"trade history"}</strong><small>Trades from your active league will appear here.</small></div>`;

      content.querySelectorAll("[data-cancel-trade]").forEach(btn=>btn.onclick=async()=>{
        try{await backend().updateTrade(btn.dataset.cancelTrade,"canceled");showToast("Trade offer canceled");await init();}
        catch(err){showToast(err.message||"Could not cancel trade");}
      });
      content.querySelectorAll("[data-decline-trade]").forEach(btn=>btn.onclick=async()=>{
        try{await backend().updateTrade(btn.dataset.declineTrade,"declined");showToast("Trade declined");await init();}
        catch(err){showToast(err.message||"Could not decline trade");}
      });
      content.querySelectorAll("[data-accept-trade]").forEach(btn=>btn.onclick=async()=>{
        try{
          const result=await backend().acceptTrade(btn.dataset.acceptTrade);
          await loadRosterFromCloud(leagueId);
          showToast(result?.status==="review_pending"?"Trade accepted · Awaiting commissioner review":"Trade accepted");
          await init();
        }catch(err){showToast(err.message||"Could not accept trade");}
      });
      content.querySelectorAll("[data-approve-trade]").forEach(btn=>btn.onclick=async()=>{
        try{await backend().reviewTrade(btn.dataset.approveTrade,true);await loadRosterFromCloud(leagueId);showToast("Trade approved");await init();}
        catch(err){showToast(err.message||"Could not approve trade");}
      });
      content.querySelectorAll("[data-reject-trade]").forEach(btn=>btn.onclick=async()=>{
        try{await backend().reviewTrade(btn.dataset.rejectTrade,false);showToast("Trade rejected");await init();}
        catch(err){showToast(err.message||"Could not reject trade");}
      });
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

    partnerSelect.onchange=()=>{selectedTheirs=null;renderBuilder();};
    submit.onclick=async()=>{
      const mine=myRoster().find(r=>String(r.player_id)===String(selectedMine));
      const theirs=theirRoster().find(r=>String(r.player_id)===String(selectedTheirs));
      if(!mine||!theirs)return;
      submit.disabled=true;
      try{
        await backend().createTrade(leagueId,currentPartner(),{send_player_id:mine.player_id,receive_player_id:theirs.player_id});
        selectedMine=null;
        selectedTheirs=null;
        showToast("Trade offer sent");
        await init();
      }catch(err){
        showToast(err.message||"Could not send trade offer");
        renderBuilder();
      }
    };

    document.querySelectorAll("[data-trade-tab]").forEach(btn=>btn.onclick=()=>{
      tab=btn.dataset.tradeTab;
      document.querySelectorAll("[data-trade-tab]").forEach(x=>x.classList.toggle("active",x===btn));
      renderTabs();
    });
    void init();
  }
  if(view==="transactions"){
    let tab="pending";
    const content=document.querySelector("#transactionContent");
    const count=document.querySelector("#pendingClaimCount");
    const moveCount=document.querySelector("#transactionMoveCount");
    const leagueName=document.querySelector("#transactionLeagueName");
    const leagueId=getActiveLeagueId();
    let user=null,claims=[],moves=[],members=[],leagues=[],priorities=[];
    const fmt=iso=>{const d=new Date(iso);return Number.isNaN(d.getTime())?"":d.toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});};
    const memberName=id=>members.find(m=>String(m.user_id)===String(id))?.team_name||"Manager";
    const playerFromId=id=>playerById(id)||{id,name:id,team:"",role:""};

    const draw=()=>{
      const mineClaims=claims.filter(c=>String(c.user_id)===String(user?.id)&&c.status==="pending");
      count.textContent=mineClaims.length;
      moveCount.textContent=moves.length;
      if(tab==="pending"){
        content.innerHTML=mineClaims.length?mineClaims.map(c=>{const p=playerFromId(c.player_id);return `<div class="transaction-item"><span class="transaction-icon claim">W</span><div class="transaction-info"><strong>${h(p.name)}<span class="status-pill pending">PENDING</span></strong><small>${h(p.team)} · Priority ${h(c.priority)}${c.process_after?" · Processes "+h(fmt(c.process_after)):""}</small><div class="claim-actions"><button class="claim-btn cancel" data-cancel-claim="${h(c.id)}">Cancel</button></div></div><span class="transaction-time">${fmt(c.created_at)}</span></div>`;}).join(""):'<div class="empty-state"><strong>No pending waiver claims</strong><small>Open a player profile and tap Waiver Claim to submit one.</small></div>';
        content.querySelectorAll("[data-cancel-claim]").forEach(btn=>btn.onclick=async()=>{try{await backend().cancelWaiver(btn.dataset.cancelClaim);showToast("Waiver claim canceled");await init();}catch(err){showToast(err.message||"Could not cancel claim");}});
      }else if(tab==="history"){
        const mine=moves.filter(m=>String(m.user_id)===String(user?.id));
        content.innerHTML=mine.length?mine.map(m=>{const p=playerFromId(m.player_id);return `<div class="transaction-item"><span class="transaction-icon ${m.action==="drop"?"drop":""}">${m.action==="add"?"+":"−"}</span><div class="transaction-info"><strong>${m.action==="add"?"Added":"Dropped"} ${h(p.name)}<span class="status-pill success">COMPLETE</span></strong><small>${h(p.team)} · ${h(p.role||"")}</small></div><span class="transaction-time">${fmt(m.created_at)}</span></div>`;}).join(""):'<div class="empty-state"><strong>No roster moves yet</strong><small>Your completed adds and drops will appear here.</small></div>';
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
        [user,claims,moves,members,leagues,priorities]=await Promise.all([
          b.currentUser(),b.listWaivers(leagueId),b.listTransactions(leagueId),
          b.listLeagueMembers(leagueId),b.listLeagues(),b.listWaiverPriority(leagueId).catch(()=>[])
        ]);
        leagueName.textContent=leagues.find(l=>String(l.id)===String(leagueId))?.name||"League";
        const minePriority=priorities.find(x=>String(x.manager_id)===String(user?.id)&&x.manager_type==="human");
        const priorityCopy=document.querySelector("#waiverPriorityCopy");
        if(priorityCopy)priorityCopy.textContent=minePriority?"Your current waiver priority: #"+minePriority.priority:"Waiver priority initializes automatically.";
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
    const quickAccess=document.querySelector("#leagueQuickAccess");
    const rulesModal=document.querySelector("#leagueRulesModal");
    const entryActions=document.querySelector("#leagueEntryActions");

    if(!getActiveLeagueId()){
      if(overviewCard)overviewCard.hidden=true;
      if(activeLeagueEntryCard)activeLeagueEntryCard.hidden=true;
      if(quickAccess)quickAccess.hidden=true;
      if(rulesModal)rulesModal.hidden=true;
    }

    (async()=>{
      if(!cloudReady()){
        if(overviewCard)overviewCard.hidden=true;
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

      try{
        const leagues=await b.listLeagues();
        let activeId=getActiveLeagueId();

        if(activeId&&!leagues.some(l=>String(l.id)===String(activeId))){
          setActiveLeagueId(null);
          activeId=null;
        }
        if(!activeId&&leagues.length){
          activeId=String(leagues[0].id);
          setActiveLeagueId(activeId);
          await loadRosterFromCloud(activeId);
        }

        if(!leagues.length){
          if(overviewCard)overviewCard.hidden=true;
          if(activeLeagueEntryCard)activeLeagueEntryCard.hidden=true;
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

        const memberships=await Promise.all(leagues.map(async league=>{
          try{
            const members=await b.listLeagueMembers(league.id);
            return members.find(m=>String(m.user_id)===String(user.id))||null;
          }catch{return null;}
        }));
        const activeLeague=leagues.find(l=>String(l.id)===String(activeId))||leagues[0];
        const activeIndex=leagues.findIndex(l=>String(l.id)===String(activeLeague.id));
        const activeMembership=memberships[activeIndex]||null;
        const activeSettings={
          ...defaultLeagueSettings,
          ...(activeLeague.settings||{}),
          competition:normalizeCompetitionCode(activeLeague.settings?.competition)||"worlds",
          competitionSeason:Number(activeLeague.settings?.competitionSeason)||2026,
          competitionType:competitionType(activeLeague.settings?.competition),
          scoring:{...defaultLeagueSettings.scoring,...(activeLeague.settings?.scoring||{})}
        };
        storageSet("riftLeagueSettings",JSON.stringify(activeSettings));

        if(overviewCard)overviewCard.hidden=false;
        if(activeLeagueEntryCard)activeLeagueEntryCard.hidden=false;
        if(quickAccess)quickAccess.hidden=false;
        if(rulesModal)rulesModal.hidden=true;
        if(cloudCard)cloudCard.hidden=true;
        cloudCard?.classList.remove("empty-league-mode");
        if(entryActions)entryActions.classList.remove("empty-league-actions");

        document.querySelector("#leagueOverviewName").textContent=activeLeague.name;
        document.querySelector("#leagueOverviewStatus").textContent=String(activeLeague.status||"pre_draft").replace("_"," ").toUpperCase();
        document.querySelector("#leagueOverviewTeam").textContent=activeMembership?.team_name||"Your team";
        document.querySelector("#leagueOverviewRole").textContent=activeMembership?.role==="owner"?"Commissioner":"Manager";
        document.querySelector("#leagueOverviewInvite").textContent=activeLeague.invite_code||"—";
        try{
          const [playoffs,champion,activity,history,membersNow,botsNow]=await Promise.all([
            b.listPlayoffs(activeId),b.getLeagueChampion(activeId),b.listLeagueActivity(activeId,12),
            b.listLeagueHistory(activeId),b.listLeagueMembers(activeId),b.listLeagueBots(activeId)
          ]);
          const managerName=function(id,type){
            if(type==="bot")return botsNow.find(x=>String(x.id)===String(id))?.team_name||"Bot Manager";
            return membersNow.find(x=>String(x.user_id)===String(id))?.team_name||"Manager";
          };
          const playoffCard=document.querySelector("#leaguePlayoffCard");
          const playoffContent=document.querySelector("#leaguePlayoffContent");
          if(playoffCard&&playoffContent&&(playoffs.length||champion)){
            playoffCard.hidden=false;
            const pill=document.querySelector("#leagueChampionPill");
            if(champion){
              pill.textContent="CHAMPION";
              playoffContent.innerHTML='<div class="champion-banner"><strong>🏆 '+h(managerName(champion.manager_id,champion.manager_type))+'</strong><small>League Champion · Seed #'+h(champion.seed||"—")+'</small></div>';
            }else{
              playoffContent.innerHTML=playoffs.map(function(x){return '<div class="playoff-row"><div><strong>'+h(x.stage==="championship"?"Championship":"Semifinal "+x.bracket_slot)+'</strong><small>Seed '+h(x.home_seed??"—")+' vs Seed '+h(x.away_seed??"—")+'</small></div><div><strong>'+formatFantasyPoints(x.home_score)+' - '+formatFantasyPoints(x.away_score)+'</strong><small>'+h(String(x.status||"upcoming").toUpperCase())+'</small></div></div>';}).join("");
            }
          }
          const activityCard=document.querySelector("#leagueActivityCard");
          const activityContent=document.querySelector("#leagueActivityContent");
          if(activityCard&&activityContent&&activity.length){activityCard.hidden=false;activityContent.innerHTML=activity.map(function(x){return '<div class="activity-row"><div><strong>'+h(String(x.kind||"League activity").replaceAll("_"," "))+'</strong><small>'+h(x.payload?.player_id?playerById(x.payload.player_id)?.name||x.payload.player_id:"")+'</small></div><small>'+new Date(x.created_at).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})+'</small></div>';}).join("");}
          const historyCard=document.querySelector("#leagueHistoryCard");
          const historyContent=document.querySelector("#leagueHistoryContent");
          if(historyCard&&historyContent&&history.length){historyCard.hidden=false;historyContent.innerHTML=history.map(function(x){return '<div class="history-row"><div><strong>'+h(String(x.season_key||x.competition))+'</strong><small>'+h(competitionName(x.competition))+'</small></div><div><strong>'+(x.champion_manager_id?h(managerName(x.champion_manager_id,x.champion_manager_type)):"—")+'</strong><small>Champion</small></div></div>';}).join("");}
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
          switchRow.hidden=leagues.length<2;
          switcher.innerHTML=leagues.map(l=>'<option value="'+h(l.id)+'" '+(String(l.id)===String(activeId)?"selected":"")+'>'+h(l.name)+'</option>').join("");
          switcher.onchange=async()=>{
            if(String(switcher.value)===String(getActiveLeagueId()))return;
            setActiveLeagueId(switcher.value);
            const loaded=await loadRosterFromCloud(switcher.value);
            showToast(loaded?"League switched · roster loaded":"League switched");
            render("league",{replace:true});
          };
        }

        await applyLeaguePermissions(activeId);
      }catch(err){
        if(overviewCard)overviewCard.hidden=true;
        if(quickAccess)quickAccess.hidden=true;
        if(rulesModal)rulesModal.hidden=true;
        if(cloudCard)cloudCard.hidden=false;
        if(cloudList)cloudList.hidden=true;
        cloudTitle.textContent="Could not load leagues";
        cloudCopy.textContent=err.message||"A network or league-service error occurred.";
      }
    })();

    document.querySelector("#leagueSettingsSummary").innerHTML=`
      <div><span>Teams</span><strong>${settings.managers}</strong></div>
      <div><span>Draft</span><strong>${settings.draftType}</strong></div>
      <div><span>Scoring</span><strong>${settings.scoringFormat}</strong></div>
      <div><span>Competition</span><strong>${competitionName(settings.competition)}</strong></div>
      <div><span>Roster</span><strong>TOP · JNG · MID · ADC · SUP · FLEX · ${settings.bench} BN</strong></div>`;
    const signedScore=value=>{
      const n=Number(value);
      if(!Number.isFinite(n))return "—";
      return n>0?"+"+n:String(n);
    };
    const scoringSummary=document.querySelector("#leagueScoringSummary");
    if(scoringSummary)scoringSummary.innerHTML=`
      <div><span>Kills</span><strong>${signedScore(settings.scoring.kills)}</strong></div>
      <div><span>Deaths</span><strong>${signedScore(settings.scoring.deaths)}</strong></div>
      <div><span>Assists</span><strong>${signedScore(settings.scoring.assists)}</strong></div>
      <div><span>CS</span><strong>${signedScore(settings.scoring.cs)}</strong></div>
      <div><span>Win</span><strong>${signedScore(settings.scoring.win)}</strong></div>
      <div><span>First Blood</span><strong>${signedScore(settings.scoring.firstBlood)}</strong></div>`;
  }
  if(view==="draft"){
    if(draftTimerId){clearInterval(draftTimerId);draftTimerId=null;}
    const leagueId=getActiveLeagueId();
    const search=document.querySelector("#draftSearch");
    const list=document.querySelector("#draftPlayerList");
    const board=document.querySelector("#draftBoard");
    const fullBoard=document.querySelector("#fullDraftBoard");
    const rosterEl=document.querySelector("#myDraftRoster");
    const startBtn=document.querySelector("#startDraftBtn");
    const refreshBtn=document.querySelector("#refreshDraftBtn");
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

    const refresh=async()=>{
      if(!leagueId||!cloudReady()){
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
          document.querySelector("#draftProgress").textContent="0 picks";
        }else{
          const order=draft.manager_order||[];
          const currentManager=managerForPick(Number(draft.current_pick)||0,order);
          const currentMember=memberById.get(String(currentManager));
          const currentIsBot=currentMember?.role==="bot"||currentMember?.manager_type==="bot";
          const round=Math.floor((Number(draft.current_pick)||0)/Math.max(1,order.length))+1;
          document.querySelector("#draftRoundLabel").textContent=draft.status==="complete"?"DRAFT COMPLETE":`ROUND ${round} · PICK ${Number(draft.current_pick||0)+1}`;
          document.querySelector("#draftTurnLabel").textContent=draft.status==="complete"
            ?"Draft complete"
            :String(currentManager)===String(currentUser.id)?"You're on the clock":`${currentMember?.team_name||"Another manager"}${currentIsBot?" 🤖":""} is on the clock`;
          document.querySelector("#draftHint").textContent=draft.status==="complete"
            ?"Rosters have been created automatically from the final board."
            :"Picks sync across every manager's device.";
          document.querySelector("#draftClock").textContent=draft.status==="drafting"?"LIVE":"DONE";
          document.querySelector("#draftProgress").textContent=`${picks.length}/${(draft.manager_order?.length||0)*(draft.total_rounds||0)} picks`;
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
        const mine=picks.filter(p=>String(p.user_id)===String(currentUser.id));
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
          return `<div class="player-row draft-player"><span class="role-badge">${h(p.role)}</span><div class="player-info"><strong>${h(p.name)}</strong><small>${h(p.team)}</small></div><button class="draft-btn" data-player-id="${h(p.id)}" ${disabled?"disabled":""}>${label}</button></div>`;
        }).join("")||'<div class="empty-state"><strong>No available players</strong><small>Try another role or search.</small></div>';
        list.querySelectorAll("[data-player-id]").forEach(btn=>btn.onclick=async()=>{
          const player=draftPool.find(p=>String(p.id)===String(btn.dataset.playerId));
          if(!player)return;
          btn.disabled=true;
          try{
            await b.makeDraftPick(leagueId,player.id,player.role);
            await refresh();
          }catch(err){showToast(err.message||"Could not make draft pick");await refresh();}
        });

        board.innerHTML=picks.length?picks.slice(-10).reverse().map(p=>{
          const player=draftPool.find(x=>String(x.id)===String(p.player_id));
          const manager=memberById.get(String(p.user_id));
          return `<div class="draft-pick ${String(p.user_id)===String(currentUser.id)?"mine":""}"><small>#${p.pick_number} · R${p.round_number}</small><strong>${h(player?.name||p.player_id)}</strong><span>${h(p.role)} · ${h(manager?.team_name||"Manager")}</span></div>`;
        }).join(""):'<div class="muted">No picks yet.</div>';

        if(draft?.manager_order?.length){
          const headers=draft.manager_order.map(uid=>`<div class="board-head">${h(memberById.get(String(uid))?.team_name||"Manager")}</div>`).join("");
          let cells="";
          const total=(draft.total_rounds||0)*draft.manager_order.length;
          for(let i=0;i<total;i++){
            const uid=managerForPick(i,draft.manager_order);
            const pick=picks.find(p=>Number(p.pick_number)===i+1);
            const player=pick?draftPool.find(x=>String(x.id)===String(pick.player_id)):null;
            cells+=`<div class="board-cell ${String(uid)===String(currentUser.id)?"mine":""} ${draft.status==="drafting"&&i===Number(draft.current_pick)?"on-clock":""}"><small>R${Math.floor(i/draft.manager_order.length)+1} · #${i+1}</small><strong>${h(player?.name||"—")}</strong><span>${h(memberById.get(String(uid))?.team_name||"")}</span></div>`;
          }
          fullBoard.innerHTML=`<div class="full-board-grid" style="grid-template-columns:repeat(${draft.manager_order.length},minmax(92px,1fr))">${headers}${cells}</div>`;
        }else fullBoard.innerHTML='<div class="muted">The draft board will appear when the commissioner starts the draft.</div>';

        rosterEl.innerHTML=assignedMine.length?assignedMine.map(p=>{
          const player=draftPool.find(x=>String(x.id)===String(p.player_id));
          return `<div class="draft-roster-slot filled-start"><small>${h(p.slot)}</small><strong>${h(player?.name||p.player_id)}</strong></div>`;
        }).join(""):'<div class="muted">Your picks will appear here.</div>';

        if(draft?.status==="complete")await loadRosterFromCloud(leagueId);
      }catch(err){
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
          storageSet("riftLeagueSettings",JSON.stringify(next));
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
        storageSet("riftLeagueSettings",JSON.stringify(settings));
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
          storageSet("riftLeagueSettings",JSON.stringify(settings));
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
          storageSet("riftLeagueSettings",JSON.stringify(next));
          storageRemove("riftDraftState");
          showToast("League settings saved for everyone");
          render("league",{replace:true});
        }catch(err){showToast(err.message||"Could not save league settings");}
        finally{btn.disabled=false;}
      };
    })();
  }
  document.querySelectorAll("[data-open-player]").forEach(row=>{
    if(row.dataset.profileBound)return;
    row.dataset.profileBound="1";
    row.addEventListener("click",(e)=>{if(e.target.closest(".add-btn,.draft-btn"))return;openPlayer(row.dataset.openPlayer);});
    row.addEventListener("keydown",(e)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openPlayer(row.dataset.openPlayer);}});
  });
  document.querySelectorAll("[data-jump]").forEach(b=>b.onclick=()=>render(b.dataset.jump));
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
window.addEventListener("popstate",e=>{navigationDepth=Number(e.state?.depth)||0;render(e.state?.view||location.hash.slice(1)||"home",{fromHistory:true});});
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
        case "trade_offer": return {title:`Trade offer from ${actor}`,body:`${send} for ${receive}. Tap to review.`,view:"trade"};
        case "trade_activity": return {title:`${actor} sent a trade offer`,body:`Trade proposed with ${target}: ${send} ↔ ${receive}.`,view:"trade"};
        case "trade_accepted": return {title:"Trade completed",body:`${actor} accepted a trade: ${send} ↔ ${receive}.`,view:"trade"};
        case "trade_declined": return {title:"Trade declined",body:`${actor} declined a trade offer.`,view:"trade"};
        case "trade_canceled": return {title:"Trade canceled",body:`${actor} canceled a trade offer.`,view:"trade"};
        case "trade_review_required": return {title:"Trade awaiting commissioner review",body:`${actor} accepted a trade. Review it before rosters change.`,view:"trade"};
        case "trade_approved": return {title:"Trade approved",body:"The commissioner approved the trade and rosters were updated.",view:"trade"};
        case "trade_rejected": return {title:"Trade rejected",body:"The commissioner rejected the trade.",view:"trade"};
        case "roster_add": return {title:`${actor} added ${rosterPlayer}`,body:"League roster move",view:"transactions"};
        case "roster_drop": return {title:`${actor} dropped ${rosterPlayer}`,body:"League roster move",view:"transactions"};
        case "roster_swap": return {title:`${actor} made a roster move`,body:"Roster swap",view:"transactions",swap:{dropped:playerName(p.dropped_player_id),added:playerName(p.added_player_id)}};
        case "waiver_submitted": return {title:`Waiver claim submitted: ${rosterPlayer}`,body:`Priority ${p.priority||1}. The claim remains subject to league lock rules.`,view:"transactions"};
        case "waiver_won": return {title:`Waiver won: ${rosterPlayer}`,body:"The player has been added to your bench and your waiver priority moved to the back.",view:"transactions"};
        case "waiver_lost": return {title:`Waiver not awarded: ${rosterPlayer}`,body:"Another manager had higher waiver priority.",view:"transactions"};
        case "roster_incomplete_warning": return {title:"Lineup incomplete",body:`Missing: ${Array.isArray(p.missing_slots)?p.missing_slots.join(", "):"starter slots"}. Fix it before the scoring period begins.`,view:"team"};
        case "lineup_lock_warning": {
          const start=p.starts_at?new Date(p.starts_at):null;
          const when=start&&!Number.isNaN(start.getTime())?start.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}):"soon";
          return {title:`${rosterPlayer} locks soon`,body:`Lineup locks at ${when}. Check your starter/bench decision now.`,view:"team"};
        }
        case "fantasy_period_started": return {title:p.label||`Fantasy Round ${p.round_number||""} started`,body:`${p.match_count||0} pro match${Number(p.match_count)===1?"":"es"} in this scoring period.`,view:"matchup"};
        case "matchup_final": {
          const outcome=String(p.outcome||"").toUpperCase();
          return {title:`Matchup final · ${outcome}`,body:`${formatFantasyPoints(p.your_score)} - ${formatFantasyPoints(p.opponent_score)} FP`,view:"matchup"};
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
      return `<button class="notification-item ${n.read_at?"":"unread"}" data-notification-view="${h(d.view)}" data-notification-id="${h(n.id)}"><span class="notification-dot"></span><span class="notification-copy"><strong>${h(d.title)}</strong>${detail}<em>${h(league?.name||"League")} · ${h(fmt(n.created_at))}</em></span></button>`;
    }).join(""):'<div class="empty-state"><strong>No notifications yet</strong><small>Lineup locks, fantasy periods, matchup results, trades, and roster activity will appear here.</small></div>';

    notificationList.querySelectorAll("[data-notification-view]").forEach(item=>item.onclick=async()=>{
      if(!item.classList.contains("unread")){closeNotifications();render(item.dataset.notificationView);return;}
      try{await b.markNotificationsRead([item.dataset.notificationId]);}catch{}
      closeNotifications();
      render(item.dataset.notificationView);
      void loadNotifications();
    });

    notificationPanel.hidden=false;
    document.body.classList.add("notifications-open");
    if(unread.length){
      try{await b.markNotificationsRead(unread.map(n=>n.id));}catch{}
      notificationBadge.hidden=true;
      notificationList.querySelectorAll(".notification-item.unread").forEach(el=>el.classList.remove("unread"));
      notificationSummary.textContent="You're all caught up.";
    }
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
  try{await backend().markNotificationsRead(null);await loadNotifications({open:true});}
  catch(err){showToast(err.message||"Could not update notifications");}
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