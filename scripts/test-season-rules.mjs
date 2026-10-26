import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source=await fs.readFile(new URL("../app.js",import.meta.url),"utf8");
const begin=source.indexOf("function planAdaptiveSeasonRounds(");
const end=source.indexOf('\n  if(view==="create-league")',begin);
assert.ok(begin>=0 && end>begin,"Season scheduling functions must exist");
const sandbox={Date,Set,Map,Array,Number,String,Math};
vm.createContext(sandbox);
vm.runInContext(source.slice(begin,end)+"\nthis.plan=planAdaptiveSeasonRounds;this.pairs=planSeasonHeadToHead;",sandbox,{timeout:3000});
const {plan,pairs}=sandbox;
const origin=Date.parse("2027-01-01T12:00:00.000Z");
const match=(id,a,b,days,status="SCHEDULED")=>({
 id,team_a_id:a,team_b_id:b,
 start_time:new Date(origin+days*86400000).toISOString(),
 stage:"Regular Season",status
});
const rounds=plan([
 match("m1","A","B",0),match("m2","C","D",0),
 match("m3","A","C",5),match("m4","B","D",5)
],origin-1000);
assert.equal(rounds.length,2,"Dates separated by five days form independent rounds");
assert.equal(rounds[0].matchCount,2);
assert.equal(rounds[1].matchCount,2);
assert.equal(rounds[0].warnings.length,0,"Balanced schedule should not warn");
assert.equal(rounds[1].warnings.length,0,"Balanced schedule should not warn");
assert.equal(plan([match("m1","A","B",0),match("m2","A","C",0)],origin-1000)[0].warnings.includes("Unequal series counts between teams"),true,"Uneven schedules require review");
assert.equal(plan([match("m1","A","B",0,"POSTPONED")],origin-1000).length,0,"Postponed games must not be counted");
const ids=["a","b","c"];
const games=pairs(ids.map(id=>({id})),3);
assert.equal(games.length,6,"Three managers have two pairing slots per round");
for(const id of ids)assert.equal(games.filter(g=>g.bye&&(g.home===id||g.away===id)).length,1,"Each manager receives one bye per round-robin cycle");
const head=pairs(["a","b","c","d"].map(id=>({id})),3);
assert.equal(head.length,6);
assert.equal(head.filter(g=>g.bye).length,0,"Even manager counts have no bye");
console.log("Season Fantasy scheduling, fairness and bye tests passed.");
