const roster = [
  {role:"TOP",name:"Bin",team:"Bilibili Gaming",opp:"vs T1",fp:24.8},
  {role:"JNG",name:"Canyon",team:"Gen.G",opp:"vs HLE",fp:31.2},
  {role:"MID",name:"Chovy",team:"Gen.G",opp:"vs HLE",fp:36.7},
  {role:"ADC",name:"Gumayusi",team:"T1",opp:"vs BLG",fp:29.5},
  {role:"SUP",name:"Keria",team:"T1",opp:"vs BLG",fp:18.4},
  {role:"BN",name:"Caps",team:"G2 Esports",opp:"vs FNC",fp:27.9},
  {role:"BN",name:"Inspired",team:"FlyQuest",opp:"vs TL",fp:25.1},
  {role:"BN",name:"Massu",team:"FlyQuest",opp:"vs TL",fp:24.3}
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



const proSchedule = [
  {day:"today",label:"TODAY · OCT 4",time:"6:00 PM",league:"LCK",a:"Gen.G",aCode:"GEN",b:"Hanwha Life",bCode:"HLE",status:"UPCOMING"},
  {day:"today",label:"TODAY · OCT 4",time:"8:30 PM",league:"LPL",a:"Bilibili Gaming",aCode:"BLG",b:"Top Esports",bCode:"TES",status:"UPCOMING"},
  {day:"tomorrow",label:"TOMORROW · OCT 5",time:"5:00 PM",league:"LEC",a:"G2 Esports",aCode:"G2",b:"Fnatic",bCode:"FNC",status:"UPCOMING"},
  {day:"tomorrow",label:"TOMORROW · OCT 5",time:"7:30 PM",league:"LTA",a:"FlyQuest",aCode:"FLY",b:"Team Liquid",bCode:"TL",status:"UPCOMING"},
  {day:"upcoming",label:"OCT 6",time:"6:00 PM",league:"International",a:"T1",aCode:"T1",b:"Bilibili Gaming",bCode:"BLG",status:"UPCOMING"},
  {day:"upcoming",label:"OCT 7",time:"6:00 PM",league:"International",a:"Gen.G",aCode:"GEN",b:"G2 Esports",bCode:"G2",status:"UPCOMING"}
];


const draftPool = [
  {id:"chovy",role:"MID",name:"Chovy",team:"Gen.G",rank:1,fp:36.7},
  {id:"bin",role:"TOP",name:"Bin",team:"Bilibili Gaming",rank:2,fp:24.8},
  {id:"canyon",role:"JNG",name:"Canyon",team:"Gen.G",rank:3,fp:31.2},
  {id:"viper",role:"ADC",name:"Viper",team:"Hanwha Life",rank:4,fp:32.4},
  {id:"keria",role:"SUP",name:"Keria",team:"T1",rank:5,fp:22.8},
  {id:"faker",role:"MID",name:"Faker",team:"T1",rank:6,fp:28.6},
  {id:"zeus",role:"TOP",name:"Zeus",team:"Hanwha Life",rank:7,fp:25.7},
  {id:"oner",role:"JNG",name:"Oner",team:"T1",rank:8,fp:27.4},
  {id:"gumayusi",role:"ADC",name:"Gumayusi",team:"T1",rank:9,fp:29.5},
  {id:"delight",role:"SUP",name:"Delight",team:"Hanwha Life",rank:10,fp:20.8},
  {id:"caps",role:"MID",name:"Caps",team:"G2 Esports",rank:11,fp:27.9},
  {id:"369",role:"TOP",name:"369",team:"Top Esports",rank:12,fp:23.1},
  {id:"kanavi",role:"JNG",name:"Kanavi",team:"JD Gaming",rank:13,fp:26.8},
  {id:"ruler",role:"ADC",name:"Ruler",team:"Gen.G",rank:14,fp:30.1},
  {id:"lehends",role:"SUP",name:"Lehends",team:"Nongshim",rank:15,fp:18.9},
  {id:"humanoid",role:"MID",name:"Humanoid",team:"Fnatic",rank:16,fp:22.5},
  {id:"brokenblade",role:"TOP",name:"BrokenBlade",team:"G2 Esports",rank:17,fp:22.1},
  {id:"inspired",role:"JNG",name:"Inspired",team:"FlyQuest",rank:18,fp:25.1},
  {id:"hanssama",role:"ADC",name:"Hans Sama",team:"G2 Esports",rank:19,fp:24.6},
  {id:"mikyx",role:"SUP",name:"Mikyx",team:"G2 Esports",rank:20,fp:17.8},
  {id:"zeka",role:"MID",name:"Zeka",team:"Hanwha Life",rank:21,fp:26.2},
  {id:"kiin",role:"TOP",name:"Kiin",team:"Gen.G",rank:22,fp:23.9},
  {id:"peanut",role:"JNG",name:"Peanut",team:"Hanwha Life",rank:23,fp:24.2},
  {id:"massu",role:"ADC",name:"Massu",team:"FlyQuest",rank:24,fp:24.3},
  {id:"corejj",role:"SUP",name:"CoreJJ",team:"Team Liquid",rank:25,fp:18.1},
  {id:"apa",role:"MID",name:"APA",team:"Team Liquid",rank:26,fp:21.9},
  {id:"impact",role:"TOP",name:"Impact",team:"Team Liquid",rank:27,fp:20.7},
  {id:"razork",role:"JNG",name:"Razork",team:"Fnatic",rank:28,fp:23.7},
  {id:"noah",role:"ADC",name:"Noah",team:"Fnatic",rank:29,fp:22.9},
  {id:"jun",role:"SUP",name:"Jun",team:"Fnatic",rank:30,fp:17.2},
  {id:"knight",role:"MID",name:"Knight",team:"Bilibili Gaming",rank:31,fp:30.7},
  {id:"369b",role:"TOP",name:"Doran",team:"T1",rank:32,fp:21.8},
  {id:"xun",role:"JNG",name:"Xun",team:"Bilibili Gaming",rank:33,fp:24.5},
  {id:"elk",role:"ADC",name:"Elk",team:"Bilibili Gaming",rank:34,fp:28.2},
  {id:"on",role:"SUP",name:"ON",team:"Bilibili Gaming",rank:35,fp:19.4},
  {id:"quad",role:"MID",name:"Quad",team:"FlyQuest",rank:36,fp:23.3},
  {id:"bwipo",role:"TOP",name:"Bwipo",team:"FlyQuest",rank:37,fp:20.9},
  {id:"umti",role:"JNG",name:"UmTi",team:"Team Liquid",rank:38,fp:21.7},
  {id:"yeon",role:"ADC",name:"Yeon",team:"Team Liquid",rank:39,fp:23.8},
  {id:"busio",role:"SUP",name:"Busio",team:"FlyQuest",rank:40,fp:17.7}
];

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

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

function showToast(message){
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(()=>toast.classList.remove("show"),1800);
}

function playerRow(p, add=false){
  return `<div class="player-row">
    <span class="role-badge">${p.role}</span>
    <div class="player-info"><strong>${p.name}</strong><small>${p.team} · ${p.opp || p.trend || ""}</small></div>
    <span class="fp">${p.fp.toFixed(1)}</span>
    ${add ? '<button class="add-btn">ADD</button>' : ""}
  </div>`;
}

function rosterRow(p){
  return `<div class="roster-slot ${p.role==="BN"?"bench":""}">
    <span class="slot-label">${p.role}</span>
    <div class="player-info"><strong>${p.name}</strong><small>${p.team} · ${p.opp}</small></div>
    <span class="fp">${p.fp.toFixed(1)}</span>
  </div>`;
}

function render(view="home"){
  const template = document.querySelector(`#${view}-template`);
  app.innerHTML = "";
  app.appendChild(template.content.cloneNode(true));
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));

  if(view==="home"){
    document.querySelector("#starterPreview").innerHTML = roster.slice(0,3).map(p=>playerRow(p)).join("");
    document.querySelector("#draftBtn").onclick=()=>render("draft");
  }
  if(view==="team"){
    document.querySelector("#rosterList").innerHTML = roster.map(rosterRow).join("");
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
      list.innerHTML=filtered.map(g=>{
        const heading=g.label!==lastLabel ? `<div class="schedule-day">${g.label}</div>` : "";
        lastLabel=g.label;
        return heading+`<div class="game-card">
          <div class="game-team"><span class="team-mark">${g.aCode}</span><div><strong>${g.a}</strong><small>Team 1</small></div></div>
          <div class="game-meta"><span class="game-time">${g.time}</span><span class="game-league">${g.league}</span><span class="game-status">${g.status}</span></div>
          <div class="game-team right"><div><strong>${g.b}</strong><small>Team 2</small></div><span class="team-mark">${g.bCode}</span></div>
        </div>`;
      }).join("");
    };
    document.querySelectorAll("[data-day]").forEach(c=>c.onclick=()=>{day=c.dataset.day;document.querySelectorAll("[data-day]").forEach(x=>x.classList.remove("active"));c.classList.add("active");drawSchedule();});
    drawSchedule();
  }
  if(view==="players"){
    const list=document.querySelector("#freeAgentList");
    const search=document.querySelector("#playerSearch");
    let role="ALL";
    const draw=()=>{
      const q=search.value.trim().toLowerCase();
      const filtered=freeAgents.filter(p=>(role==="ALL"||p.role===role)&&(`${p.name} ${p.team} ${p.role}`.toLowerCase().includes(q)));
      list.innerHTML=filtered.map(p=>playerRow(p,true)).join("") || '<div class="card muted">No players found.</div>';
      list.querySelectorAll(".add-btn").forEach((b,i)=>b.onclick=()=>showToast(`${filtered[i].name} added to waiver queue`));
    };
    search.oninput=draw;
    document.querySelectorAll(".chip").forEach(c=>c.onclick=()=>{role=c.dataset.role;document.querySelectorAll(".chip").forEach(x=>x.classList.remove("active"));c.classList.add("active");draw();});
    draw();
  }
  if(view==="league"){
    const settings=getLeagueSettings();
    document.querySelector("#standings").innerHTML=standings.map(s=>`<div class="standing-row"><span class="rank">${s[0]}</span><strong>${s[1]}</strong><span>${s[2]}</span><span class="pts">${s[3]}</span></div>`).join("");
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
      list.innerHTML=filtered.map(p=>`<div class="player-row draft-player"><span class="role-badge">${p.role}</span><div class="player-info"><strong>#${p.rank} ${p.name}</strong><small>${p.team}</small></div><span class="fp">${p.fp.toFixed(1)}</span><button class="draft-btn" data-player-id="${p.id}" ${isUserTurn?"":"disabled"}>DRAFT</button></div>`).join("")||'<div class="card muted">No available players match this filter.</div>';
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
      state=newDraftState();
      saveDraftState(state);
      runCpuPicks(state);
      drawDraft();
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
  document.querySelectorAll("[data-jump]").forEach(b=>b.onclick=()=>render(b.dataset.jump));
}

document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>render(b.dataset.view)));
document.querySelector("#notificationBtn").onclick=()=>showToast("No new league notifications.");
render("home");