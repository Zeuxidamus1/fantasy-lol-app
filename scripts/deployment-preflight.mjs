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
let legacyMigrationCount=0;
for(const file of migrationFiles){
  const canonical=file.match(/^(\d{14})_(.+)\.sql$/);
  if(canonical){
    if(seen.has(canonical[1]))fail("duplicate migration timestamp "+canonical[1]);
    seen.add(canonical[1]);
    continue;
  }
  if(/^\d{8}_.+\.sql$/.test(file)){
    legacyMigrationCount++;
    continue;
  }
  fail("invalid migration filename "+file);
}
if(migrationFiles.length&&failures===0){
  pass("migration filenames are valid");
  if(legacyMigrationCount)console.log("INFO:",legacyMigrationCount+" legacy date-only migration filename(s) retained for compatibility");
}

const deploy=fs.existsSync(path.join(root,".github","workflows","deploy-cloud.yml"))
  ? fs.readFileSync(path.join(root,".github","workflows","deploy-cloud.yml"),"utf8")
  : "";
if(/psql[\s\S]*supabase\/schema\.sql/i.test(deploy)){
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

const secretScanFiles=[
  "app.js","backend.js","backend-config.js","index.html","styles.css",
  ...migrationFiles.map(f=>"supabase/migrations/"+f),
  "supabase/functions/sync-match-stats/index.ts",
  "supabase/functions/sync-pandascore-validator/index.ts"
];
for(const rel of secretScanFiles){
  const full=path.join(root,rel);
  if(!fs.existsSync(full))continue;
  const body=fs.readFileSync(full,"utf8");
  const forbidden=[
    /sb_secret_[A-Za-z0-9_-]+/,
    /service_role[^\n]{0,80}[=:][^\n]{8,}/i,
    /const\s+API_KEY\s*=\s*["'][^"']{12,}["']/,
    /PANDASCORE_API_TOKEN\s*=\s*["'][^"']+["']/
  ];
  if(forbidden.some(rx=>rx.test(body)))fail("possible backend credential committed in "+rel);
}
if(!failures)pass("repository secret scan found no embedded backend credentials");

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
