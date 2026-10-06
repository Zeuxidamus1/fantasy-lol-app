const roster = [
  {role:"TOP",name:"Bin",team:"Bilibili Gaming",opp:"vs T1",fp:24.8},
  {role:"JNG",name:"Canyon",team:"Gen.G",opp:"vs HLE",fp:31.2},
  {role:"MID",name:"Chovy",team:"Gen.G",opp:"vs HLE",fp:36.7},
  {role:"ADC",name:"Gumayusi",team:"T1",opp:"vs BLG",fp:29.5},
  {role:"SUP",name:"Keria",team:"T1",opp:"vs BLG",fp:18.4},
  {role:"BN",position:"MID",name:"Caps",team:"G2 Esports",opp:"vs FNC",fp:27.9},
  {role:"BN",position:"JNG",name:"Inspired",team:"FlyQuest",opp:"vs TL",fp:25.1},
  {role:"BN",position:"ADC",name:"Massu",team:"FlyQuest",opp:"vs TL",fp:24.3}
];

const freeAgents = [
  {role:"MID",name:"Faker",team:"T1",trend:"21.8 avg",fp:21.8},
  {role:"ADC",name:"Viper",team:"Hanwha Life",trend:"26.4 avg",fp:26.4},
  {role:"TOP",name:"Zeus",team:"Hanwha Life",trend:"23.2 avg",fp:23.2},
  {role:"JNG",name:"Oner",team:"T1",trend:"24.9 avg",fp:24.9},
  {role:"SUP",name:"Lehends",team:"Nongshim",trend:"17.6 avg",fp:17.6},
  {role:"MID",name:"Humanoid",team:"Fnatic",trend:"19.4 avg",fp:19.4},
  {role:"ADC",name:"Hans Sama",team:"G2 Esports",trend:"22.7 avg",fp:22.7}
];

const opponents = [
  {role:"TOP",name:"369",score:20.7},
  {role:"JNG",name:"Oner",score:27.1},
  {role:"MID",name:"Faker",score:29.9},
  {role:"ADC",name:"Viper",score:32.0},
  {role:"SUP",name:"Delight",score:16.4}
];

const standings = [
  ["1","Baron Bandits","2-0","271.4"],
  ["2","Zeuxidamus","2-0","263.8"],
  ["3","Rift Raiders","1-1","248.2"],
  ["4","Pentakill Club","1-1","239.9"],
  ["5","Nexus Breakers","1-1","227.6"],
  ["6","Blue Buff Boys","1-1","219.1"],
  ["7","Dragon Slayers","0-2","205.8"],
  ["8","Iron V","0-2","194.5"]
];



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
const draftPool = ((window.ESPORTS_DATA && window.ESPORTS_DATA.players) || []).map(p=>{
  const n=Number(p.projection??p.fp??20);
  return {...p,fp:Number.isFinite(n)?n:20};
});

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
  const maxRoster=5+Number(settings.bench||3);
  if(picks.length>=maxRoster)return false;
  const needs=rosterNeedsForManager(state,managerIndex);
  const benchSpots=Number(settings.bench||3);
  const startersFilled=5-needs.length;
  const benchUsed=Math.max(0,picks.length-startersFilled);
  if(needs.length>0 && benchUsed>=benchSpots && !needs.includes(player.role)) return false;
  return true;
}

function bestAvailableDraftPlayer(state,managerIndex=draftOrderForPick(state.pickIndex,state.managerCount)){
  const taken=new Set(state.picks.map(p=>p.playerId));
  const needs=rosterNeedsForManager(state,managerIndex);
  return draftPool.find(p=>!taken.has(p.id)&&canDraftPlayer(state,managerIndex,p)&&(needs.length===0||needs.includes(p.role)))
      || draftPool.find(p=>!taken.has(p.id)&&canDraftPlayer(state,managerIndex,p));
}

function makeDraftPick(state,player,managerIndex){
  state.picks.push({pick:state.pickIndex+1,round:Math.floor(state.pickIndex/state.managerCount)+1,managerIndex,manager:draftManagerNames[managerIndex]||("Manager "+(managerIndex+1)),playerId:player.id,name:player.name,role:player.role,team:player.team});
  state.pickIndex++;
  state.seconds=30;
  const settings=getLeagueSettings();
  const rounds=5+Number(settings.bench||3)+(settings.teamSlot?1:0);
  state.complete=state.pickIndex>=Math.min(rounds*state.managerCount,draftPool.length);
  saveDraftState(state);
}

function runCpuPicks(state){
  let guard=0;
  const maxSteps=Math.max(50,draftPool.length+state.managerCount*2);
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
  name:"Summoner's Cup",
  managers:"4",
  bench:"1",
  draftType:"Snake",
  scoringFormat:"Head-to-head",
  competition:"Worlds",
  teamSlot:false,
  scoring:{kills:3,deaths:-1,assists:2,cs:0.02,win:5,firstBlood:2}
};

