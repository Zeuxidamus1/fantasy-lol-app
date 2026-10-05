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

function saveUserRoster(players){
  storageSet("riftUserRoster",JSON.stringify(players));
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
function createWaiverClaim(player){
  if(isOwned(player)){showToast(`${player.name} is already on your team.`);return;}
  const claims=getWaiverClaims();
  if(claims.some(c=>c.playerId===playerKey(player))){showToast("You already have a claim on this player.");return;}
  claims.push({
    id:String(Date.now()),
    playerId:playerKey(player),
    player:player.name,
    team:player.team||"",
    role:player.role||"",
    createdAt:new Date().toISOString(),
    status:"pending"
  });
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
    if(idx>=0){used.add(idx);arranged.push({...players[idx],slot:role,role});}
  });
  players.forEach((p,i)=>{if(!used.has(i))arranged.push({...p,slot:"BN",role:"BN"});});
  return arranged;
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

function addPlayerToRoster(player){
  if(isOwned(player)){showToast(`${player.name} is already on your team.`);return;}
  let current=getUserRoster();
  if(current.length<rosterLimit()){
    current.push({...player,id:playerKey(player),position:player.position||player.role,slot:"BN"});
    saveUserRoster(arrangeUserRoster(current));
    logTransaction("add",player);
    showToast(`${player.name} added to your team`);
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
    saveUserRoster(arrangeUserRoster(next));
    if(dropped) logTransaction("drop",dropped,{pairedWith:incoming.name});
    logTransaction("add",incoming,{pairedWith:dropped?.name||null});
    closeTransactionModal();
    showToast(`Added ${incoming.name} · Dropped ${dropped?.name||"player"}`);
    if(document.querySelector("#profileName")) render("player");
    else if(document.querySelector("#rosterList")) render("team");
    else if(document.querySelector("#freeAgentList")) render("players");
  });
  modalReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  modal.hidden=false;
  document.body.classList.add("modal-open");
  const shell=document.querySelector(".app-shell");
  if(shell)shell.inert=true;
  queueMicrotask(()=>list.querySelector("[data-drop-id]")?.focus());
}

