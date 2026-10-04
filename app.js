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
  if(!g.startTime) return g;
  const d=new Date(g.startTime);
  if(Number.isNaN(d.getTime())) return g;
  const now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const gameDay=new Date(d.getFullYear(),d.getMonth(),d.getDate());
  const diff=Math.round((gameDay-today)/86400000);
  const day=diff===0?"today":diff===1?"tomorrow":"upcoming";
  const prefix=diff===0?"TODAY":diff===1?"TOMORROW":d.toLocaleDateString(undefined,{month:"short",day:"numeric"}).toUpperCase();
  return {
    ...g,
    day,
    label:`${prefix} · ${d.toLocaleDateString(undefined,{month:"short",day:"numeric"}).toUpperCase()}`,
    time:d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})
  };
}
const draftPool = ((window.ESPORTS_DATA && window.ESPORTS_DATA.players) || []).map(p=>({...p,fp:p.projection}));

const draftManagerNames = ["Baron Bandits","Zeuxidamus","Rift Raiders","Pentakill Club","Nexus Breakers","Blue Buff Boys","Dragon Slayers","Iron V","Red Side","First Blood","Scuttle Club","Elder Enjoyers"];
let draftTimerId=null;

function draftOrderForPick(pickIndex,managerCount){
  const round=Math.floor(pickIndex/managerCount);
  const within=pickIndex%managerCount;
  return round%2===0 ? within : managerCount-1-within;
}

function getDraftState(){
  try{return JSON.parse(localStorage.getItem("riftDraftState")||"null");}catch{return null;}
}

function saveDraftState(state){
  localStorage.setItem("riftDraftState",JSON.stringify(state));
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
  while(state.started&&!state.complete&&draftOrderForPick(state.pickIndex,state.managerCount)!==state.userIndex&&guard<20){
    const p=bestAvailableDraftPlayer(state,draftOrderForPick(state.pickIndex,state.managerCount));
    if(!p){state.complete=true;break;}
    makeDraftPick(state,p,draftOrderForPick(state.pickIndex,state.managerCount));
    guard++;
  }
  saveDraftState(state);
}

const defaultLeagueSettings = {
  name:"Summoner's Cup",
  managers:"8",
  bench:"3",
  draftType:"Snake",
  scoringFormat:"Head-to-head",
  competition:"Worlds",
  teamSlot:false,
  scoring:{kills:3,deaths:-1,assists:2,cs:0.02,win:5,firstBlood:2}
};

function getLeagueSettings(){
  try{
    return {...defaultLeagueSettings,...JSON.parse(localStorage.getItem("riftLeagueSettings")||"{}")};
  }catch{
    return {...defaultLeagueSettings};
  }
}

let selectedPlayerId=null;

function playerKey(p){
  return String(p.id || p.name || "").toLowerCase().replace(/[^a-z0-9]+/g,"-");
}

function defaultUserRoster(){
  return roster.map(p=>({
    ...p,
    id:playerKey(p),
    position:p.position || (p.role==="BN"?"MID":p.role),
    slot:p.role
  }));
}

function getUserRoster(){
  try{
    const saved=JSON.parse(localStorage.getItem("riftUserRoster")||"null");
    return Array.isArray(saved)&&saved.length ? saved : defaultUserRoster();
  }catch{
    return defaultUserRoster();
  }
}

function saveUserRoster(players){
  localStorage.setItem("riftUserRoster",JSON.stringify(players));
}

function getTransactionHistory(){
  try{return JSON.parse(localStorage.getItem("riftTransactionHistory")||"[]");}catch{return [];}
}
function saveTransactionHistory(items){
  localStorage.setItem("riftTransactionHistory",JSON.stringify(items.slice(0,100)));
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
  try{return JSON.parse(localStorage.getItem("riftWaiverClaims")||"[]");}catch{return [];}
}
function saveWaiverClaims(items){
  localStorage.setItem("riftWaiverClaims",JSON.stringify(items));
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
  if(modal) modal.hidden=true;
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
  list.innerHTML=current.map(p=>`<button class="drop-option" data-drop-id="${playerKey(p)}"><span class="role-badge">${p.slot||p.role}</span><span><strong>${p.name}</strong><small>${p.team} · ${p.position||p.role}</small></span><span class="drop-action">DROP</span></button>`).join("");
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
  modal.hidden=false;
}

