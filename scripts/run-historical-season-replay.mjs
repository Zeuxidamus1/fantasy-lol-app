import fs from "node:fs/promises";
import {runHistoricalSeasonReplay} from "./lib/season-replay.mjs";

const input=JSON.parse(await fs.readFile(new URL("./fixtures/worlds-2026-swiss-replay.json",import.meta.url),"utf8"));
const calendar=runHistoricalSeasonReplay(input,{mode:"calendar"});
const synchronized=runHistoricalSeasonReplay(input,{mode:"synchronized"});
const emergencyReplacement=runHistoricalSeasonReplay(input,{mode:"synchronized",replacement:true});
const report={generatedFrom:"Committed historical fixture",archivedCompetition:input.competition,
  officialResult:false,reason:"Retrospective fantasy stress test; the series-aligned schedule is counterfactual",
  calendar,synchronized,emergencyReplacement};
if(process.argv.includes("--write")){
  const dest=new URL("./reports/season-history-replay.json",import.meta.url);
  await fs.mkdir(new URL("./reports/",import.meta.url),{recursive:true});
  await fs.writeFile(dest,JSON.stringify(report,null,2)+"\n");
  console.log("Wrote scripts/reports/season-history-replay.json");
}else{
  console.log("Archived competition:",input.competition);
  console.log("Calendar fairness:",calendar.blocked?"BLOCKED":"PASS",JSON.stringify(calendar.calendarBlockers.map(b=>({round:b.round,missing:b.missing.length}))));
  console.log("Counterfactual synchronized replay:",synchronized.blocked?"BLOCKED":"COMPLETE");
  console.log("Standings:",synchronized.standings.map(s=>"Manager "+s.manager+" "+s.wins+"-"+s.losses+" ("+s.pf+" PF)").join(" | "));
  console.log("Playoffs:",synchronized.playoffs.map(p=>p.stage+": "+p.home+" vs "+p.away+", winner "+p.winner).join(" | "));
  console.log("Counterfactual champion: Manager",synchronized.champion);
  console.log("Hypothetical emergency replacement:",emergencyReplacement.replacement.outgoing,"→",emergencyReplacement.replacement.incoming);
  console.log("Historical outcomes are not official regional season results.");
}
