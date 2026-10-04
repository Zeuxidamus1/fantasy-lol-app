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
    document.querySelector("#standings").innerHTML=standings.map(s=>`<div class="standing-row"><span class="rank">${s[0]}</span><strong>${s[1]}</strong><span>${s[2]}</span><span class="pts">${s[3]}</span></div>`).join("");
    document.querySelector("#rulesBtn").onclick=()=>showToast("Scoring: K +3 · D -1 · A +2 · CS +0.02 · Win +5");
  }
  document.querySelectorAll("[data-jump]").forEach(b=>b.onclick=()=>render(b.dataset.jump));
}

document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>render(b.dataset.view)));
document.querySelector("#notificationBtn").onclick=()=>showToast("No new league notifications.");
render("home");