function allFantasyPlayers(){
  const live=((window.ESPORTS_DATA&&window.ESPORTS_DATA.players)||[]).map(p=>({...p,fp:Number(p.projection??p.fp??20)}));
  return live.length?live:freeAgents;
}

function watchlistIds(){
  try{return new Set(JSON.parse(localStorage.getItem("riftWatchlist")||"[]"));}catch{return new Set();}
}

function setWatchlist(ids){
  localStorage.setItem("riftWatchlist",JSON.stringify([...ids]));
}

function playerById(id){
  return allFantasyPlayers().find(p=>String(p.id)===String(id));
}

function openPlayer(id){
  selectedPlayerId=id;
  render("player");
}

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

function showToast(message){
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(()=>toast.classList.remove("show"),1800);
}

function playerRow(p, add=false){
  const pid=p.id||String(p.name).toLowerCase().replace(/[^a-z0-9]+/g,"-");
  return `<div class="player-row clickable" data-open-player="${pid}" tabindex="0" role="button" aria-label="Open ${p.name} profile">
    <span class="role-badge">${p.role}</span>
    <div class="player-info"><strong>${p.name}</strong><small>${p.team} · ${p.opp || p.trend || ""}</small></div>
    <span class="fp">${p.fp.toFixed(1)}</span>
    ${add ? '<button class="add-btn">ADD</button>' : ""}
  </div>`;
}

function rosterRow(p, manage=false){
  const slot=p.slot||p.role;
  const fp=Number(p.fp??p.projection??0);
  return `<div class="roster-slot ${slot==="BN"?"bench":""}">
    <span class="slot-label">${slot}</span>
    <div class="player-info"><strong>${p.name}</strong><small>${p.team} · ${p.position||p.role}${p.opp?" · "+p.opp:""}</small></div>
    <span class="fp">${fp.toFixed(1)}</span>
    ${manage?'<div class="team-actions"><button class="mini-btn danger" data-drop-roster="'+playerKey(p)+'">DROP</button></div>':""}
  </div>`;
}