function allFantasyPlayers(){
  const live=((window.ESPORTS_DATA&&window.ESPORTS_DATA.players)||[]).map(p=>({...p,fp:Number(p.projection??p.fp??20)}));
  return live.length?live:freeAgents;
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

function openPlayer(id){
  selectedPlayerId=id;
  render("player");
}

function h(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
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
    <span class="fp">${Number(p.fp??p.projection??0).toFixed(1)}</span>
    ${add ? '<button class="add-btn" aria-label="Add player">ADD</button>' : ""}
  </div>`;
}

function rosterRow(p, manage=false){
  const slot=p.slot||p.role;
  const fp=Number(p.fp??p.projection??0);
  return `<div class="roster-slot ${slot==="BN"?"bench":""}">
    <span class="slot-label">${slot}</span>
    <div class="player-info"><strong>${h(p.name)}</strong><small>${h(p.team)} · ${h(p.position||p.role)}${p.opp?" · "+h(p.opp):""}</small></div>
    <span class="fp">${fp.toFixed(1)}</span>
    ${manage?'<div class="team-actions"><button class="mini-btn danger" data-drop-roster="'+playerKey(p)+'">DROP</button></div>':""}
  </div>`;
}

let currentView=null;
let navigationDepth=0;
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
  const titles={home:"Home",team:"My Team",matchup:"Matchup",schedule:"Schedule",players:"Players",player:"Player",league:"League",transactions:"Transactions",trade:"Trades",draft:"Draft Room",setup:"League Setup"};
  document.title=`${titles[view]||"Rift Fantasy"} · Rift Fantasy`;
  document.querySelectorAll(".nav-item").forEach(b=>{
    const active=b.dataset.view===view;
    b.classList.toggle("active",active);
    if(active)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");
  });

  if(view==="home"){
    const leagueName=document.querySelector("#homeLeagueName");
    if(leagueName)leagueName.textContent=getLeagueSettings().name;
    const currentRoster=getUserRoster();
    const starters=currentRoster.filter(p=>(p.slot||p.role)!=="BN").slice(0,3);
    document.querySelector("#starterPreview").innerHTML = starters.length?starters.map(p=>playerRow({...p,role:p.position||p.role})).join(""):'<div class="empty-state"><strong>Your roster is empty</strong><small>Browse Players to add your first fantasy player.</small></div>';
    document.querySelector("#draftBtn").onclick=()=>render("draft");
    const onboarding=document.querySelector("#onboardingCard");
    if(storageGet("riftOnboardingDismissed")==="1" && onboarding) onboarding.remove();
    const dismiss=document.querySelector("#dismissOnboarding");
    if(dismiss) dismiss.onclick=()=>{storageSet("riftOnboardingDismissed","1");onboarding?.remove();};
  }
  if(view==="team"){
    const current=getUserRoster();
    const projected=current.filter(p=>(p.slot||p.role)!=="BN").reduce((sum,p)=>sum+Number(p.fp??p.projection??0),0);
    const compact=document.querySelector(".card.compact");
    if(compact) compact.innerHTML=`<div class="stat-row"><span>Prototype projection</span><strong>${projected.toFixed(1)}</strong></div><div class="stat-row"><span>Roster</span><strong>${current.length}/${rosterLimit()}</strong></div>`;
    document.querySelector("#rosterList").innerHTML = current.length?current.map(p=>rosterRow(p,true)).join(""):'<div class="empty-state"><strong>No players on your roster</strong><small>Use the Players tab to add someone.</small></div>';
    document.querySelectorAll("[data-drop-roster]").forEach(btn=>btn.onclick=()=>{
      const currentNow=getUserRoster();
      const player=currentNow.find(p=>playerKey(p)===btn.dataset.dropRoster);
      if(!player)return;
      if(!window.confirm(`Drop ${player.name} from your roster?`))return;
      saveUserRoster(arrangeUserRoster(currentNow.filter(p=>playerKey(p)!==btn.dataset.dropRoster)));
      logTransaction("drop",player);
      showToast(`${player.name} dropped`);
      render("team");
    });
  }
  if(view==="player"){
    const p=playerById(selectedPlayerId) || allFantasyPlayers()[0];
    if(!p){ render("players"); return; }
    selectedPlayerId=p.id||selectedPlayerId;
    document.querySelector("#profileRole").textContent=p.role||"—";
    document.querySelector("#profileTeam").textContent=p.team||"Unknown team";
    document.querySelector("#profileName").textContent=p.name||"Player";
    document.querySelector("#profileRank").textContent=`Prototype rank #${p.rank||"—"}`;
    const owned=isOwned(p);
    document.querySelector("#profileStatus").textContent=owned?"On your roster":"Available";
    document.querySelector("#profileProjection").textContent=Number(p.fp??p.projection??0).toFixed(1);

    const outlookByRole={
      TOP:"Top laners gain value through steady scoring, matchup stability, and strong team win equity.",
      JNG:"Junglers can create fantasy spikes through kills, assists, objectives, and high map involvement.",
      MID:"Mid laners often combine strong kill participation with reliable farm, giving them a high fantasy ceiling.",
      ADC:"AD carries can produce some of the biggest fantasy totals when their team plays through late-game damage and kills.",
      SUP:"Supports usually rely on assists, vision, and team success, making them valuable when attached to winning teams."
    };
    document.querySelector("#profileOutlook").textContent=`${p.name} projects as a ${p.role} option for ${p.team}. ${outlookByRole[p.role]||"Their fantasy value depends on role, team performance, and match volume."}`;

    const base=Number(p.fp??p.projection??20);
    const stats=[
      ["Projection",base.toFixed(1)],
      ["Upside",Math.max(base+5,base*1.16).toFixed(1)],
      ["Floor",Math.max(8,base-6).toFixed(1)],
      ["Role",p.role||"—"],
      ["Team",p.teamCode||String(p.team||"").slice(0,4).toUpperCase()],
      ["Rank",p.rank?"#"+p.rank:"—"]
    ];
    document.querySelector("#profileStats").innerHTML=stats.map(s=>`<div class="profile-stat"><small>${h(s[0])}</small><strong>${h(s[1])}</strong></div>`).join("");

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

    document.querySelector("#profileTrend").innerHTML='<div class="empty-state"><strong>Game logs not connected yet</strong><small>Recent fantasy results will appear here once live scoring and historical statistics are connected.</small></div>';

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
    if(owned){waiverBtn.textContent="Already Owned";waiverBtn.disabled=true;}
    else waiverBtn.onclick=()=>createWaiverClaim(p);
    document.querySelector("#profileTradeBtn").onclick=()=>{tradePrefill={id:playerKey(p),side:owned?"mine":"theirs"};render("trade");};
    document.querySelector("#playerBackBtn").onclick=()=>goBack("players");
  }
  if(view==="matchup"){
    const matchupRoster=getUserRoster().filter(p=>(p.slot||p.role)!=="BN").slice(0,5);
    document.querySelector("#battleList").innerHTML = matchupRoster.length?matchupRoster.map((p,i)=>`<div class="battle-row">
      <div class="battle-side"><span class="role-badge">${p.role}</span><div class="player-info"><strong>${h(p.name)}</strong><small>${h(p.team)}</small></div></div>
      <span class="battle-score">${Number(p.fp??p.projection??0).toFixed(1)} - ${Number(opponents[i]?.score??0).toFixed(1)}</span>
      <div class="battle-side right"><div class="player-info"><strong>${h(opponents[i]?.name||"Opponent")}</strong><small>Demo opponent</small></div></div>
    </div>`).join(""):'<div class="empty-state"><strong>No starters set</strong><small>Add players to your roster to populate this demo matchup.</small></div>';
  }
  if(view==="schedule"){
    const list=document.querySelector("#scheduleList");
    let day="all";
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
        return heading+`<div class="game-card">
          <div class="game-team"><span class="team-mark">${h(g.aCode||"TBD")}</span><div><strong>${h(g.a||"TBD")}</strong><small>Team 1</small></div></div>
          <div class="game-meta"><span class="game-time">${h(g.time||"TBD")}</span><span class="game-league">${h(g.league||"LoL Esports")}</span><span class="game-stage">${h(g.stage||"")}</span><span class="game-status ${String(g.status||"").toUpperCase().includes("PROGRESS")?"live":""}">${h(g.status||"UPCOMING")}</span></div>
          <div class="game-team right"><div><strong>${h(g.b||"TBD")}</strong><small>Team 2</small></div><span class="team-mark">${h(g.bCode||"TBD")}</span></div>
        </div>`;
      }).join(""):'<div class="empty-state"><strong>No matches found</strong><small>Try another filter or check back after the next data refresh.</small></div>';
    };
    document.querySelectorAll("[data-day]").forEach(c=>c.onclick=()=>{day=c.dataset.day;document.querySelectorAll("[data-day]").forEach(x=>x.classList.remove("active"));c.classList.add("active");drawSchedule();});
    const dataText=document.querySelector("#dataUpdatedText");
    const dataTitle=document.querySelector("#dataStatusTitle");
    const zone=document.querySelector("#scheduleZone");
    const hasTimestampedMatches=proSchedule.some(g=>g.startTime&&Number.isFinite(Date.parse(g.startTime)));
    if(zone)zone.textContent=hasTimestampedMatches?"LOCAL TIME":"SNAPSHOT TIME";
    if(dataText&&window.ESPORTS_DATA){
      const stamp=new Date(window.ESPORTS_DATA.updatedAt);
      const when=Number.isNaN(stamp.getTime())?window.ESPORTS_DATA.updatedAt:stamp.toLocaleString();
      const ageHours=(Date.now()-stamp.getTime())/3600000;
      const freshness=Number.isFinite(ageHours)&&ageHours>24?"Data may be stale. ":"";
      if(dataTitle)dataTitle.textContent=window.ESPORTS_DATA.autoUpdated?"LoL Esports data refreshed":"LoL Esports data snapshot";
      const timeNote=hasTimestampedMatches?"Match times are converted to your device's local time.":"This fallback snapshot does not include timezone-normalized timestamps; displayed times are preserved as stored.";
      dataText.textContent=`${freshness}${window.ESPORTS_DATA.autoUpdated?"Auto-refreshed":"Snapshot updated"} ${when}. ${timeNote}`;
    }else if(dataText){
      if(dataTitle)dataTitle.textContent="Schedule data unavailable";
      dataText.textContent="The external data file could not be loaded. The rest of the app remains available.";
    }
    drawSchedule();
  }
  if(view==="players"){
    const list=document.querySelector("#freeAgentList");
    const search=document.querySelector("#playerSearch");
    let role="ALL";
    const draw=()=>{
      const q=search.value.trim().toLowerCase();
      const source=allFantasyPlayers();
      const filtered=source.filter(p=>(role==="ALL"||p.role===role)&&(`${p.name} ${p.team} ${p.role}`.toLowerCase().includes(q)));
      list.innerHTML=filtered.map(p=>playerRow(p,true)).join("") || '<div class="empty-state"><strong>No players found</strong><small>Try a different name, team, or role.</small></div>';
      list.querySelectorAll(".add-btn").forEach((b,i)=>{
        const p=filtered[i];
        if(isOwned(p)){b.textContent="OWNED";b.classList.add("owned");b.disabled=true;}
        else b.onclick=(e)=>{e.stopPropagation();addPlayerToRoster(p);draw();};
      });
      list.querySelectorAll("[data-open-player]").forEach(row=>{
        row.onclick=(e)=>{if(e.target.closest(".add-btn"))return;openPlayer(row.dataset.openPlayer);};
        row.onkeydown=(e)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openPlayer(row.dataset.openPlayer);}};
      });
    };
    search.oninput=draw;
    document.querySelectorAll(".chip").forEach(c=>c.onclick=()=>{role=c.dataset.role;document.querySelectorAll(".chip").forEach(x=>x.classList.remove("active"));c.classList.add("active");draw();});
    draw();
  }
  if(view==="trade"){
    let tab="offers";
    let selectedMine=tradePrefill.side==="mine"?tradePrefill.id:null;
    let selectedTheirs=tradePrefill.side==="theirs"?tradePrefill.id:null;
    const partnerSelect=document.querySelector("#tradePartner");
    const myList=document.querySelector("#tradeMyPlayers");
    const theirList=document.querySelector("#tradeTheirPlayers");
    const summary=document.querySelector("#tradeSummaryBox");
    const submit=document.querySelector("#submitTradeBtn");
    const content=document.querySelector("#tradeContent");

    const managers=leagueManagers();
    partnerSelect.innerHTML=managers.map(m=>`<option value="${h(m)}">${h(m)}</option>`).join("");
    if(selectedTheirs){
      const preferred=managers.find(m=>simulatedRosterForManager(m).some(p=>playerKey(p)===String(selectedTheirs)));
      if(preferred)partnerSelect.value=preferred;
    }
    tradePrefill={id:null,side:null};

    const fmt=(iso)=>{const d=new Date(iso);return Number.isNaN(d.getTime())?"":d.toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});};

    const renderBuilder=()=>{
      const mine=getUserRoster();
      const theirs=simulatedRosterForManager(partnerSelect.value);
      if(selectedTheirs && !theirs.some(p=>playerKey(p)===String(selectedTheirs))) selectedTheirs=null;

      myList.innerHTML=mine.length?mine.map(p=>`<button class="trade-option ${selectedMine===playerKey(p)?"selected":""}" data-trade-mine="${playerKey(p)}"><strong>${h(p.name)}</strong><small>${h(p.position||p.role)} · ${h(p.team)}</small></button>`).join(""):'<div class="empty-state"><strong>No rostered players</strong><small>Add a player before building a trade.</small></div>';
      theirList.innerHTML=theirs.length?theirs.map(p=>`<button class="trade-option ${String(selectedTheirs)===playerKey(p)?"selected":""}" data-trade-theirs="${playerKey(p)}"><strong>${h(p.name)}</strong><small>${h(p.role)} · ${h(p.team)}</small></button>`).join(""):'<div class="empty-state"><strong>No simulated roster available</strong><small>More verified player data is needed for this trade partner.</small></div>';

      const myP=mine.find(p=>playerKey(p)===selectedMine);
      const theirP=theirs.find(p=>playerKey(p)===String(selectedTheirs));
      if(myP&&theirP){
        summary.innerHTML=`You send <strong>${h(myP.name)}</strong> to ${h(partnerSelect.value)} and receive <strong>${h(theirP.name)}</strong>.`;
        submit.disabled=false;
      }else{
        summary.textContent="Select one player from each side to build an offer.";
        submit.disabled=true;
      }

      myList.querySelectorAll("[data-trade-mine]").forEach(b=>b.onclick=()=>{selectedMine=b.dataset.tradeMine;renderBuilder();});
      theirList.querySelectorAll("[data-trade-theirs]").forEach(b=>b.onclick=()=>{selectedTheirs=b.dataset.tradeTheirs;renderBuilder();});
    };

    const renderTradeTabs=()=>{
      const offers=getTradeOffers();
      const history=getTradeHistory();
      if(tab==="offers"){
        const mine=offers.filter(o=>o.direction==="outgoing");
        content.innerHTML=mine.length?mine.map(o=>`<div class="trade-card"><div class="trade-card-head"><div><h4>${h(o.partner)}</h4><small>Sent ${fmt(o.createdAt)}</small></div><span class="trade-status pending">PENDING</span></div><div class="trade-swap"><div class="trade-side"><span>YOU SEND</span><strong>${h(o.userPlayer)}</strong></div><div class="trade-arrow">⇄</div><div class="trade-side"><span>YOU RECEIVE</span><strong>${h(o.theirPlayer)}</strong></div></div><div class="trade-card-actions"><button class="secondary-btn" data-cancel-trade="${o.id}">Cancel Offer</button></div></div>`).join(""):'<div class="empty-state"><strong>No outgoing offers</strong><small>Build a trade above and send it to another manager.</small></div>';
        content.querySelectorAll("[data-cancel-trade]").forEach(b=>b.onclick=()=>{saveTradeOffers(getTradeOffers().filter(o=>o.id!==b.dataset.cancelTrade));showToast("Trade offer canceled");renderTradeTabs();});
      }else if(tab==="incoming"){
        const incoming=offers.filter(o=>o.direction==="incoming");
        content.innerHTML=incoming.length?incoming.map(o=>`<div class="trade-card"><div class="trade-card-head"><div><h4>Offer from ${h(o.partner)}</h4><small>${fmt(o.createdAt)}</small></div><span class="trade-status pending">PENDING</span></div><div class="trade-swap"><div class="trade-side"><span>YOU SEND</span><strong>${h(o.userPlayer)}</strong></div><div class="trade-arrow">⇄</div><div class="trade-side"><span>YOU RECEIVE</span><strong>${h(o.theirPlayer)}</strong></div></div><div class="trade-card-actions"><button class="primary-btn" data-accept-trade="${o.id}">Accept</button><button class="secondary-btn" data-decline-trade="${o.id}">Decline</button></div></div>`).join(""):'<div class="empty-state"><strong>No incoming offers</strong><small>Trade offers from other managers will appear here.</small></div>';
        content.querySelectorAll("[data-accept-trade]").forEach(b=>b.onclick=()=>{
          const id=b.dataset.acceptTrade;
          const offer=getTradeOffers().find(o=>o.id===id);
          if(!offer)return;
          completeIncomingTrade(offer,true); renderTradeTabs(); renderBuilder();
        });
        content.querySelectorAll("[data-decline-trade]").forEach(b=>b.onclick=()=>{
          const id=b.dataset.declineTrade;
          const offer=getTradeOffers().find(o=>o.id===id);
          if(!offer)return;
          completeIncomingTrade(offer,false); renderTradeTabs();
        });
      }else{
        content.innerHTML=history.length?history.map(o=>`<div class="trade-card"><div class="trade-card-head"><div><h4>${h(o.partner)}</h4><small>${fmt(o.resolvedAt||o.createdAt)}</small></div><span class="trade-status ${o.status}">${String(o.status).toUpperCase()}</span></div><div class="trade-swap"><div class="trade-side"><span>YOU SENT</span><strong>${h(o.userPlayer)}</strong></div><div class="trade-arrow">⇄</div><div class="trade-side"><span>YOU RECEIVED</span><strong>${h(o.theirPlayer)}</strong></div></div></div>`).join(""):'<div class="empty-state"><strong>No trade history</strong><small>Completed or declined trades will show here.</small></div>';
      }
    };

    partnerSelect.onchange=()=>{selectedTheirs=null;renderBuilder();};
    submit.onclick=()=>{
      const mine=getUserRoster().find(p=>playerKey(p)===selectedMine);
      const theirs=simulatedRosterForManager(partnerSelect.value).find(p=>playerKey(p)===String(selectedTheirs));
      if(!mine||!theirs)return;
      const offers=getTradeOffers();
      offers.unshift({id:String(Date.now()),direction:"outgoing",partner:partnerSelect.value,userPlayerId:playerKey(mine),userPlayer:mine.name,theirPlayerId:playerKey(theirs),theirPlayer:theirs.name,theirTeam:theirs.team,theirRole:theirs.role,theirFp:Number(theirs.fp??theirs.projection??20),createdAt:new Date().toISOString(),status:"pending"});
      saveTradeOffers(offers);
      showToast("Trade offer sent.");
      selectedMine=null; selectedTheirs=null; renderBuilder(); renderTradeTabs();
    };

    document.querySelectorAll("[data-trade-tab]").forEach(btn=>btn.onclick=()=>{
      tab=btn.dataset.tradeTab;
      document.querySelectorAll("[data-trade-tab]").forEach(x=>x.classList.toggle("active",x===btn));
      renderTradeTabs();
    });
    renderBuilder();
    renderTradeTabs();
  }
  if(view==="transactions"){
    let tab="pending";
    const content=document.querySelector("#transactionContent");
    const count=document.querySelector("#pendingClaimCount");
    const formatTime=(iso)=>{
      const d=new Date(iso);
      if(Number.isNaN(d.getTime()))return "";
      return d.toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
    };
    const drawTransactions=()=>{
      const claims=getWaiverClaims();
      const history=getTransactionHistory();
      count.textContent=claims.length;
      if(tab==="pending"){
        content.innerHTML=claims.length?claims.map((c,i)=>`<div class="transaction-item">
          <span class="transaction-icon claim">W</span>
          <div class="transaction-info"><strong>#${i+1} ${h(c.player)}<span class="status-pill pending">PENDING</span></strong><small>${h(c.team)} · ${h(c.role)} · Your claim order #${i+1}</small><div class="claim-actions"><button class="claim-btn" data-move-up="${c.id}" ${i===0?"disabled":""}>Move up</button><button class="claim-btn cancel" data-cancel-claim="${c.id}">Cancel</button></div></div>
          <span class="transaction-time">${formatTime(c.createdAt)}</span>
        </div>`).join(""):'<div class="empty-state"><strong>No pending waiver claims</strong><small>Open a player profile and tap Waiver Claim to add one.</small></div>';
        content.querySelectorAll("[data-cancel-claim]").forEach(btn=>btn.onclick=()=>{
          saveWaiverClaims(getWaiverClaims().filter(c=>c.id!==btn.dataset.cancelClaim));
          showToast("Waiver claim canceled");
          drawTransactions();
        });
        content.querySelectorAll("[data-move-up]").forEach(btn=>btn.onclick=()=>{
          const items=getWaiverClaims();
          const idx=items.findIndex(c=>c.id===btn.dataset.moveUp);
          if(idx>0){[items[idx-1],items[idx]]=[items[idx],items[idx-1]];saveWaiverClaims(items);drawTransactions();}
        });
      }else if(tab==="history"){
        content.innerHTML=history.length?history.map(t=>`<div class="transaction-item">
          <span class="transaction-icon ${t.type==="drop"?"drop":""}">${t.type==="add"?"+":"−"}</span>
          <div class="transaction-info"><strong>${t.type==="add"?"Added":"Dropped"} ${h(t.player)}<span class="status-pill success">COMPLETE</span></strong><small>${h(t.team)} · ${h(t.role)}${t.pairedWith?" · paired with "+t.pairedWith:""}</small></div>
          <span class="transaction-time">${formatTime(t.time)}</span>
        </div>`).join(""):'<div class="empty-state"><strong>No transaction history yet</strong><small>Your completed adds and drops will appear here automatically.</small></div>';
      }else{
        content.innerHTML='<div class="empty-state"><strong>League-wide activity is not connected yet</strong><small>This requires the future shared league backend. Your own completed adds and drops remain available under My History.</small></div>';
      }
    };

    document.querySelectorAll("[data-transaction-tab]").forEach(btn=>btn.onclick=()=>{
      tab=btn.dataset.transactionTab;
      document.querySelectorAll("[data-transaction-tab]").forEach(x=>x.classList.toggle("active",x===btn));
      drawTransactions();
    });
    drawTransactions();
  }
  if(view==="league"){
    const settings=getLeagueSettings();
    const leagueLabel=document.querySelector("#leagueNameLabel");
    if(leagueLabel)leagueLabel.textContent=String(settings.name||"Fantasy League").toUpperCase();
    document.querySelector("#standings").innerHTML=standings.slice(0,Number(settings.managers)||4).map(s=>`<div class="standing-row"><span class="rank">${s[0]}</span><strong>${s[1]}</strong><span>${s[2]}</span><span class="pts">${s[3]}</span></div>`).join("");
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
    let state=getDraftState();
    let role="ALL";
    const search=document.querySelector("#draftSearch");
    const list=document.querySelector("#draftPlayerList");
    const board=document.querySelector("#draftBoard");
    const rosterEl=document.querySelector("#myDraftRoster");
    const fullBoard=document.querySelector("#fullDraftBoard");

    const drawDraft=()=>{
      state=getDraftState();
      if(!state||!state.started){
        document.querySelector("#draftRoundLabel").textContent="MOCK SNAKE DRAFT";
        document.querySelector("#draftTurnLabel").textContent="Draft ready";
        document.querySelector("#draftHint").textContent="You will draft from slot #2.";
        document.querySelector("#draftClock").textContent="0:30";
        document.querySelector("#draftProgress").textContent="0 picks";
        board.innerHTML='<div class="muted">No picks yet.</div>';
      }else{
        const managerIndex=draftOrderForPick(state.pickIndex,state.managerCount);
        const round=Math.floor(state.pickIndex/state.managerCount)+1;
        const within=state.pickIndex%state.managerCount+1;
        document.querySelector("#draftRoundLabel").textContent=state.complete?"DRAFT COMPLETE":`ROUND ${round} · PICK ${within}`;
        document.querySelector("#draftTurnLabel").textContent=state.complete?"Mock draft complete":managerIndex===state.userIndex?"You're on the clock":`${draftManagerNames[managerIndex]||"CPU Manager"} is picking`;
        document.querySelector("#draftHint").textContent=state.complete?"Reset to draft again.":managerIndex===state.userIndex?"Choose any available player below.":"CPU picks are automatic.";
        document.querySelector("#draftClock").textContent=`0:${String(state.seconds??30).padStart(2,"0")}`;
        document.querySelector("#draftProgress").textContent=`${state.picks.length} picks`;
        const recent=state.picks.slice(-10).reverse();
        board.innerHTML=recent.length?recent.map(p=>`<div class="draft-pick ${p.managerIndex===state.userIndex?"mine":""}"><small>#${h(p.pick)} · R${h(p.round)}</small><strong>${h(p.name)}</strong><span>${h(p.role)} · ${h(p.manager)}</span></div>`).join(""):'<div class="muted">No picks yet.</div>';
      }

      const boardState=state||{managerCount:Number(getLeagueSettings().managers)||8,picks:[],pickIndex:0,userIndex:1,started:false,complete:false};
      const settings=getLeagueSettings();
      const totalRounds=5+Number(settings.bench||3);
      const cols=boardState.managerCount;
      const headers=Array.from({length:cols},(_,i)=>`<div class="board-head">${h(draftManagerNames[i]||("Manager "+(i+1)))}</div>`).join("");
      let cells="";
      for(let r=0;r<totalRounds;r++){
        for(let c=0;c<cols;c++){
          const managerIndex=r%2===0?c:cols-1-c;
          const overall=r*cols+c;
          const pick=(boardState.picks||[]).find(p=>p.pick===overall+1);
          const onClock=boardState.started&&!boardState.complete&&overall===boardState.pickIndex;
          cells+=`<div class="board-cell ${managerIndex===boardState.userIndex?"mine":""} ${onClock?"on-clock":""}">
            <small>R${r+1} · #${overall+1}</small>
            <strong>${pick?h(pick.name):"—"}</strong>
            <span>${pick?h(pick.role):h(draftManagerNames[managerIndex]||"")}</span>
          </div>`;
        }
      }
      fullBoard.innerHTML=`<div class="full-board-grid" style="grid-template-columns:repeat(${cols},minmax(92px,1fr))">${headers}${cells}</div>`;

      const taken=new Set((state?.picks||[]).map(p=>p.playerId));
      const q=search.value.trim().toLowerCase();
      const isUserTurn=state&&state.started&&!state.complete&&draftOrderForPick(state.pickIndex,state.managerCount)===state.userIndex;
      const filtered=draftPool.filter(p=>!taken.has(p.id)&&(role==="ALL"||p.role===role)&&(`${p.name} ${p.team} ${p.role}`.toLowerCase().includes(q)));
      list.innerHTML=filtered.map(p=>`<div class="player-row draft-player"><span class="role-badge">${h(p.role)}</span><div class="player-info"><strong>${h(p.name)}${p.verified?'<span class="data-chip">ROSTER SNAPSHOT</span>':""}</strong><small>${h(p.team)}</small></div><span class="fp">${Number(p.fp??0).toFixed(1)}</span><button class="draft-btn" data-player-id="${playerKey(p)}" ${isUserTurn?"":"disabled"}>DRAFT</button></div>`).join("")||'<div class="card muted">No available players match this filter.</div>';
      list.querySelectorAll("[data-player-id]").forEach(btn=>btn.onclick=()=>{
        state=getDraftState();
        if(!state||state.complete||draftOrderForPick(state.pickIndex,state.managerCount)!==state.userIndex)return;
        const player=draftPool.find(p=>playerKey(p)===btn.dataset.playerId);
        if(!player)return;
        if(!canDraftPlayer(state,state.userIndex,player)){showToast("That pick would exceed your roster limits.");return;}
        makeDraftPick(state,player,state.userIndex);
        runCpuPicks(state);
        drawDraft();
      });

      const mine=(state?.picks||[]).filter(p=>p.managerIndex===state.userIndex);
      const starterRoles=["TOP","JNG","MID","ADC","SUP"];
      const used=new Set();
      const slotPlayers=[];
      starterRoles.forEach(roleName=>{
        const idx=mine.findIndex((p,i)=>!used.has(i)&&p.role===roleName);
        if(idx>=0){used.add(idx);slotPlayers.push({slot:roleName,p:mine[idx],starter:true});}
        else slotPlayers.push({slot:roleName,p:null,starter:true});
      });
      mine.forEach((p,i)=>{if(!used.has(i))slotPlayers.push({slot:"BN",p,starter:false});});
      while(slotPlayers.length<5+Number(settings.bench||3))slotPlayers.push({slot:"BN",p:null,starter:false});
      rosterEl.innerHTML=slotPlayers.map(x=>`<div class="draft-roster-slot ${x.p?(x.starter?"filled-start":"filled-bench"):""}"><small>${h(x.slot)}</small><strong class="${x.p?"":"empty-slot"}">${x.p?h(x.p.name):"Empty"}</strong></div>`).join("");
    };

    const startDraftBtn=document.querySelector("#startDraftBtn");
    const requiredStarters=(Number(getLeagueSettings().managers)||4)*5;
    if((!state||!state.started)&&draftPool.length<requiredStarters){
      startDraftBtn.disabled=true;
      document.querySelector("#draftHint").textContent=`Need at least ${requiredStarters} verified players for this league size. Reduce managers in League Setup or wait for a data refresh.`;
    }
    startDraftBtn.onclick=()=>{
      const existing=getDraftState();
      if(existing?.picks?.length && !existing.complete){
        const ok=window.confirm("Reset this draft? Your current mock draft picks will be cleared.");
        if(!ok)return;
      }
      state=newDraftState();
      saveDraftState(state);
      runCpuPicks(state);
      drawDraft();
      showToast("Mock draft started. You are drafting from slot #2.");
    };
    document.querySelector("#autoPickBtn").onclick=()=>{
      state=getDraftState();
      if(!state||state.complete||draftOrderForPick(state.pickIndex,state.managerCount)!==state.userIndex){showToast("It is not your turn.");return;}
      const p=bestAvailableDraftPlayer(state,state.userIndex);
      if(p){makeDraftPick(state,p,state.userIndex);runCpuPicks(state);drawDraft();}
    };
    search.oninput=drawDraft;
    document.querySelectorAll("[data-draft-role]").forEach(c=>c.onclick=()=>{role=c.dataset.draftRole;document.querySelectorAll("[data-draft-role]").forEach(x=>x.classList.remove("active"));c.classList.add("active");drawDraft();});
    drawDraft();

    draftTimerId=setInterval(()=>{
      state=getDraftState();
      if(!state||!state.started||state.complete)return;
      if(draftOrderForPick(state.pickIndex,state.managerCount)!==state.userIndex)return;
      state.seconds=Math.max(0,(state.seconds??30)-1);
      if(state.seconds===0){
        const p=bestAvailableDraftPlayer(state);
        if(p){makeDraftPick(state,p,state.userIndex);runCpuPicks(state);}
      }else saveDraftState(state);
      drawDraft();
    },1000);
  }
  if(view==="setup"){
    const settings=getLeagueSettings();
    document.querySelector("#leagueName").value=settings.name;
    const managerSelect=document.querySelector("#managerCount");
    const maxManagers=Math.max(2,Math.floor(draftPool.length/5));
    [...managerSelect.options].forEach(option=>{
      const unsupported=Number(option.value)>maxManagers;
      option.disabled=unsupported;
      if(unsupported)option.title=`Needs at least ${Number(option.value)*5} verified players`;
    });
    if([...managerSelect.options].some(o=>o.value===String(settings.managers)&&!o.disabled)) managerSelect.value=settings.managers;
    else managerSelect.value=[...managerSelect.options].find(o=>!o.disabled)?.value||"4";
    document.querySelector("#benchCount").value=settings.bench;
    document.querySelector("#competition").value=settings.competition;
    document.querySelector("#teamSlot").checked=settings.teamSlot;
    document.querySelector("#scoreKills").value=settings.scoring.kills;
    document.querySelector("#scoreDeaths").value=settings.scoring.deaths;
    document.querySelector("#scoreAssists").value=settings.scoring.assists;
    document.querySelector("#scoreCs").value=settings.scoring.cs;
    document.querySelector("#scoreWin").value=settings.scoring.win;
    document.querySelector("#scoreFb").value=settings.scoring.firstBlood;

    document.querySelectorAll('[data-choice-group="draftType"] .choice').forEach(b=>b.classList.toggle("active",b.dataset.value===settings.draftType));
    document.querySelectorAll('[data-choice-group="scoringFormat"] .choice').forEach(b=>b.classList.toggle("active",b.dataset.value===settings.scoringFormat));

    document.querySelectorAll(".choice").forEach(btn=>btn.onclick=()=>{
      const group=btn.parentElement;
      group.querySelectorAll(".choice").forEach(x=>x.classList.remove("active"));
      btn.classList.add("active");
    });

    document.querySelector("#saveLeagueBtn").onclick=()=>{
      const numberOr=(id,fallback)=>{
        const n=Number(document.querySelector(id).value);
        return Number.isFinite(n)?n:fallback;
      };
      const next={
        name:document.querySelector("#leagueName").value.trim()||"Summoner's Cup",
        managers:managerSelect.value,
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
      const prior=getLeagueSettings();
      storageSet("riftLeagueSettings",JSON.stringify(next));
      if(prior.managers!==next.managers||prior.bench!==next.bench)storageRemove("riftDraftState");
      showToast("League settings saved");
      render("league");
    };
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
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeTransactionModal();});
window.addEventListener("popstate",e=>{navigationDepth=Number(e.state?.depth)||0;render(e.state?.view||location.hash.slice(1)||"home",{fromHistory:true});});
document.querySelector("#notificationBtn").onclick=()=>showToast("No new league notifications.");
render(location.hash.slice(1)||"home",{replace:true});