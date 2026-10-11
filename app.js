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
let tradeTimerId=null;
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
let selectedPlayerReturnView="players";
let selectedMatchupRound=null;
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
    const normalized=loaded.length?normalizeUserRoster(loaded):[];
    storageSet("riftUserRoster",JSON.stringify(normalized));
    const validation=validateRoster(normalized);
    if(!validation.isComplete){
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
  if(view!=="trade"&&tradeTimerId){clearInterval(tradeTimerId);tradeTimerId=null;}
  if(view!=="trade"&&tradeRealtimeCleanup){try{tradeRealtimeCleanup();}catch{}tradeRealtimeCleanup=null;}
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
  const titles={login:"Sign In",signup:"Create Account",verify:"Verify Email",home:"Home",account:"Account",team:"My Team",matchup:"Matchup",standings:"Standings",schedule:"Schedule","my-schedule":"My Schedule",players:"Players",player:"Player",league:"League","create-league":"Create League","join-league":"Join League","bot-league":"Create Bot League","bot-settings":"Bot League Settings","bot-confirm":"Confirm Bot League","bot-success":"League Created",transactions:"Transactions",trade:"Trades",draft:"Draft Room",setup:"League Setup",privacy:"Privacy Notice",terms:"Terms"};
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
      const sendIds=[...selectedMine];
      const receiveIds=[...selectedTheirs];
      if(!sendIds.length||!receiveIds.length)return;
      const balance=rosterBalanceFor(myRoster().length,sendIds.length,receiveIds.length);
      const sendOffer=async(senderDropIds=[],senderAddIds=[])=>{
        submit.disabled=true;
        try{
          await backend().createTrade(leagueId,currentPartner(),{
            send_player_ids:sendIds,
            receive_player_ids:receiveIds,
            sender_drop_player_ids:senderDropIds,
            sender_add_player_ids:senderAddIds,
            expires_in_hours:Number(expirationSelect?.value)||48
          });
          let counterClosed=true;
          const wasCounter=Boolean(counterSourceTradeId);
          if(counterSourceTradeId){
            try{await backend().updateTrade(counterSourceTradeId,"declined");}
            catch(err){counterClosed=false;console.warn("Counteroffer sent but original offer could not be closed",err);}
          }
          selectedMine.clear();
          selectedTheirs.clear();
          counterSourceTradeId=null;
          showToast(wasCounter?(counterClosed?"Counteroffer sent":"Counteroffer sent · Original offer is still active"):"Trade offer sent");
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
    const managerReadiness=document.querySelector("#leagueManagerReadiness");
    const quickAccess=document.querySelector("#leagueQuickAccess");
    const rulesModal=document.querySelector("#leagueRulesModal");
    const entryActions=document.querySelector("#leagueEntryActions");

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

        document.querySelector("#leagueOverviewName").textContent=activeLeague.name;
        document.querySelector("#leagueOverviewTeam").textContent=activeMembership?.team_name||"Your team";
        document.querySelector("#leagueOverviewRole").textContent=activeMembership?.role==="owner"?"Commissioner":"Manager";
        document.querySelector("#leagueOverviewInvite").textContent=activeLeague.invite_code||"—";
        try{
          const [playoffs,champion,history,membersNow,botsNow]=await Promise.all([
            b.listPlayoffs(activeId),b.getLeagueChampion(activeId),
            b.listLeagueHistory(activeId),b.listLeagueMembers(activeId),b.listLeagueBots(activeId)
          ]);
          const managerName=function(id,type){
            if(type==="bot")return botsNow.find(x=>String(x.id)===String(id))?.team_name||"Bot Manager";
            return membersNow.find(x=>String(x.user_id)===String(id))?.team_name||"Manager";
          };
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
          const leagueStatus=String(activeLeague.status||"pre_draft");
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
              playoffContent.innerHTML='<div class="champion-banner"><strong>🏆 '+h(managerName(champion.manager_id,champion.manager_type))+'</strong><small>League Champion · Seed #'+h(champion.seed||"—")+'</small></div>';
            }else{
              playoffContent.innerHTML=playoffs.map(function(x){return '<div class="playoff-row"><div><strong>'+h(x.stage==="championship"?"Championship":"Semifinal "+x.bracket_slot)+'</strong><small>Seed '+h(x.home_seed??"—")+' vs Seed '+h(x.away_seed??"—")+'</small></div><div><strong>'+formatFantasyPoints(x.home_score)+' - '+formatFantasyPoints(x.away_score)+'</strong><small>'+h(String(x.status||"upcoming").toUpperCase())+'</small></div></div>';}).join("");
            }
          }
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
      if(draftData?.manager_order?.length){
        const headers=draftData.manager_order.map(uid=>`<div class="board-head">${h(memberById.get(String(uid))?.team_name||"Manager")}</div>`).join("");
        let cells="";
        const total=(draftData.total_rounds||0)*draftData.manager_order.length;
        for(let i=0;i<total;i++){
          const uid=managerForPick(i,draftData.manager_order);
          const pick=pickRows.find(p=>Number(p.pick_number)===i+1);
          const player=pick?draftPool.find(x=>String(x.id)===String(pick.player_id)):null;
          cells+=`<div class="board-cell ${String(uid)===String(currentUser.id)?"mine":""} ${draftData.status==="drafting"&&i===Number(draftData.current_pick)?"on-clock":""}" ${player?`data-open-player="${h(player.id)}" tabindex="0" role="button" aria-label="View ${h(player.name)} details"`:""}><small>R${Math.floor(i/draftData.manager_order.length)+1} · #${i+1}</small><strong>${h(player?.name||"—")}</strong><span>${h(memberById.get(String(uid))?.team_name||"")}</span></div>`;
        }
        target.innerHTML=`<div class="full-board-grid" style="grid-template-columns:repeat(${draftData.manager_order.length},minmax(92px,1fr))">${headers}${cells}</div>`;
        wireProfileRows(target);
      }else{
        target.innerHTML='<div class="muted">The draft board will appear when the commissioner starts the draft.</div>';
      }
    };

    const renderCompletedState=(draftData,mine)=>{
      liveState.hidden=true;
      completeState.hidden=false;
      if(pageEyebrow)pageEyebrow.textContent="DRAFT SUMMARY";
      if(exitBtn)exitBtn.hidden=true;
      const order=draftData.manager_order||[];
      const position=Math.max(0,order.findIndex(id=>String(id)===String(currentUser.id)))+1;
      document.querySelector("#draftRecapRounds").textContent=String(draftData.total_rounds||0);
      document.querySelector("#draftRecapPosition").textContent=position>0?"#"+position:"—";
      document.querySelector("#draftRecapPlayers").textContent=String(mine.length);

      completedPickList.innerHTML=mine.length?mine
        .slice()
        .sort((x,y)=>Number(x.pick_number)-Number(y.pick_number))
        .map(p=>{
          const player=draftPool.find(x=>String(x.id)===String(p.player_id));
          return `<div class="completed-pick-row clickable" data-open-player="${h(p.player_id)}" tabindex="0" role="button" aria-label="View ${h(player?.name||p.player_id)} details"><span class="completed-pick-round">R${h(p.round_number)}</span><div class="completed-pick-info"><strong>${h(player?.name||p.player_id)}</strong><small>${h(player?.team||p.role||"")}</small></div><div class="completed-pick-number"><small>Pick</small><strong>#${h(p.pick_number)}</strong></div><span class="completed-pick-chevron" aria-hidden="true">›</span></div>`;
        }).join("")
        :'<div class="muted">No picks were recorded for your team.</div>';
      wireProfileRows(completedPickList);
      renderBoard(completedFullBoard,draftData,picks);
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
          renderCompletedState(draft,mine);
          await loadRosterFromCloud(leagueId);
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
      return `<button class="notification-item ${n.read_at?"":"unread"}" data-notification-view="${h(d.view)}" data-notification-id="${h(n.id)}" data-notification-league="${h(n.league_id||"")}" data-notification-trade-id="${h(d.tradeId||"")}" data-notification-trade-tab="${h(d.tradeTab||"")}"><span class="notification-dot"></span><span class="notification-copy"><strong>${h(d.title)}</strong>${detail}<em>${h(league?.name||"League")} · ${h(fmt(n.created_at))}</em></span></button>`;
    }).join(""):'<div class="empty-state"><strong>No notifications yet</strong><small>Lineup locks, fantasy periods, matchup results, trades, and roster activity will appear here.</small></div>';

    notificationList.querySelectorAll("[data-notification-view]").forEach(item=>item.onclick=async()=>{
      const destination=item.dataset.notificationView;
      const leagueId=item.dataset.notificationLeague;
      if(leagueId&&leagueId!==String(getActiveLeagueId()||"")){
        setActiveLeagueId(leagueId);
        await loadRosterFromCloud(leagueId).catch(()=>{});
      }
      if(destination==="trade"){
        tradeRouteIntent={
          tab:item.dataset.notificationTradeTab||"incoming",
          id:item.dataset.notificationTradeId||null
        };
      }
      if(item.classList.contains("unread")){
        try{await b.markNotificationsRead([item.dataset.notificationId]);}catch{}
      }
      closeNotifications();
      render(destination);
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