function render(view="home"){
  const template = document.querySelector(`#${view}-template`);
  app.innerHTML = "";
  app.appendChild(template.content.cloneNode(true));
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));

  if(view==="home"){
    const currentRoster=getUserRoster();
    document.querySelector("#starterPreview").innerHTML = currentRoster.filter(p=>(p.slot||p.role)!=="BN").slice(0,3).map(p=>playerRow({...p,role:p.position||p.role})).join("");
    document.querySelector("#draftBtn").onclick=()=>render("draft");
    const onboarding=document.querySelector("#onboardingCard");
    if(localStorage.getItem("riftOnboardingDismissed")==="1" && onboarding) onboarding.remove();
    const dismiss=document.querySelector("#dismissOnboarding");
    if(dismiss) dismiss.onclick=()=>{localStorage.setItem("riftOnboardingDismissed","1");onboarding?.remove();};
  }
  if(view==="team"){
    const current=getUserRoster();
    const projected=current.filter(p=>(p.slot||p.role)!=="BN").reduce((sum,p)=>sum+Number(p.fp??p.projection??0),0);
    const compact=document.querySelector(".card.compact");
    if(compact) compact.innerHTML=`<div class="stat-row"><span>Projected starters</span><strong>${projected.toFixed(1)}</strong></div><div class="stat-row"><span>Roster</span><strong>${current.length}/${rosterLimit()}</strong></div>`;
    document.querySelector("#rosterList").innerHTML = current.map(p=>rosterRow(p,true)).join("");
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
    document.querySelector("#profileRank").textContent=`Fantasy rank #${p.rank||"—"}`;
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
    document.querySelector("#profileStats").innerHTML=stats.map(s=>`<div class="profile-stat"><small>${s[0]}</small><strong>${s[1]}</strong></div>`).join("");

    const teamName=String(p.team||"").toLowerCase();
    const teamCode=String(p.teamCode||"").toLowerCase();
    const matches=proSchedule.map(localScheduleRow).filter(g=>{
      const a=`${g.a||""} ${g.aCode||""}`.toLowerCase();
      const b=`${g.b||""} ${g.bCode||""}`.toLowerCase();
      return (teamName&&((a.includes(teamName)||b.includes(teamName)))) || (teamCode&&((a.includes(teamCode)||b.includes(teamCode))));
    }).slice(0,3);
    document.querySelector("#profileMatches").innerHTML=matches.length?matches.map(g=>{
      const opponent=(String(g.a||"").toLowerCase().includes(teamName)||String(g.aCode||"").toLowerCase()===teamCode)?g.b:g.a;
      return `<div class="profile-match"><div><strong>vs ${opponent}</strong><small>${g.league||""} · ${g.stage||""}</small></div><div><strong>${g.time||"TBD"}</strong><small>${g.label||""}</small></div></div>`;
    }).join(""):'<div class="empty-state"><strong>No upcoming match found</strong><small>The schedule will populate automatically when a matching event is available.</small></div>';

    const trend=[-2.5,1.8,-0.9,3.1,0.6].map((d,i)=>Math.max(0,base+d+(i-2)*.4));
    document.querySelector("#profileTrend").innerHTML=trend.map((v,i)=>`<div class="trend-game"><small>G${i+1}</small><strong>${v.toFixed(1)}</strong></div>`).join("");

    const watch=watchlistIds();
    const watchBtn=document.querySelector("#watchPlayerBtn");
    const syncWatch=()=>{const active=watch.has(String(p.id));watchBtn.classList.toggle("watching",active);watchBtn.textContent=active?"★ Watching":"☆ Watchlist";};
    syncWatch();
    watchBtn.onclick=()=>{const id=String(p.id);watch.has(id)?watch.delete(id):watch.add(id);setWatchlist(watch);syncWatch();showToast(watch.has(id)?"Added to watchlist":"Removed from watchlist");};
    const addBtn=document.querySelector("#profileAddBtn");
    if(owned){
      addBtn.textContent="On My Team";
      addBtn.classList.add("owned");
      addBtn.disabled=true;
    }else{
      addBtn.textContent=getUserRoster().length>=rosterLimit()?"Add / Choose Drop":"Add Player";
      addBtn.onclick=()=>addPlayerToRoster(p);
    }
    document.querySelector("#profileWaiverBtn").onclick=()=>createWaiverClaim(p);
    document.querySelector("#profileTradeBtn").onclick=()=>showToast("Trade proposals are coming in the next transaction update.");
    document.querySelector("#playerBackBtn").onclick=()=>render("players");
  }
  if(view==="matchup"){
    document.querySelector("#battleList").innerHTML = roster.slice(0,5).map((p,i)=>`<div class="battle-row">
      <div class="battle-side"><span class="role-badge">${p.role}</span><div class="player-info"><strong>${p.name}</strong><small>${p.team}</small></div></div>
      <span class="battle-score">${p.fp.toFixed(1)} - ${opponents[i].score.toFixed(1)}</span>
      <div class="battle-side right"><div class="player-info"><strong>${opponents[i].name}</strong><small>Opponent</small></div></div>
    </div>`).join("");
  }
  if(view==="schedule"){
    const list=document.querySelector("#scheduleList");
    let day="all";
    const drawSchedule=()=>{
      const filtered=proSchedule.filter(g=>day==="all"||g.day===day||(day==="upcoming"&&g.day==="upcoming"));
      let lastLabel="";
      list.innerHTML=filtered.length?filtered.map(g=>{
        const heading=g.label!==lastLabel ? `<div class="schedule-day">${g.label}</div>` : "";
        lastLabel=g.label;
        return heading+`<div class="game-card">
          <div class="game-team"><span class="team-mark">${g.aCode}</span><div><strong>${g.a}</strong><small>Team 1</small></div></div>
          <div class="game-meta"><span class="game-time">${g.time}</span><span class="game-league">${g.league}</span><span class="game-stage">${g.stage||""}</span><span class="game-status">${g.status}</span></div>
          <div class="game-team right"><div><strong>${g.b}</strong><small>Team 2</small></div><span class="team-mark">${g.bCode}</span></div>
        </div>`;
      }).join(""):'<div class="empty-state"><strong>No matches found</strong><small>Try another filter or check back after the next data refresh.</small></div>';
    };
    document.querySelectorAll("[data-day]").forEach(c=>c.onclick=()=>{day=c.dataset.day;document.querySelectorAll("[data-day]").forEach(x=>x.classList.remove("active"));c.classList.add("active");drawSchedule();});
    const dataText=document.querySelector("#dataUpdatedText");
    if(dataText&&window.ESPORTS_DATA){
      const stamp=new Date(window.ESPORTS_DATA.updatedAt);
      const when=Number.isNaN(stamp.getTime())?window.ESPORTS_DATA.updatedAt:stamp.toLocaleString();
      dataText.textContent=`${window.ESPORTS_DATA.autoUpdated?"Auto-refreshed":"Updated"} ${when} from LoL Esports. Match times are converted to your device's local time.`;
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
  if(view==="transactions"){
    let tab="pending";
    const content=document.querySelector("#transactionContent");
    const count=document.querySelector("#pendingClaimCount");
    const formatTime=(iso)=>{
      const d=new Date(iso);
      if(Number.isNaN(d.getTime()))return "";
      return d.toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
    };
    const demoActivity=[
      {manager:"Baron Bandits",type:"add",player:"Knight",time:new Date(Date.now()-38*60000).toISOString()},
      {manager:"Rift Raiders",type:"drop",player:"Noah",time:new Date(Date.now()-92*60000).toISOString()},
      {manager:"Pentakill Club",type:"claim",player:"Razork",time:new Date(Date.now()-4*3600000).toISOString()}
    ];

    const drawTransactions=()=>{
      const claims=getWaiverClaims();
      const history=getTransactionHistory();
      count.textContent=claims.length;
      if(tab==="pending"){
        content.innerHTML=claims.length?claims.map((c,i)=>`<div class="transaction-item">
          <span class="transaction-icon claim">W</span>
          <div class="transaction-info"><strong>#${i+1} ${c.player}<span class="status-pill pending">PENDING</span></strong><small>${c.team} · ${c.role} · Your claim order #${i+1}</small><div class="claim-actions"><button class="claim-btn" data-move-up="${c.id}" ${i===0?"disabled":""}>Move up</button><button class="claim-btn cancel" data-cancel-claim="${c.id}">Cancel</button></div></div>
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
          <div class="transaction-info"><strong>${t.type==="add"?"Added":"Dropped"} ${t.player}<span class="status-pill success">COMPLETE</span></strong><small>${t.team} · ${t.role}${t.pairedWith?" · paired with "+t.pairedWith:""}</small></div>
          <span class="transaction-time">${formatTime(t.time)}</span>
        </div>`).join(""):'<div class="empty-state"><strong>No transaction history yet</strong><small>Your completed adds and drops will appear here automatically.</small></div>';
      }else{
        content.innerHTML=demoActivity.map(t=>`<div class="transaction-item">
          <span class="transaction-icon ${t.type==="drop"?"drop":t.type==="claim"?"claim":""}">${t.type==="add"?"+":t.type==="drop"?"−":"W"}</span>
          <div class="transaction-info"><strong><span class="activity-manager">${t.manager}</span> ${t.type==="add"?"added":t.type==="drop"?"dropped":"claimed"} ${t.player}</strong><small>League activity · prototype feed</small></div>
          <span class="transaction-time">${formatTime(t.time)}</span>
        </div>`).join("");
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
    document.querySelector("#standings").innerHTML=standings.map(s=>`<div class="standing-row"><span class="rank">${s[0]}</span><strong>${s[1]}</strong><span>${s[2]}</span><span class="pts">${s[3]}</span></div>`).join("");
    const rankings=(window.ESPORTS_DATA&&window.ESPORTS_DATA.rankings)||[];
    const power=document.querySelector("#powerRankings");
    if(power) power.innerHTML=rankings.map(t=>`<div class="power-row"><span class="power-rank">#${t.rank}</span><div class="power-team"><strong>${t.code}</strong><small>${t.name} · ${t.league}</small></div><span class="power-score">${t.score}</span><span class="power-record">${t.record}</span></div>`).join("");
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
        board.innerHTML=recent.length?recent.map(p=>`<div class="draft-pick ${p.managerIndex===state.userIndex?"mine":""}"><small>#${p.pick} · R${p.round}</small><strong>${p.name}</strong><span>${p.role} · ${p.manager}</span></div>`).join(""):'<div class="muted">No picks yet.</div>';
      }

      const boardState=state||{managerCount:Number(getLeagueSettings().managers)||8,picks:[],pickIndex:0,userIndex:1,started:false,complete:false};
      const settings=getLeagueSettings();
      const totalRounds=5+Number(settings.bench||3);
      const cols=boardState.managerCount;
      const headers=Array.from({length:cols},(_,i)=>`<div class="board-head">${draftManagerNames[i]||("Manager "+(i+1))}</div>`).join("");
      let cells="";
      for(let r=0;r<totalRounds;r++){
        for(let c=0;c<cols;c++){
          const managerIndex=r%2===0?c:cols-1-c;
          const overall=r*cols+c;
          const pick=(boardState.picks||[]).find(p=>p.pick===overall+1);
          const onClock=boardState.started&&!boardState.complete&&overall===boardState.pickIndex;
          cells+=`<div class="board-cell ${managerIndex===boardState.userIndex?"mine":""} ${onClock?"on-clock":""}">
            <small>R${r+1} · #${overall+1}</small>
            <strong>${pick?pick.name:"—"}</strong>
            <span>${pick?pick.role:(draftManagerNames[managerIndex]||"")}</span>
          </div>`;
        }
      }
      fullBoard.innerHTML=`<div class="full-board-grid" style="grid-template-columns:repeat(${cols},minmax(92px,1fr))">${headers}${cells}</div>`;

      const taken=new Set((state?.picks||[]).map(p=>p.playerId));
      const q=search.value.trim().toLowerCase();
      const isUserTurn=state&&state.started&&!state.complete&&draftOrderForPick(state.pickIndex,state.managerCount)===state.userIndex;
      const filtered=draftPool.filter(p=>!taken.has(p.id)&&(role==="ALL"||p.role===role)&&(`${p.name} ${p.team} ${p.role}`.toLowerCase().includes(q)));
      list.innerHTML=filtered.map(p=>`<div class="player-row draft-player"><span class="role-badge">${p.role}</span><div class="player-info"><strong>#${p.rank} ${p.name}${p.verified?'<span class="data-chip">ROSTER VERIFIED</span>':""}</strong><small>${p.team}</small></div><span class="fp">${p.fp.toFixed(1)}</span><button class="draft-btn" data-player-id="${p.id}" ${isUserTurn?"":"disabled"}>DRAFT</button></div>`).join("")||'<div class="card muted">No available players match this filter.</div>';
      list.querySelectorAll("[data-player-id]").forEach(btn=>btn.onclick=()=>{
        state=getDraftState();
        if(!state||state.complete||draftOrderForPick(state.pickIndex,state.managerCount)!==state.userIndex)return;
        const player=draftPool.find(p=>p.id===btn.dataset.playerId);
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
      rosterEl.innerHTML=slotPlayers.map(x=>`<div class="draft-roster-slot ${x.p?(x.starter?"filled-start":"filled-bench"):""}"><small>${x.slot}</small><strong class="${x.p?"":"empty-slot"}">${x.p?x.p.name:"Empty"}</strong></div>`).join("");
    };

    document.querySelector("#startDraftBtn").onclick=()=>{
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
    document.querySelector("#managerCount").value=settings.managers;
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
      const draftType=document.querySelector('[data-choice-group="draftType"] .choice.active').dataset.value;
      const scoringFormat=document.querySelector('[data-choice-group="scoringFormat"] .choice.active').dataset.value;
      const next={
        name:document.querySelector("#leagueName").value.trim()||"Summoner's Cup",
        managers:document.querySelector("#managerCount").value,
        bench:document.querySelector("#benchCount").value,
        draftType,
        scoringFormat,
        competition:document.querySelector("#competition").value,
        teamSlot:document.querySelector("#teamSlot").checked,
        scoring:{
          kills:Number(document.querySelector("#scoreKills").value),
          deaths:Number(document.querySelector("#scoreDeaths").value),
          assists:Number(document.querySelector("#scoreAssists").value),
          cs:Number(document.querySelector("#scoreCs").value),
          win:Number(document.querySelector("#scoreWin").value),
          firstBlood:Number(document.querySelector("#scoreFb").value)
        }
      };
      localStorage.setItem("riftLeagueSettings",JSON.stringify(next));
      showToast("League settings saved");
      setTimeout(()=>render("league"),550);
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
document.querySelector("#notificationBtn").onclick=()=>showToast("No new league notifications.");
render("home");