import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const fail=[];
const pass=[];
const check=(ok,msg)=>{(ok?pass:fail).push(msg);};

const required=["index.html","styles.css","app.js","esports-data.js","backend-config.js","backend.js","supabase/schema.sql","package.json","scripts/update-esports-data.mjs","scripts/browser-smoke.sh","scripts/browser-interactions.mjs",".github/workflows/validate-app.yml",".github/workflows/update-esports-data.yml",".github/workflows/deploy-cloud.yml"];
for(const file of required) check(fs.existsSync(path.join(root,file)),`required file: ${file}`);

const html=read("index.html");
const css=read("styles.css");
const app=read("app.js");
const dataText=read("esports-data.js");
const updater=read("scripts/update-esports-data.mjs");
const backend=read("backend.js");
const backendConfig=read("backend-config.js");
const schema=read("supabase/schema.sql");

try{new Function(app);pass.push("app.js parses");}catch(err){fail.push("app.js syntax: "+err.message);}
try{new Function(dataText);pass.push("esports-data.js parses");}catch(err){fail.push("esports-data.js syntax: "+err.message);}
try{new Function(backendConfig);pass.push("backend-config.js parses");}catch(err){fail.push("backend-config.js syntax: "+err.message);}
try{new Function(backend);pass.push("backend.js parses");}catch(err){fail.push("backend.js syntax: "+err.message);}

const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const idCounts=new Map();
for(const id of ids) idCounts.set(id,(idCounts.get(id)||0)+1);
check([...idCounts.values()].every(n=>n===1),"HTML IDs are unique");

const templates=new Set([...html.matchAll(/<template\s+id="([^"]+)-template"/g)].map(m=>m[1]));
const routeTargets=new Set([
  ...[...html.matchAll(/data-view="([^"]+)"/g)].map(m=>m[1]),
  ...[...html.matchAll(/data-jump="([^"]+)"/g)].map(m=>m[1])
]);
for(const target of routeTargets) check(templates.has(target),`route target has template: ${target}`);

const localAssetPath=value=>String(value||"").split(/[?#]/,1)[0];
for(const src of [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m=>m[1])){
  if(/^https?:/.test(src)) continue;
  const local=localAssetPath(src);
  check(fs.existsSync(path.join(root,local)),`script exists: ${src}`);
}
for(const href of [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map(m=>m[1])){
  if(/^https?:|^data:/.test(href)) continue;
  const local=localAssetPath(href);
  check(fs.existsSync(path.join(root,local)),`linked asset exists: ${href}`);
}

const sandbox={window:{}};
try{
  vm.runInNewContext(dataText,sandbox,{timeout:1000});
  const data=sandbox.window.ESPORTS_DATA;
  check(data&&typeof data==="object","ESPORTS_DATA is an object");
  check(Array.isArray(data?.schedule),"schedule is an array");
  check(Array.isArray(data?.players),"players is an array");
  check(Array.isArray(data?.rankings),"rankings is an array");
  check(!data?.updatedAt || Number.isFinite(Date.parse(data.updatedAt)),"updatedAt is parseable");
  const playerIds=(data?.players||[]).map(p=>p.id).filter(Boolean);
  check(new Set(playerIds).size===playerIds.length,"player IDs are unique");
}catch(err){fail.push("ESPORTS_DATA load: "+err.message);}

check(!/LOL_ESPORTS_API_KEY\s*\|\|\s*["']/.test(updater),"no hard-coded API-key fallback");
check(!/[A-Za-z0-9_-]{30,}\s*["'];?\s*\/\/\s*api key/i.test(updater),"no obvious inline API key");
check(!/service[_-]?role/i.test(backendConfig),"frontend config does not contain service-role credentials");
check(schema.includes("enable row level security"),"Supabase schema enables RLS");
check(schema.includes("create policy"),"Supabase schema defines access policies");

const openBraces=(css.match(/{/g)||[]).length;
const closeBraces=(css.match(/}/g)||[]).length;
check(openBraces===closeBraces,"CSS braces are balanced");

const fnNames=[...app.matchAll(/function\s+([A-Za-z0-9_$]+)\s*\(/g)].map(m=>m[1]);
const duplicateFns=[...new Set(fnNames.filter((n,i)=>fnNames.indexOf(n)!==i))];
check(duplicateFns.length===0,`no duplicate function declarations${duplicateFns.length?": "+duplicateFns.join(", "):""}`);

check(html.includes('meta name="description"'),"page has a meta description");
check(html.includes('aria-label="Primary navigation"'),"primary navigation is labeled");
check(html.includes('aria-live="polite"'),"toast uses an ARIA live region");

console.log("\nValidation checks:");
for(const msg of pass) console.log("  PASS",msg);
if(fail.length){
  for(const msg of fail) console.error("  FAIL",msg);
  console.error(`\n${fail.length} validation check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${pass.length} validation checks passed.`);
