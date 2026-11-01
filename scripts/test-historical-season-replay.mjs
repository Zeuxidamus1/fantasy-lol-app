import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {runHistoricalSeasonReplay} from "./lib/season-replay.mjs";
import vm from "node:vm";

const fixture=JSON.parse(await fs.readFile(new URL("./fixtures/worlds-2026-swiss-replay.json",import.meta.url),"utf8"));
assert.equal(fixture.competition,"Worlds 2026 Swiss");
assert.equal(fixture.players.length,25);
assert.equal(fixture.matches.length,33);
assert.equal(fixture.games.length,205);
for(const manager of [1,2,3,4]){
  const roster=fixture.players.filter(p=>p.manager===manager);
  assert.equal(roster.length,5,"exactly five starting fantasy players");
  assert.deepEqual(roster.map(p=>p.role).sort(),["ADC","JNG","MID","SUP","TOP"],"all roles present");
  assert.ok(new Set(roster.map(p=>p.teamId)).size>=3,"independent professional organizations");
}
assert.equal(fixture.players.filter(p=>p.manager===null).length,5,"unowned replacement pool");

const actualApp=await fs.readFile(new URL("../app.js",import.meta.url),"utf8");
const plannerStart=actualApp.indexOf("function planAdaptiveSeasonRounds(");
const plannerEnd=actualApp.indexOf('\n  if(view==="create-league")',plannerStart);
assert.ok(plannerStart>=0&&plannerEnd>plannerStart,"Rift app planner must be available");
const sandbox={Date,Set,Map,Array,Number,String,Math};
vm.createContext(sandbox);
vm.runInContext(actualApp.slice(plannerStart,plannerEnd)+"\nthis.plan=planAdaptiveSeasonRounds;",sandbox,{timeout:3000});
const planned=sandbox.plan(fixture.matches.map(m=>({
 id:m.id,start_time:m.start,status:"COMPLETED",stage:"Swiss",
 team_a_id:m.teamAId,team_b_id:m.teamBId
})),Date.parse("2026-11-01T16:00:00Z"));
assert.equal(planned.length,2,"Actual app planner must not manufacture five fair rounds from this schedule");
assert.ok(planned.every(p=>p.warnings.includes("Unequal series counts between teams")),
 "Actual app planner must flag unbalanced team coverage");
for(let i=1;i<planned.length;i++)
 assert.ok(Date.parse(planned[i-1].endsAt)<=Date.parse(planned[i].startsAt),
 "Adaptive fantasy periods must not overlap");

const realCalendar=runHistoricalSeasonReplay(fixture,{mode:"calendar"});
assert.equal(realCalendar.blocked,true,"incomplete calendar windows cannot finalize");
assert.equal(realCalendar.champion,null,"no fake champion from missing schedules");
assert.deepEqual(realCalendar.calendarBlockers.map(r=>r.round),[3,4]);
assert.equal(realCalendar.calendarBlockers[0].missing.length,10);

const controlled=runHistoricalSeasonReplay(fixture,{mode:"synchronized"});
assert.equal(controlled.blocked,false);
assert.equal(controlled.rounds.length,5);
assert.ok(controlled.rounds.every(r=>r.ready && r.managerScores.every(s=>s.active===5)));
assert.equal(controlled.regularGames.length,6);
assert.deepEqual(controlled.standings.map(s=>s.manager),[3,4,1,2],"standings ranked by archived stats");
assert.deepEqual(controlled.standings.map(s=>s.wins),[3,2,1,0]);
assert.deepEqual(controlled.playoffs.map(p=>p.stage),["semifinal","semifinal","championship"]);
assert.equal(new Set(controlled.playoffs.map(p=>p.eliminated)).size,3,"losing playoff teams eliminated");
assert.equal(controlled.champion,1,"championship won using archived game stats");

const replaced=runHistoricalSeasonReplay(fixture,{mode:"synchronized",replacement:true});
assert.equal(replaced.replacement.synthetic,true,"replacement scenario is explicitly hypothetical");
assert.equal(replaced.replacement.sameRole,true);
assert.equal(replaced.replacement.confirmedInHistoricalData,false);
assert.equal(replaced.rounds.slice(0,3).map(r=>r.managerScores[0].points).join(","),
             controlled.rounds.slice(0,3).map(r=>r.managerScores[0].points).join(","),
             "locked historical rounds must never change after a replacement");
assert.notEqual(replaced.rounds[3].managerScores[0].points,
                controlled.rounds[3].managerScores[0].points,
                "replacement must take effect in future rounds");

const bad=structuredClone(fixture);
bad.games[0].kills=null;
assert.throws(()=>runHistoricalSeasonReplay(bad),/Missing finalized stat/,"missing official stats must fail closed");
const duplicate=structuredClone(fixture);
duplicate.games.push(structuredClone(duplicate.games[0]));
assert.throws(()=>runHistoricalSeasonReplay(duplicate),/Duplicate game/,"duplicate statistics must fail closed");
const tied=structuredClone(fixture);
for(const game of tied.games){
  game.kills=0;game.deaths=0;game.assists=0;game.cs=0;game.win=false;game.firstBlood=false;
}
const tieReplay=runHistoricalSeasonReplay(tied,{mode:"synchronized"});
assert.ok(tieReplay.playoffs.every(p=>p.tiebreaker==="higher seed"),"seed breaks playoff ties");
assert.equal(tieReplay.champion,1);

console.log("PASS: 4 managers, 20 drafted players, five cross-team roles");
console.log("PASS: 205 archived player-game records, five replay rounds");
console.log("PASS: actual app adaptive planner flags unfair rounds and never overlaps periods");
console.log("PASS: real calendar blocks unfair rounds without declaring a champion");
console.log("PASS: synchronized (counterfactual) history replay resolves standings, semifinals and final");
console.log("PASS: emergency replacement leaves past scoring unchanged");
console.log("PASS: invalid/missing/duplicate game stats and tied playoffs handled");
