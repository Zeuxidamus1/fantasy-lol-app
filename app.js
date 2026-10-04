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
    document.querySelector("#draftBtn").onclick=()=>showToast("Mock Draft screen is next on the roadmap.");
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