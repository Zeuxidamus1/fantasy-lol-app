import assert from "node:assert/strict";
import fs from "node:fs/promises";

const root=new URL("../",import.meta.url);
const read=async name=>fs.readFile(new URL(name,root),"utf8");
const [script,reportText,fixtureText]=await Promise.all([
  read("scripts/replay-visualizer.js"),
  read("scripts/reports/season-history-replay.json"),
  read("scripts/fixtures/worlds-2026-swiss-replay.json")
]);
const report=JSON.parse(reportText),fixture=JSON.parse(fixtureText);
const ids=["summary","stats","standings","bracket","rounds","rosters"];
const elements=Object.fromEntries(ids.map(id=>[id,{innerHTML:"",textContent:""}]));
const buttons=["calendar","standard","synchronized","emergencyReplacement"].map(mode=>({
  dataset:{mode},setAttribute(name,value){this[name]=value},
  addEventListener(name,fn){if(name==="click")this.click=fn;}
}));
const document={
  getElementById:id=>elements[id],
  querySelectorAll:selector=>selector==="[data-mode]"?buttons:[]
};
const fetch=async url=>({ok:true,json:async()=>url.includes("/reports/")?report:fixture});
assert.ok(script.includes("(async()=>{"),"Visualizer entrypoint available");
const invoke=new Function("document","fetch",script.replace("(async()=>{","return (async()=>{"));
await invoke(document,fetch);
assert.ok(elements.bracket.innerHTML.includes("Championship"),"fantasy championship is visible");
assert.ok(elements.bracket.innerHTML.includes("Manager 3")&&elements.bracket.innerHTML.includes("Manager 4"),"only the top two face off in the default championship");
assert.ok(elements.rosters.innerHTML.includes("Zeus"),"real archived roster names are visible");
assert.ok(elements.rosters.innerHTML.includes("Movistar KOI"),"cross-team rosters display professional organizations");
buttons.find(b=>b.dataset.mode==="synchronized").click();
assert.ok(elements.bracket.innerHTML.includes("Semifinal"),"four-manager bracket stress test shows semifinals");
buttons.find(b=>b.dataset.mode==="calendar").click();
assert.ok(elements.summary.innerHTML.includes("BLOCKED"),"invalid calendars are visibly blocked");
assert.ok(elements.bracket.innerHTML.includes("No championship"),"blocked calendars have no champion");
buttons.find(b=>b.dataset.mode==="emergencyReplacement").click();
assert.ok(elements.summary.innerHTML.includes("HYPOTHETICAL EVENT"),"hypothetical replacement is disclosed");
assert.ok(elements.rosters.innerHTML.includes("Canna"),"replacement is shown");
assert.ok(elements.stats.innerHTML.includes("Manager 1"),"final champion remains distinguishable from real events");
console.log("PASS: historical replay dashboard renders synchronized, blocked and replacement scenarios");
