"use strict";
const H=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const byId=id=>document.getElementById(id);
const fmt=n=>Number.isFinite(Number(n))?Number(n).toFixed(2):"—";
const fetchJSON=async path=>{
  const response=await fetch(path,{cache:"no-store"});
  if(!response.ok)throw new Error("Data not available: "+path+" ("+response.status+")");
  return response.json();
};
(async()=>{
  try{
    const [report,data]=await Promise.all([
      fetchJSON("./scripts/reports/season-history-replay.json"),
      fetchJSON("./scripts/fixtures/worlds-2026-swiss-replay.json")
    ]);
    const labels={calendar:"Actual calendar",standard:"Default top-two final",synchronized:"Optional four-team playoff stress test",emergencyReplacement:"Hypothetical emergency replacement"};
    const show=mode=>{
      const result=report[mode];
      if(!result)return;
      document.querySelectorAll("[data-mode]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.mode===mode)));
      const state=result.blocked
        ?'<strong class="warn">BLOCKED · No champion declared</strong> — '+H(result.calendarBlockers.map(x=>"Round "+x.round+": "+x.missing.length+" fantasy starters without an eligible series").join(" · "))
        :'<strong>REPLAY COMPLETED</strong> — the first three fantasy rounds determine standings; semifinal and championship defeats eliminate the losing fantasy managers.';
      const caution=mode==="calendar"
        ?"Actual archived match dates were grouped into two-day windows. Insufficient participation correctly prevented a final result."
        :"Professional teams' first through fifth series were aligned retrospectively across fantasy rounds. This was a constructed test schedule, not a real contemporaneous schedule.";
      const replacement=result.replacement
        ?'<p><span class="warn">HYPOTHETICAL EVENT:</span> Manager 1 replaces '+H(result.replacement.outgoing)+" with "+H(result.replacement.incoming)+" after Round 3. Historical elimination status was not asserted. Earlier scores remain unchanged.</p>"
        :"";
      byId("summary").innerHTML=state+"<p class='sub'>"+H(caution)+"</p>"+replacement;
      byId("stats").innerHTML=[
        ["Fantasy managers",result.draftedManagers],
        ["Drafted players",result.draftedManagers*result.rosterSize],
        ["Archived game records",result.archivedPlayerGameRecords],
        ["Fantasy champion",result.champion===null?"Not awarded":"Manager "+result.champion]
      ].map(([name,value])=>'<div class="stat"><span>'+H(name)+'</span><strong>'+H(value)+'</strong></div>').join("");
      byId("standings").innerHTML=result.standings.map(s=>'<div class="item"><div><strong>#'+H(s.seed)+' · Manager '+H(s.manager)+'</strong><small>'+H(s.wins)+' W · '+H(s.losses)+' L · '+H(s.ties)+' T</small></div><strong class="score">'+fmt(s.pf)+' PF</strong></div>').join("");
      byId("bracket").innerHTML=result.playoffs.length
        ?result.playoffs.map(x=>'<div class="item"><div><strong>'+H(x.stage==="championship"?"Championship":"Semifinal")+'</strong><small>Manager '+H(x.home)+" vs Manager "+H(x.away)+'</small></div><div><strong class="score">'+fmt(x.homeScore)+" – "+fmt(x.awayScore)+'</strong><small class="winner">Winner: Manager '+H(x.winner)+'</small></div></div>').join("")
        :'<div class="alert">No championship or elimination results were awarded. The underlying schedule is not sufficiently balanced.</div>';
      byId("rounds").innerHTML=result.rounds.map(r=>
        '<div class="round-tile"><h3>Round '+H(r.round)+' <small class="'+(r.ready?'good':'warn')+'">'+(r.ready?'Ready':'Missing games')+'</small></h3>'+
        r.managerScores.map(m=>'<div class="round-line"><span>Manager '+H(m.manager)+' <small>('+H(m.active)+'/5 active)</small></span><strong class="score">'+fmt(m.points)+'</strong></div>').join("")+
        '</div>').join("");
      byId("rosters").innerHTML=[1,2,3,4].map(manager=>{
        const players=data.players.filter(p=>p.manager===manager);
        return '<div class="card"><h3>Manager '+manager+'</h3>'+players.map(p=>
          '<div class="roster-player"><span class="role">'+H(p.role)+'</span><div><strong>'+H(p.name)+'</strong><small>'+H(p.team)+'</small></div></div>').join("")+
          (mode==="emergencyReplacement"&&manager===1?'<div class="alert">After Round 3, hypothetical TOP replacement: Zeus → Canna.</div>':"")+
          '</div>';
      }).join("");
    };
    document.querySelectorAll("[data-mode]").forEach(b=>b.addEventListener("click",()=>show(b.dataset.mode)));
    show("standard");
  }catch(error){
    byId("summary").textContent="Replay could not load: "+String(error.message||error);
  }
})();