function getLeagueSettings(){
  try{
    const saved=JSON.parse(storageGet("riftLeagueSettings")||"{}")||{};
    return {
      ...defaultLeagueSettings,
      ...saved,
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
let tradePrefill={id:null,side:null};
let modalReturnFocus=null;

function playerKey(p){
  return String(p.id || p.name || "").toLowerCase().replace(/[^a-z0-9]+/g,"-");
}

function defaultUserRoster(){
  const limit=5+Number(getLeagueSettings().bench||1);
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
  return roster.slice(0,limit).map(p=>({...p,id:playerKey(p),position:p.position||(p.role==="BN"?"MID":p.role),slot:p.role}));
}

function getUserRoster(){
  try{
    const saved=JSON.parse(storageGet("riftUserRoster")||"null");
    return Array.isArray(saved) ? saved : defaultUserRoster();
  }catch{
    return defaultUserRoster();
  }
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
      await backend().createWaiver(leagueId,playerKey(player),existing.filter(c=>String(c.user_id)===String(user?.id)&&c.status==="pending").length+1);
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

function arrangeUserRoster(players){
  const starterRoles=["TOP","JNG","MID","ADC","SUP"];
  const used=new Set();
  const arranged=[];
  starterRoles.forEach(role=>{
    const idx=players.findIndex((p,i)=>!used.has(i)&&(p.position||p.role)===role);
    if(idx>=0){used.add(idx);arranged.push({...players[idx],position:role,slot:role,role});}
  });
  players.forEach((p,i)=>{
    if(!used.has(i)){
      const position=p.position||(p.role==="BN"?"":p.role);
      arranged.push({...p,position,slot:"BN",role:"BN"});
    }
  });
  return arranged;
}

function normalizeUserRoster(players){
  const validRoles=new Set(["TOP","JNG","MID","ADC","SUP"]);
  const usedStarters=new Set();
  return (players||[]).map(p=>{
    const position=validRoles.has(p.position)?p.position:(validRoles.has(p.role)?p.role:"");
    const requested=p.slot||p.role||"BN";
    if(position&&requested===position&&!usedStarters.has(position)){
      usedStarters.add(position);
      return {...p,position,slot:position,role:position};
    }
    return {...p,position:position||p.position||"",slot:"BN",role:"BN"};
  });
}

function rosterLimit(){
  const settings=getLeagueSettings();
  return 5+Number(settings.bench||3);
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

function allFantasyPlayers(){
  return ((window.ESPORTS_DATA&&window.ESPORTS_DATA.players)||[]).map(p=>({...p,fp:Number(p.projection??p.fp??0)}));
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
  return !!backend()?.isConfigured?.();
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
  return `<div class="player-row">
    <button class="player-open-btn" data-open-player="${pid}" aria-label="Open ${h(p.name)} profile">
      <span class="role-badge">${h(p.role)}</span>
      <span class="player-info"><strong>${h(p.name)}</strong><small>${h(p.team)} · ${h(p.opp || p.trend || "")}</small></span>
    </button>
    ${add ? '<button class="add-btn" aria-label="Add player">ADD</button>' : ""}
  </div>`;
}

function rosterRow(p, manage=false, occupiedStarterRoles=new Set()){
  const slot=p.slot||p.role;
  const position=p.position||(p.role==="BN"?"":p.role);
  const isBench=slot==="BN";
  const actionLabel=isBench&&position&&occupiedStarterRoles.has(position)?"SWAP":"START";
  const lineupAction=isBench
    ? '<button class="mini-btn" data-start-roster="'+playerKey(p)+'">'+actionLabel+'</button>'
    : '<button class="mini-btn" data-bench-roster="'+playerKey(p)+'">BENCH</button>';
  return `<div class="roster-slot ${isBench?"bench":""}">
    <span class="slot-label">${h(slot)}</span>
    <div class="player-info"><strong>${h(p.name)}</strong><small>${h(p.team)} · ${h(position||p.role)}${p.opp?" · "+h(p.opp):""}</small></div>
    ${manage?'<div class="team-actions">'+lineupAction+'<button class="mini-btn danger" data-drop-roster="'+playerKey(p)+'">DROP</button></div>':""}
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
  const template=document.querySelector(`#${requested}-template`);
  if(!template){
    if(requested!=="home") return render("home",{...options,replace:true});
    return;
  }
  view=requested;
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
  const titles={login:"Sign In",signup:"Create Account",verify:"Verify Email",home:"Home",account:"Account",team:"My Team",matchup:"Matchup",schedule:"Schedule",players:"Players",player:"Player",league:"League",transactions:"Transactions",trade:"Trades",draft:"Draft Room",setup:"League Setup"};
  document.title=`${titles[view]||"Rift Fantasy"} · Rift Fantasy`;
  document.body.classList.toggle("login-view",["login","signup","verify"].includes(view));
  document.querySelectorAll(".nav-item").forEach(b=>{
    const active=b.dataset.view===view;
    b.classList.toggle("active",active);
    if(active)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");
  });

  if(view==="login"){
    const b=backend();
    const ready=cloudReady();
    const email=document.querySelector("#landingEmail");
    const password=document.querySelector("#landingPassword");
    const signInBtn=document.querySelector("#landingSignIn");
    const resendBtn=document.querySelector("#landingResendVerification");
    setupVerificationResend(resendBtn,email);
    const setBusy=value=>{signInBtn.disabled=value;document.querySelector("#landingCreateAccount").disabled=value;};

    if(!ready){
      signInBtn.disabled=true;
      showToast("Account services are temporarily unavailable.");
    }

    document.querySelector("#landingPasswordToggle").onclick=()=>{
      const hidden=password.type==="password";
      password.type=hidden?"text":"password";
      document.querySelector("#landingPasswordToggle").textContent=hidden?"Hide":"Show";
      document.querySelector("#landingPasswordToggle").setAttribute("aria-label",hidden?"Hide password":"Show password");
    };

    const signIn=async()=>{
      if(!ready)return showToast("Account services are temporarily unavailable.");
      if(!email.checkValidity()||password.value.length<8)return showToast("Enter a valid email and password.");
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

    document.querySelector("#landingCreateAccount").onclick=()=>render("signup");
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
    const noLeague=document.querySelector("#homeNoLeague");
    const leagueCard=document.querySelector("#homeLeagueCard");
    const nextCard=document.querySelector("#homeNextCard");
    const rosterCard=document.querySelector("#homeRosterCard");
    const phase=document.querySelector("#homeLeaguePhase");
    const activeId=getActiveLeagueId();

    (async()=>{
      if(!cloudReady()){
        noLeague.hidden=false;
        return;
      }
      try{
        const b=backend();
        const user=await b.currentUser().catch(()=>null);
        if(!user){render("login",{replace:true});return;}
        const leagues=await b.listLeagues();
        let leagueId=activeId;
        if(leagueId&&!leagues.some(l=>String(l.id)===String(leagueId)))leagueId=null;
        if(!leagueId&&leagues.length===1){leagueId=String(leagues[0].id);setActiveLeagueId(leagueId);}
        const league=leagues.find(l=>String(l.id)===String(leagueId));
        if(!league){noLeague.hidden=false;return;}

        const members=await b.listLeagueMembers(league.id);
        const mine=members.find(m=>String(m.user_id)===String(user.id));
        storageSet("riftLeagueSettings",JSON.stringify({...defaultLeagueSettings,...(league.settings||{}),name:league.name,scoring:{...defaultLeagueSettings.scoring,...(league.settings?.scoring||{})}}));
        await loadRosterFromCloud(league.id);
        const current=getUserRoster();
        const settings=getLeagueSettings();
        const expected=Number(settings.managers)||members.length;

        noLeague.hidden=true;
        leagueCard.hidden=false;
        nextCard.hidden=false;
        rosterCard.hidden=false;
        phase.hidden=false;
        phase.textContent=String(league.status||"pre_draft").replace("_"," ").toUpperCase();
        document.querySelector("#homeLeagueEyebrow").textContent=league.name.toUpperCase();
        document.querySelector("#homeTitle").textContent=mine?.team_name||"My Team";
        document.querySelector("#homeLeagueName").textContent=league.name;
        document.querySelector("#homeTeamName").textContent=mine?.team_name||"My Team";
        document.querySelector("#homeManagerCount").textContent=`${members.length}/${expected}`;
        document.querySelector("#homeRosterCount").textContent=`${current.length}/${rosterLimit()}`;

        const starters=current.filter(p=>(p.slot||p.role)!=="BN").slice(0,5);
        document.querySelector("#starterPreview").innerHTML=starters.length
          ?starters.map(p=>playerRow({...p,role:p.position||p.role})).join("")
          :'<div class="empty-state"><strong>Your roster is empty</strong><small>Your drafted players will appear here.</small></div>';

        const action=document.querySelector("#homeNextAction");
        const title=document.querySelector("#homeNextTitle");
        const copy=document.querySelector("#homeNextCopy");
        const status=league.status||"pre_draft";
        if(status==="pre_draft"){
          title.textContent=members.length<expected?"Waiting for managers":"Ready to draft";
          copy.textContent=members.length<expected
            ?`Share the invite code with ${expected-members.length} more manager${expected-members.length===1?"":"s"}.`
            :"Your league is full. The commissioner can start the live snake draft.";
          action.textContent=members.length<expected?"View League":"Open Draft Room";
          action.onclick=()=>render(members.length<expected?"league":"draft");
        }else if(status==="drafting"){
          title.textContent="Draft in progress";
          copy.textContent="The live league draft is underway. Open the Draft Room to see the board and make your picks.";
          action.textContent="Open Draft Room";
          action.onclick=()=>render("draft");
        }else{
          title.textContent="League active";
          copy.textContent="Your draft is complete. Manage your roster, transactions, and upcoming match schedule.";
          action.textContent="Manage My Team";
          action.onclick=()=>render("team");
        }
      }catch(err){
        noLeague.hidden=false;
        noLeague.querySelector("small").textContent=err.message||"Could not load your active league.";
      }
    })();
  }
  if(view==="team"){
    const leagueId=getActiveLeagueId();
    const leagueNameEl=document.querySelector("#teamLeagueName");
    const teamNameEl=document.querySelector("#myTeamName");
    const badge=document.querySelector("#teamSyncBadge");
    const noLeague=document.querySelector("#teamNoLeague");
    const starterList=document.querySelector("#starterRosterList");
    const benchList=document.querySelector("#benchRosterList");
    const rosterCount=document.querySelector("#teamRosterCount");
    const starterCount=document.querySelector("#teamStarterCount");
    const rosterCards=document.querySelectorAll(".team-roster-card,.team-summary-card");

    let rosterMovesEnabled=false;
    const bindRosterActions=()=>{
      document.querySelectorAll("[data-drop-roster]").forEach(btn=>btn.onclick=async()=>{
        if(!rosterMovesEnabled)return showToast("Roster moves unlock after the draft.");
        const currentNow=getUserRoster();
        const player=currentNow.find(p=>playerKey(p)===btn.dataset.dropRoster);
        if(!player)return;
        if(!window.confirm(`Drop ${player.name} from your roster?`))return;
        btn.disabled=true;
        try{
          await saveUserRoster(currentNow.filter(p=>playerKey(p)!==btn.dataset.dropRoster));
          logTransaction("drop",player);
          showToast(`${player.name} dropped`);
          render("team",{replace:true});
        }catch(err){showToast(err.message||"Could not drop player");btn.disabled=false;}
      });

      document.querySelectorAll("[data-bench-roster]").forEach(btn=>btn.onclick=async()=>{
        if(!rosterMovesEnabled)return showToast("Lineup changes unlock after the draft.");
        const currentNow=getUserRoster();
        const player=currentNow.find(p=>playerKey(p)===btn.dataset.benchRoster);
        if(!player)return;
        btn.disabled=true;
        try{
          await saveUserRoster(currentNow.map(p=>playerKey(p)===playerKey(player)?{...p,slot:"BN",role:"BN"}:p));
          showToast(`${player.name} moved to bench`);
          render("team",{replace:true});
        }catch(err){showToast(err.message||"Could not update lineup");btn.disabled=false;}
      });

      document.querySelectorAll("[data-start-roster]").forEach(btn=>btn.onclick=async()=>{
        if(!rosterMovesEnabled)return showToast("Lineup changes unlock after the draft.");
        const currentNow=getUserRoster();
        const player=currentNow.find(p=>playerKey(p)===btn.dataset.startRoster);
        const position=player?.position||(player?.role==="BN"?"":player?.role);
        if(!player||!position)return showToast("Player role is unavailable.");
        btn.disabled=true;
        const next=currentNow.map(p=>{
          if(playerKey(p)===playerKey(player))return {...p,position,slot:position,role:position};
          if((p.slot||p.role)===position)return {...p,slot:"BN",role:"BN"};
          return p;
        });
        try{
          await saveUserRoster(next);
          const replacing=currentNow.some(p=>playerKey(p)!==playerKey(player)&&(p.slot||p.role)===position);
          showToast(replacing?`${player.name} swapped into ${position}`:`${player.name} moved into the ${position} slot`);
          render("team",{replace:true});
        }catch(err){showToast(err.message||"Could not update lineup");btn.disabled=false;}
      });
    };

    const drawRoster=()=>{
      const current=getUserRoster();
      const starterRoles=["TOP","JNG","MID","ADC","SUP"];
      const starters=current.filter(p=>(p.slot||p.role)!=="BN");
      const bench=current.filter(p=>(p.slot||p.role)==="BN");
      const occupied=new Set(starters.map(p=>p.slot||p.role));
      const rosterPositions=new Set(current.map(p=>p.position||(p.role==="BN"?"":p.role)).filter(Boolean));
      rosterCount.textContent=`${current.length}/${rosterLimit()}`;
      starterCount.textContent=`${starters.length}/5`;

      starterList.innerHTML=starterRoles.map(role=>{
        const p=starters.find(x=>(x.slot||x.role)===role);
        if(p)return rosterRow(p,rosterMovesEnabled,occupied);
        const hasRoleOnBench=bench.some(x=>(x.position||(x.role==="BN"?"":x.role))===role);
        return `<div class="roster-slot empty-roster-slot"><span class="slot-label">${role}</span><div class="player-info"><strong>Empty ${role} slot</strong><small>${hasRoleOnBench?"A bench player can fill this spot":"No "+role+" player is on your roster"}</small></div></div>`;
      }).join("");

      const missingRosterRoles=starterRoles.filter(role=>!rosterPositions.has(role));
      const warning=missingRosterRoles.length
        ? `<div class="lineup-warning"><strong>Incomplete roster</strong><small>You do not currently have a ${h(missingRosterRoles.join(" or "))} player, so a full 5-player starting lineup is impossible until you add/trade for those roles.</small></div>`
        : "";

      benchList.innerHTML=warning+(bench.length
        ?bench.map(p=>rosterRow(p,rosterMovesEnabled,occupied)).join("")
        :'<div class="empty-state"><strong>Bench is empty</strong><small>Bench players will appear here.</small></div>');
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
          drawRoster();
        }catch(err){
          badge.hidden=true;
          starterList.innerHTML='<div class="empty-state cloud-error"><strong>Could not load your team</strong><small>'+h(err.message||"Please try again.")+'</small></div>';
          benchList.innerHTML="";
        }
      })();
    }
  }
  if(view==="player"){
    const p=playerById(selectedPlayerId) || allFantasyPlayers()[0];
    if(!p){ render("players"); return; }
    selectedPlayerId=p.id||selectedPlayerId;
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
        const [user,rosters,leagues]=await Promise.all([b.currentUser(),b.listRosters(leagueId),b.listLeagues()]);
        const league=leagues.find(l=>String(l.id)===String(leagueId));
        const ownership=rosters.find(r=>String(r.player_id)===playerKey(p));
        const mine=ownership&&String(ownership.user_id)===String(user?.id);
        const other=ownership&&!mine;

        document.querySelector("#profileStatus").textContent=mine?"On your roster":other?"Rostered by another manager":"Available";

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
  if(view==="schedule"){
    const list=document.querySelector("#scheduleList");
    let day="all";
    let rosterPlayers=getUserRoster();

    const normalizeTeam=value=>String(value||"").toLowerCase().replace(/[^a-z0-9]/g,"");
    const rosterMatchForTeam=(teamName,teamCode)=>{
      const nameKey=normalizeTeam(teamName);
      const codeKey=normalizeTeam(teamCode);
      return rosterPlayers.filter(p=>{
        const pName=normalizeTeam(p.team);
        const pCode=normalizeTeam(p.teamCode);
        return (nameKey&&(pName===nameKey||pCode===nameKey)) ||
               (codeKey&&(pName===codeKey||pCode===codeKey));
      });
    };

    const drawSchedule=()=>{
      const rows=proSchedule.map(localScheduleRow).sort((a,b)=>{
        const ta=Date.parse(a.startTime||"");
        const tb=Date.parse(b.startTime||"");
        if(Number.isFinite(ta)&&Number.isFinite(tb))return ta-tb;
        return 0;
      });
      const filtered=rows.filter(g=>day==="all"||g.day===day||(day==="upcoming"&&g.day==="upcoming"));
      let lastLabel="";
      list.innerHTML=filtered.length?filtered.map(g=>{
        const heading=g.label!==lastLabel ? `<div class="schedule-day">${h(g.label||"Upcoming")}</div>` : "";
        lastLabel=g.label;
        const aRoster=rosterMatchForTeam(g.a,g.aCode);
        const bRoster=rosterMatchForTeam(g.b,g.bCode);
        const aOwned=aRoster.length>0;
        const bOwned=bRoster.length>0;
        const aNote=aOwned?`${aRoster.length} roster player${aRoster.length===1?"":"s"}`:"Team 1";
        const bNote=bOwned?`${bRoster.length} roster player${bRoster.length===1?"":"s"}`:"Team 2";
        return heading+`<div class="game-card ${aOwned||bOwned?"roster-match":""}">
          <div class="game-team ${aOwned?"my-roster-team":""}"><span class="team-mark">${h(g.aCode||"TBD")}</span><div><strong>${h(g.a||"TBD")}</strong><small>${h(aNote)}</small></div></div>
          <div class="game-meta"><span class="game-time">${h(g.time||"TBD")}</span><span class="game-league">${h(g.league||"LoL Esports")}</span><span class="game-stage">${h(g.stage||"")}</span><span class="game-status ${String(g.status||"").toUpperCase().includes("PROGRESS")?"live":""}">${h(g.status||"UPCOMING")}</span></div>
          <div class="game-team right ${bOwned?"my-roster-team":""}"><div><strong>${h(g.b||"TBD")}</strong><small>${h(bNote)}</small></div><span class="team-mark">${h(g.bCode||"TBD")}</span></div>
        </div>`;
      }).join(""):'<div class="empty-state"><strong>No matches found</strong><small>Try another filter or check back after the next data refresh.</small></div>';
    };

    document.querySelectorAll("[data-day]").forEach(c=>c.onclick=()=>{day=c.dataset.day;document.querySelectorAll("[data-day]").forEach(x=>x.classList.remove("active"));c.classList.add("active");drawSchedule();});
    (async()=>{
      const leagueId=getActiveLeagueId();
      if(leagueId&&cloudReady()){
        try{
          await loadRosterFromCloud(leagueId);
          rosterPlayers=getUserRoster();
        }catch{}
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

    const draw=()=>{
      const q=search.value.trim().toLowerCase();
      const source=allFantasyPlayers();
      const filtered=source.filter(p=>(role==="ALL"||p.role===role)&&(`${p.name} ${p.team} ${p.role}`.toLowerCase().includes(q)));
      list.innerHTML=filtered.map(p=>playerRow(p,true)).join("") || '<div class="empty-state"><strong>No players found</strong><small>Try a different name, team, or role.</small></div>';

      list.querySelectorAll(".add-btn").forEach((b,i)=>{
        const p=filtered[i];
        const pid=playerKey(p);
        const ownership=leagueRosters.find(r=>String(r.player_id)===String(pid));
        if(ownership){
          if(String(ownership.user_id)===String(currentUser?.id)){b.textContent="OWNED";b.classList.add("owned");}
          else b.textContent="ROSTERED";
          b.disabled=true;
        }else if(leagueStatus&&leagueStatus!=="active"){
          b.textContent=leagueStatus==="drafting"?"DRAFTING":"LOCKED";
          b.disabled=true;
        }else if(!getActiveLeagueId()){
          b.textContent="NO LEAGUE";
          b.disabled=true;
        }else{
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
        leagueStatus=leagues.find(l=>String(l.id)===String(leagueId))?.status||null;
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
      const history=trades.filter(t=>t.status!=="pending"&&(String(t.from_user)===String(user?.id)||String(t.to_user)===String(user?.id)));
      const renderCard=t=>{
        const sent=playerFromId(t.offer?.send_player_id);
        const received=playerFromId(t.offer?.receive_player_id);
        const isOutgoing=String(t.from_user)===String(user?.id);
        const counterpart=isOutgoing?partnerName(t.to_user):partnerName(t.from_user);
        const status=String(t.status||"pending");
        return `<div class="trade-card">
          <div class="trade-card-head"><div><h4>${h(counterpart)}</h4><small>${new Date(t.created_at).toLocaleString()}</small></div><span class="trade-status ${h(status)}">${h(status.toUpperCase())}</span></div>
          <div class="trade-swap"><div class="trade-side"><span>YOU SEND</span><strong>${h(isOutgoing?sent.name:received.name)}</strong></div><div class="trade-arrow">⇄</div><div class="trade-side"><span>YOU RECEIVE</span><strong>${h(isOutgoing?received.name:sent.name)}</strong></div></div>
          ${status==="pending"?(isOutgoing?`<div class="trade-card-actions"><button class="secondary-btn" data-cancel-trade="${h(t.id)}">Cancel Offer</button></div>`:`<div class="trade-card-actions"><button class="primary-btn" data-accept-trade="${h(t.id)}">Accept</button><button class="secondary-btn" data-decline-trade="${h(t.id)}">Decline</button></div>`):""}
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
        try{await backend().acceptTrade(btn.dataset.acceptTrade);await loadRosterFromCloud(leagueId);showToast("Trade accepted");await init();}
        catch(err){showToast(err.message||"Could not accept trade");}
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
    let user=null,claims=[],moves=[],members=[],leagues=[];
    const fmt=iso=>{const d=new Date(iso);return Number.isNaN(d.getTime())?"":d.toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});};
    const memberName=id=>members.find(m=>String(m.user_id)===String(id))?.team_name||"Manager";
    const playerFromId=id=>playerById(id)||{id,name:id,team:"",role:""};

    const draw=()=>{
      const mineClaims=claims.filter(c=>String(c.user_id)===String(user?.id)&&c.status==="pending");
      count.textContent=mineClaims.length;
      moveCount.textContent=moves.length;
      if(tab==="pending"){
        content.innerHTML=mineClaims.length?mineClaims.map(c=>{const p=playerFromId(c.player_id);return `<div class="transaction-item"><span class="transaction-icon claim">W</span><div class="transaction-info"><strong>${h(p.name)}<span class="status-pill pending">PENDING</span></strong><small>${h(p.team)} · Priority ${h(c.priority)}</small><div class="claim-actions"><button class="claim-btn cancel" data-cancel-claim="${h(c.id)}">Cancel</button></div></div><span class="transaction-time">${fmt(c.created_at)}</span></div>`;}).join(""):'<div class="empty-state"><strong>No pending waiver claims</strong><small>Open a player profile and tap Waiver Claim to submit one.</small></div>';
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
        [user,claims,moves,members,leagues]=await Promise.all([b.currentUser(),b.listWaivers(leagueId),b.listTransactions(leagueId),b.listLeagueMembers(leagueId),b.listLeagues()]);
        leagueName.textContent=leagues.find(l=>String(l.id)===String(leagueId))?.name||"League";
        draw();
      }catch(err){content.innerHTML=`<div class="empty-state cloud-error"><strong>Could not load transactions</strong><small>${h(err.message||"Please try again.")}</small></div>`;}
    };
    document.querySelectorAll("[data-transaction-tab]").forEach(btn=>btn.onclick=()=>{tab=btn.dataset.transactionTab;document.querySelectorAll("[data-transaction-tab]").forEach(x=>x.classList.toggle("active",x===btn));draw();});
    void init();
  }
  if(view==="league"){
    const settings=getLeagueSettings();
    const cloudTitle=document.querySelector("#cloudLeagueTitle");
    const cloudCopy=document.querySelector("#cloudLeagueCopy");
    const cloudActions=document.querySelector("#cloudLeagueActions");
    const cloudList=document.querySelector("#cloudLeagueList");
    (async()=>{
      if(!cloudReady()){
        cloudTitle.textContent="Online leagues unavailable";
        cloudCopy.textContent="League services are temporarily unavailable.";
        return;
      }
      const b=backend();
      const user=await b.currentUser().catch(()=>null);
      if(!user){
        cloudTitle.textContent="Sign in for online leagues";
        cloudCopy.textContent="Sign in to create or join shared leagues.";
        return;
      }
      cloudTitle.textContent="Online leagues";
      cloudCopy.textContent="Create a league or join one with an invite code.";
      cloudActions.hidden=false;
      const applyLeaguePermissions=async(activeId)=>{
        const controls=document.querySelectorAll(".commissioner-only");
        controls.forEach(el=>el.hidden=true);
        if(!activeId)return;
        try{
          const members=await b.listLeagueMembers(activeId);
          const mine=members.find(m=>String(m.user_id)===String(user.id));
          const commissioner=mine?.role==="owner";
          controls.forEach(el=>el.hidden=!commissioner);
        }catch{
          controls.forEach(el=>el.hidden=true);
        }
      };

      const drawCloudLeagues=async()=>{
        try{
          const leagues=await b.listLeagues();
          let activeId=getActiveLeagueId();
          if(activeId&&!leagues.some(l=>String(l.id)===String(activeId))){
            setActiveLeagueId(null);
            activeId=null;
          }
          if(!activeId&&leagues.length===1){
            activeId=String(leagues[0].id);
            setActiveLeagueId(activeId);
            await loadRosterFromCloud(activeId);
          }

          const memberships=await Promise.all(leagues.map(async league=>{
            try{
              const members=await b.listLeagueMembers(league.id);
              return members.find(m=>String(m.user_id)===String(user.id))||null;
            }catch{return null;}
          }));

          cloudList.innerHTML=leagues.length?leagues.map((l,index)=>{
            const active=String(activeId)===String(l.id);
            const membership=memberships[index];
            const teamName=membership?.team_name||"Your team";
            const role=membership?.role==="owner"?"Commissioner":"Manager";
            return '<button class="cloud-league-item league-choice '+(active?"active-cloud-league":"")+'" data-cloud-league="'+h(l.id)+'" aria-pressed="'+String(active)+'"><div><strong>'+h(l.name)+'</strong><small>'+h(teamName)+' · '+h(role)+' · Invite: '+h(l.invite_code||"—")+'</small></div><span class="league-choice-state">'+(active?"Active":"Select")+'</span></button>';
          }).join(""):'<div class="empty-state"><strong>No online leagues yet</strong><small>Create one or join with an invite code.</small></div>';

          await applyLeaguePermissions(activeId);
          cloudList.querySelectorAll("[data-cloud-league]").forEach(card=>card.onclick=async()=>{
            if(String(getActiveLeagueId())===String(card.dataset.cloudLeague))return;
            setActiveLeagueId(card.dataset.cloudLeague);
            const loaded=await loadRosterFromCloud(card.dataset.cloudLeague);
            showToast(loaded?"League selected · roster loaded":"League selected");
            await drawCloudLeagues();
          });
        }catch(err){
          cloudList.innerHTML='<div class="empty-state cloud-error"><strong>Could not load leagues</strong><small>'+h(err.message||"Cloud request failed")+'</small></div>';
        }
      };
      await drawCloudLeagues();
      const createName=document.querySelector("#newLeagueName");
      const createTeam=document.querySelector("#newLeagueTeamName");
      const createBtn=document.querySelector("#createCloudLeagueBtn");
      const updateCreateState=()=>{createBtn.disabled=!(createName.value.trim()&&createTeam.value.trim());};
      createName.addEventListener("input",updateCreateState);
      createTeam.addEventListener("input",updateCreateState);
      updateCreateState();
      createBtn.onclick=async()=>{
        const name=createName.value.trim();
        const teamName=createTeam.value.trim();
        if(!name||!teamName)return showToast("Enter a league name and team name.");
        createBtn.disabled=true;
        try{
          const nextSettings={...settings,name};
          const created=await b.createLeague(name,nextSettings);
          const league=Array.isArray(created)?created[0]:created;
          if(league?.id){
            setActiveLeagueId(league.id);
            await b.updateTeamName(league.id,teamName);
          }
          storageSet("riftLeagueSettings",JSON.stringify(nextSettings));
          showToast("League created"+(league?.invite_code?": "+league.invite_code:""));
          createName.value="";
          createTeam.value="";
          await drawCloudLeagues();
        }catch(err){showToast(err.message||"Could not create league");}
        finally{updateCreateState();}
      };
      const joinCode=document.querySelector("#joinCode");
      const joinTeamName=document.querySelector("#joinTeamName");
      const joinBtn=document.querySelector("#joinCloudLeagueBtn");
      const updateJoinState=()=>{
        joinBtn.disabled=!(joinCode.value.trim()&&joinTeamName.value.trim());
      };
      joinCode.addEventListener("input",updateJoinState);
      joinTeamName.addEventListener("input",updateJoinState);
      updateJoinState();
      joinBtn.onclick=async()=>{
        const code=joinCode.value.trim();
        const teamName=joinTeamName.value.trim();
        if(!code)return showToast("Enter an invite code.");
        if(!teamName)return showToast("Enter a team name.");
        joinBtn.disabled=true;
        try{
          const joined=await b.joinLeague(code,teamName);
          const leagueId=Array.isArray(joined)?joined[0]?.league_id:joined?.league_id;
          if(leagueId)setActiveLeagueId(leagueId);
          showToast("League joined");
          await drawCloudLeagues();
        }
        catch(err){showToast(err.message||"Could not join league");}
        finally{updateJoinState();}
      };
    })();
    const leagueLabel=document.querySelector("#leagueNameLabel");
    if(leagueLabel)leagueLabel.textContent=String(settings.name||"Fantasy League").toUpperCase();
    document.querySelector("#leagueSettingsSummary").innerHTML=`
      <div><span>Teams</span><strong>${settings.managers}</strong></div>
      <div><span>Draft</span><strong>${settings.draftType}</strong></div>
      <div><span>Scoring</span><strong>${settings.scoringFormat}</strong></div>
      <div><span>Competition</span><strong>${settings.competition}</strong></div>
      <div><span>Roster</span><strong>TOP · JNG · MID · ADC · SUP${settings.teamSlot?" · TEAM":""}</strong></div>`;
    document.querySelector("#rulesBtn").onclick=()=>showToast(`Scoring: K +${settings.scoring.kills} · D ${settings.scoring.deaths} · A +${settings.scoring.assists} · CS +${settings.scoring.cs} · Win +${settings.scoring.win}`);
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
    let memberById=new Map();
    let draft=null;
    let picks=[];

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
        memberById=new Map(members.map(m=>[String(m.user_id),m]));
        draft=await b.getLeagueDraft(leagueId);
        picks=await b.listDraftPicks(leagueId);
        const me=memberById.get(String(currentUser.id));
        document.querySelector("#draftMyTeamName").textContent=me?.team_name||"My Team";

        const owner=me?.role==="owner";
        const expected=Number(league?.settings?.managers)||members.length;
        startBtn.hidden=!(owner && (!draft||draft.status!=="drafting") && league?.status==="pre_draft");
        startBtn.disabled=members.length!==expected;
        startBtn.textContent=members.length===expected?"Start Draft":`Waiting for ${expected-members.length} Manager${expected-members.length===1?"":"s"}`;

        if(!draft){
          document.querySelector("#draftRoundLabel").textContent="PRE-DRAFT";
          document.querySelector("#draftTurnLabel").textContent=members.length===expected?"League is ready":"Waiting for managers";
          document.querySelector("#draftHint").textContent=owner
            ?"Start the draft once every manager has joined."
            :"The commissioner will start the draft when the league is ready.";
          document.querySelector("#draftClock").textContent="—";
          document.querySelector("#draftProgress").textContent="0 picks";
        }else{
          const order=draft.manager_order||[];
          const currentManager=managerForPick(Number(draft.current_pick)||0,order);
          const currentMember=memberById.get(String(currentManager));
          const round=Math.floor((Number(draft.current_pick)||0)/Math.max(1,order.length))+1;
          document.querySelector("#draftRoundLabel").textContent=draft.status==="complete"?"DRAFT COMPLETE":`ROUND ${round} · PICK ${Number(draft.current_pick||0)+1}`;
          document.querySelector("#draftTurnLabel").textContent=draft.status==="complete"
            ?"Draft complete"
            :String(currentManager)===String(currentUser.id)?"You're on the clock":`${currentMember?.team_name||"Another manager"} is on the clock`;
          document.querySelector("#draftHint").textContent=draft.status==="complete"
            ?"Rosters have been created automatically from the final board."
            :"Picks sync across every manager's device.";
          document.querySelector("#draftClock").textContent=draft.status==="drafting"?"LIVE":"DONE";
          document.querySelector("#draftProgress").textContent=`${picks.length}/${(draft.manager_order?.length||0)*(draft.total_rounds||0)} picks`;
        }

        const taken=new Set(picks.map(p=>String(p.player_id)));
        const q=search.value.trim().toLowerCase();
        const myTurn=draft?.status==="drafting"&&String(managerForPick(Number(draft.current_pick)||0,draft.manager_order||[]))===String(currentUser.id);
        const filtered=draftPool.filter(p=>!taken.has(String(p.id))&&(role==="ALL"||p.role===role)&&(`${p.name} ${p.team} ${p.role}`.toLowerCase().includes(q)));
        list.innerHTML=filtered.map(p=>`<div class="player-row draft-player"><span class="role-badge">${h(p.role)}</span><div class="player-info"><strong>${h(p.name)}</strong><small>${h(p.team)}</small></div><button class="draft-btn" data-player-id="${h(p.id)}" ${myTurn?"":"disabled"}>DRAFT</button></div>`).join("")||'<div class="empty-state"><strong>No available players</strong><small>Try another role or search.</small></div>';
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

        const mine=picks.filter(p=>String(p.user_id)===String(currentUser.id));
        rosterEl.innerHTML=mine.length?mine.map(p=>{
          const player=draftPool.find(x=>String(x.id)===String(p.player_id));
          return `<div class="draft-roster-slot filled-start"><small>${h(p.role)}</small><strong>${h(player?.name||p.player_id)}</strong></div>`;
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
  if(view==="setup"){
    const setupScreen=document.querySelector("#setupScreen");
    const activeLeagueId=getActiveLeagueId();

    const populate=(settings)=>{
      document.querySelector("#leagueName").value=settings.name;
      const managerSelect=document.querySelector("#managerCount");
      const maxManagers=Math.max(2,Math.floor(draftPool.length/5));
      [...managerSelect.options].forEach(option=>{
        const unsupported=Number(option.value)>maxManagers;
        option.disabled=unsupported;
        if(unsupported)option.title=`Needs at least ${Number(option.value)*5} verified players`;
      });
      if([...managerSelect.options].some(o=>o.value===String(settings.managers)&&!o.disabled))managerSelect.value=settings.managers;
      else managerSelect.value=[...managerSelect.options].find(o=>!o.disabled)?.value||"4";
      document.querySelector("#benchCount").value=settings.bench;
      document.querySelector("#competition").value=settings.competition;
      document.querySelector("#teamSlot").checked=false;
      document.querySelector("#scoreKills").value=settings.scoring.kills;
      document.querySelector("#scoreDeaths").value=settings.scoring.deaths;
      document.querySelector("#scoreAssists").value=settings.scoring.assists;
      document.querySelector("#scoreCs").value=settings.scoring.cs;
      document.querySelector("#scoreWin").value=settings.scoring.win;
      document.querySelector("#scoreFb").value=settings.scoring.firstBlood;
    };

    (async()=>{
      let settings=getLeagueSettings();
      let league=null;
      if(cloudReady()&&activeLeagueId){
        setupScreen.hidden=true;
        try{
          const b=backend();
          const user=await b.currentUser();
          const [members,leagues]=await Promise.all([b.listLeagueMembers(activeLeagueId),b.listLeagues()]);
          const mine=members.find(m=>String(m.user_id)===String(user?.id));
          league=leagues.find(l=>String(l.id)===String(activeLeagueId));
          const memberList=document.querySelector("#commissionerMemberList");
          const drawMembers=()=>{
            if(!memberList)return;
            memberList.innerHTML=members.map(m=>{
              const isOwner=m.role==="owner";
              return `<div class="commissioner-member-row"><div><strong>${h(m.team_name||"My Team")}</strong><small>${isOwner?"Commissioner":"Manager"}</small></div>${isOwner?"<span class=\"status-pill success\">OWNER</span>":'<button class="mini-btn danger" data-remove-member="'+h(m.user_id)+'">REMOVE</button>'}</div>`;
            }).join("");
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
          if(league?.status!=="pre_draft"){
            showToast("League settings are locked after the draft starts.");
            render("league",{replace:true});
            return;
          }
          settings={...defaultLeagueSettings,...(league?.settings||{}),name:league?.name||settings.name,scoring:{...defaultLeagueSettings.scoring,...(league?.settings?.scoring||{})}};
          storageSet("riftLeagueSettings",JSON.stringify(settings));
          setupScreen.hidden=false;
        }catch(err){
          showToast(err.message||"Could not load league settings.");
          render("league",{replace:true});
          return;
        }
      }
      populate(settings);

      document.querySelector("#saveLeagueBtn").onclick=async()=>{
        const numberOr=(id,fallback)=>{const n=Number(document.querySelector(id).value);return Number.isFinite(n)?n:fallback;};
        const next={
          name:document.querySelector("#leagueName").value.trim()||"Summoner's Cup",
          managers:document.querySelector("#managerCount").value,
          bench:document.querySelector("#benchCount").value,
          draftType:"Snake",
          scoringFormat:"Head-to-head",
          competition:document.querySelector("#competition").value,
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

document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>render(b.dataset.view)));
document.querySelectorAll("[data-close-transaction]").forEach(el=>el.addEventListener("click",closeTransactionModal));
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape")return;
  closeTransactionModal();
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
        case "roster_add": return {title:`${actor} added ${rosterPlayer}`,body:"League roster move",view:"transactions"};
        case "roster_drop": return {title:`${actor} dropped ${rosterPlayer}`,body:"League roster move",view:"transactions"};
        case "roster_swap": return {title:`${actor} made a roster move`,body:"Roster swap",view:"transactions",swap:{dropped:playerName(p.dropped_player_id),added:playerName(p.added_player_id)}};
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
    }).join(""):'<div class="empty-state"><strong>No notifications yet</strong><small>Trades and league roster changes will appear here.</small></div>';

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

void loadNotifications();
notificationTimerId=setInterval(()=>{if(!document.hidden)void loadNotifications();},8000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)void loadNotifications();});

render(location.hash.slice(1)||"login",{replace:true});