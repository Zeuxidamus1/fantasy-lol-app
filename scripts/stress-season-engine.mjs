import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import {performance} from "node:perf_hooks";
import {runHistoricalSeasonReplay} from "./lib/season-replay.mjs";

const app=await fs.readFile(new URL("../app.js",import.meta.url),"utf8");
const start=app.indexOf("function planAdaptiveSeasonRounds(");
const end=app.indexOf('\n  if(view==="create-league")',start);
assert.ok(start>=0&&end>start,"Season round engine not found");
const runtime={Date,Set,Map,Array,Number,String,Math};
vm.createContext(runtime);
vm.runInContext(app.slice(start,end)+
  "\nthis.planAdaptiveSeasonRounds=planAdaptiveSeasonRounds;this.planSeasonHeadToHead=planSeasonHeadToHead;",
  runtime,{timeout:3000});
const {planAdaptiveSeasonRounds:plan,planSeasonHeadToHead:pair}=runtime;
const archive=JSON.parse(await fs.readFile(new URL("./fixtures/worlds-2026-swiss-replay.json",import.meta.url),"utf8"));
const report={createdAt:new Date().toISOString(),loadProfile:"Local CPU stress; NOT HTTP traffic or real-user concurrency",checks:[]};
function run(name,callback){
  const t=performance.now(),details=callback(),milliseconds=Math.round((performance.now()-t)*100)/100;
  report.checks.push({name,milliseconds,...details});
  console.log("PASS",name,milliseconds+" ms");
}
run("1000 archived fantasy replay calculations",()=>{
  for(let i=0;i<1000;i++){
    const mode=i%3===0?"calendar":"synchronized";
    const r=runHistoricalSeasonReplay(archive,{mode,replacement:i%5===0,playoffTeams:i%4===0?4:2});
    if(mode==="calendar")assert.ok(r.blocked&&r.champion===null);
    else assert.ok(!r.blocked&&r.champion!==null);
  }
  return {iterations:1000};
});
run("50,000 professional series",()=>{
  const t=Date.parse("2027-01-01T00:00:00Z"),count=50000;
  const input=Array.from({length:count},(_,i)=>({
    id:"test-"+i,start_time:new Date(t+Math.floor(i/100)*86400000+(i%100)*30000).toISOString(),
    team_a_id:"A"+i%20,team_b_id:"B"+i%20,stage:"Regular Season",status:"SCHEDULED"
  }));
  const rounds=plan(input,t-1);
  assert.equal(rounds.reduce((n,r)=>n+r.matchCount,0),count);
  for(let i=1;i<rounds.length;i++)
    assert.ok(Date.parse(rounds[i-1].endsAt)<=Date.parse(rounds[i].startsAt),"No overlapping periods");
  return {series:count,rounds:rounds.length,overlaps:0,lostMatches:0};
});
run("2–10 managers, 300 rounds per size",()=>{
  let total=0;
  for(let n=2;n<=10;n++){
    const managers=Array.from({length:n},(_,i)=>({id:String(i)}));
    const entries=pair(managers,300);
    total+=entries.length;
    for(let r=1;r<=300;r++){
      const games=entries.filter(e=>e.round===r);
      const ids=games.flatMap(e=>[e.home,e.away]).filter(x=>x!==null);
      assert.equal(ids.length,n);
      assert.equal(new Set(ids).size,n);
      assert.equal(games.filter(e=>e.bye).length,n%2);
    }
  }
  return {managerSizes:9,roundsPerSize:300,pairingSlots:total};
});
console.log(JSON.stringify({status:"PASS",...report},null,2));
