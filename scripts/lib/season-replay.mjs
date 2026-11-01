export function runHistoricalSeasonReplay(data,{mode="synchronized",replacement=false}={}){
  const requiredRoles=["TOP","JNG","MID","ADC","SUP"];
  const fail=message=>{throw new Error("Historical replay: "+message);};
  if(!["synchronized","calendar"].includes(mode))fail("Invalid replay mode");
  if(!data||!Array.isArray(data.players)||!Array.isArray(data.matches)||!Array.isArray(data.games))fail("Missing archived data");
  if(data.players.length!==25||data.matches.length!==33)fail("Unexpected historical fixture size");
  const teams=new Set(data.players.filter(p=>p.manager).map(p=>p.teamId));
  if(teams.size<4)fail("Fantasy player pool is not cross-team");
  const members=[1,2,3,4];
  for(const id of members){
    const roster=data.players.filter(p=>p.manager===id);
    if(roster.length!==5||requiredRoles.some(role=>roster.filter(p=>p.role===role).length!==1))fail("Manager "+id+" has incomplete five-role roster");
    if(new Set(roster.map(p=>p.teamId)).size<3)fail("Roster "+id+" lacks cross-team representation");
  }
  const freeAgents=data.players.filter(p=>p.manager===null);
  if(freeAgents.length!==5||requiredRoles.some(role=>!freeAgents.some(p=>p.role===role)))fail("Missing replacement free agents");
  const rules=data.scoring;
  const gamesBySeries=new Map();
  const matchLookup=new Map(data.matches.map(m=>[m.id,m]));
  for(const g of data.games){
    if(!matchLookup.has(g.matchId))fail("Game not linked to archived match");
    if(!data.players.some(p=>p.id===g.playerId))fail("Unknown player in archived game");
    for(const k of ["kills","deaths","assists","cs"])if(!Number.isFinite(g[k]))fail("Missing finalized stat "+k);
    if(typeof g.win!=="boolean"||typeof g.firstBlood!=="boolean")fail("Missing verified win/first blood");
    const key=g.playerId+"|"+g.matchId;
    const points=g.kills*rules.kills+g.deaths*rules.deaths+g.assists*rules.assists+g.cs*rules.cs+
      Number(g.win)*rules.win+Number(g.firstBlood)*rules.firstBlood;
    const arr=gamesBySeries.get(key)||[];
    if(arr.some(game=>game.id===g.id))fail("Duplicate game/player combination");
    arr.push({id:g.id,points});
    gamesBySeries.set(key,arr);
  }
  const playerSeries=new Map();
  for(const p of data.players){
    const series=data.matches.filter(m=>m.teamAId===p.teamId||m.teamBId===p.teamId)
      .sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||String(a.id).localeCompare(String(b.id)))
      .map(m=>{
        const games=gamesBySeries.get(p.id+"|"+m.id)||[];
        if(!games.length)fail("No finalized game statistics for "+p.name+" at match "+m.id);
        return {matchId:m.id,round:m.round,playedAt:m.start,games:games.length,
          points:Math.round(1000*games.reduce((sum,g)=>sum+g.points,0)/games.length)/1000};
      });
    if(series.length!==5)fail(p.name+" did not play five recorded series");
    playerSeries.set(p.id,series);
  }
  const original=data.players.filter(p=>p.manager===1&&p.role==="TOP")[0];
  const substitute=freeAgents.find(p=>p.role==="TOP");
  const replaceAtRound=4;
  const selectedIds=new Set(data.players.filter(p=>p.manager).map(p=>p.id));
  if(selectedIds.has(substitute.id)||substitute.role!==original.role)fail("Replacement breaks ownership or role restrictions");
  function getRoster(manager,round){
    return data.players.filter(p=>p.manager===manager).map(p=>
      replacement&&manager===1&&round>=replaceAtRound&&p.id===original.id?substitute:p);
  }
  const records={};
  for(let round=1;round<=5;round++){
    const participants={};
    for(const manager of members){
      const players=getRoster(manager,round).map(p=>{
        const choices=mode==="synchronized"
          ?[playerSeries.get(p.id)[round-1]]
          :playerSeries.get(p.id).filter(s=>s.round===round);
        const chosen=choices.slice().sort((a,b)=>b.points-a.points)[0]||null;
        return {player:p.name,role:p.role,team:p.team,points:chosen?.points??null,matchId:chosen?.matchId??null,
          eligibleSeries:choices.length,source:"archived finalized games"};
      });
      const missing=players.filter(p=>p.points===null).map(p=>p.role+": "+p.player);
      participants[manager]={manager,players,missing,points:Math.round(players.reduce((n,p)=>n+(p.points||0),0)*100)/100};
    }
    records[round]={round,participants,ready:members.every(id=>participants[id].missing.length===0)};
  }
  const regularPairings={1:[[1,4],[2,3]],2:[[1,3],[4,2]],3:[[1,2],[3,4]]};
  const standing=Object.fromEntries(members.map(manager=>[manager,{manager,wins:0,losses:0,ties:0,pf:0,pa:0}]));
  const regularGames=[];
  for(let round=1;round<=3;round++){
    for(const [a,b] of regularPairings[round]){
      const sa=records[round].participants[a].points,sb=records[round].participants[b].points;
      const ready=records[round].participants[a].missing.length===0&&records[round].participants[b].missing.length===0;
      regularGames.push({round,home:a,away:b,homeScore:sa,awayScore:sb,
        result:!ready?"blocked":sa>sb?"home_win":sb>sa?"away_win":"tie"});
      if(!ready)continue;
      standing[a].pf+=sa;standing[a].pa+=sb;standing[b].pf+=sb;standing[b].pa+=sa;
      if(sa===sb){standing[a].ties++;standing[b].ties++;}
      else {standing[sa>sb?a:b].wins++;standing[sa>sb?b:a].losses++;}
    }
  }
  const standings=Object.values(standing).sort((a,b)=>b.wins-a.wins||b.ties-a.ties||b.pf-a.pf||a.manager-b.manager)
    .map((s,i)=>({...s,seed:i+1,pf:Math.round(s.pf*100)/100,pa:Math.round(s.pa*100)/100}));
  const calendarBlockers=[];
  for(let round=1;round<=5;round++)if(!records[round].ready)
    calendarBlockers.push({round,missing:members.flatMap(manager=>records[round].participants[manager].missing.map(x=>"Manager "+manager+" "+x))});
  const playoffs=[];
  let champion=null;
  const ready=calendarBlockers.length===0;
  if(ready){
    const semis=[[standings[0],standings[3]],[standings[1],standings[2]]];
    for(const [a,b] of semis){
      const sa=records[4].participants[a.manager].points,sb=records[4].participants[b.manager].points;
      const winner=sa>=sb?a:b;
      playoffs.push({stage:"semifinal",round:4,home:a.manager,away:b.manager,
        homeScore:sa,awayScore:sb,winner:winner.manager,eliminated:winner.manager===a.manager?b.manager:a.manager,
        tiebreaker:sa===sb?"higher seed":null});
    }
    const finalists=playoffs.map(p=>standings.find(s=>s.manager===p.winner));
    const [a,b]=finalists;
    const sa=records[5].participants[a.manager].points,sb=records[5].participants[b.manager].points;
    const winner=sa>sb?a:sb>sa?b:(a.seed<b.seed?a:b);
    champion=winner.manager;
    playoffs.push({stage:"championship",round:5,home:a.manager,away:b.manager,
      homeScore:sa,awayScore:sb,winner:champion,eliminated:champion===a.manager?b.manager:a.manager,
      tiebreaker:sa===sb?"higher seed":null});
  }
  const roundSummary=Object.values(records).map(r=>({
    round:r.round,ready:r.ready,managerScores:members.map(id=>({manager:id,
      points:r.participants[id].points,active:r.participants[id].players.filter(p=>p.points!==null).length}))
  }));
  return {
    mode,official:false,historicalSource:data.source,competition:data.competition,
    simulatedSeason:"3 regular fantasy rounds, 2 fantasy playoff rounds",
    note:mode==="synchronized"
      ?"Counterfactual scheduling: each professional team's nth played series is mapped to fantasy round n. This DOES NOT represent actual simultaneous calendar windows."
      :"Actual archived dates grouped into two-day windows. Incomplete fantasy rosters block scoring and championship finalization.",
    draftedManagers:4,rosterSize:5,professionalTeams:teams.size,freeAgents:freeAgents.length,
    archivedMatches:data.matches.length,archivedPlayerGameRecords:data.games.length,
    rounds:roundSummary,regularGames,standings,playoffs,champion,
    blocked:!ready,calendarBlockers,
    replacement:replacement?{synthetic:true,confirmedInHistoricalData:false,afterRound:3,
      manager:1,outgoing:original.name,incoming:substitute.name,role:original.role,
      sameRole:original.role===substitute.role,
      pastRoundsUnchanged:true}:null
  };
}
