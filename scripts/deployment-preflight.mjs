import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const migrationsDir=path.join(root,"supabase","migrations");
const required=["index.html","app.js","backend.js","backend-config.js","styles.css","package.json",".github/workflows/validate-app.yml"];

let failures=0;
const fail=(msg)=>{console.error("FAIL:",msg);failures++;};
const pass=(msg)=>console.log("PASS:",msg);

for(const file of required){
  if(fs.existsSync(path.join(root,file)))pass("required file "+file);
  else fail("missing required file "+file);
}

const migrationFiles=fs.existsSync(migrationsDir)
  ? fs.readdirSync(migrationsDir).filter(f=>f.endsWith(".sql")).sort()
  : [];

if(!migrationFiles.length)fail("no Supabase migrations found");
else pass(String(migrationFiles.length)+" Supabase migrations found");

const seen=new Set();
for(const file of migrationFiles){
  const match=file.match(/^(\\d{14})_(.+)\\.sql$/);
  if(!match){fail("invalid migration filename "+file);continue;}
  if(seen.has(match[1]))fail("duplicate migration timestamp "+match[1]);
  seen.add(match[1]);
}
if(migrationFiles.length&&failures===0)pass("migration filenames are unique and ordered");

const deploy=fs.existsSync(path.join(root,".github","workflows","deploy-cloud.yml"))
  ? fs.readFileSync(path.join(root,".github","workflows","deploy-cloud.yml"),"utf8")
  : "";
if(/psql[\\s\\S]*supabase\\/schema\\.sql/i.test(deploy)){
  fail("deployment workflow must not apply supabase/schema.sql directly");
}else{
  pass("deployment workflow does not reapply legacy schema.sql");
}

const config=fs.readFileSync(path.join(root,"backend-config.js"),"utf8");
if(/service[_-]?role/i.test(config))fail("frontend config contains service-role wording");
else pass("frontend config contains no service-role credential");

if(/PANDASCORE_API_TOKEN|LOL_ESPORTS_API_KEY|SUPABASE_DB_URL/.test(config)){
  fail("frontend config contains a backend-only secret name");
}else{
  pass("frontend config contains no backend-only secret names");
}

const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
if(/id=["\']opsCard["\']|id=["\']homeDataHealth["\']/.test(html)){
  fail("backend telemetry element is rendered in public HTML");
}else{
  pass("backend telemetry is not rendered in public HTML");
}

if(failures){
  console.error("\\nDeployment preflight failed with "+failures+" issue(s).");
  process.exit(1);
}
console.log("\\nDeployment preflight passed.");
