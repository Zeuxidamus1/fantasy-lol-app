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

const ignoredDirs=new Set([".git","node_modules",".cache","dist","coverage"]);
const textExtensions=new Set([".js",".mjs",".cjs",".ts",".tsx",".jsx",".html",".css",".md",".json",".yml",".yaml",".toml",".sql",".txt",".sh"]);
const secretScanFiles=[];
const walk=dir=>{
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(ignoredDirs.has(entry.name))continue;
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){walk(full);continue;}
    const rel=path.relative(root,full).replaceAll("\\","/");
    if(textExtensions.has(path.extname(entry.name).toLowerCase())||entry.name===".gitignore")secretScanFiles.push(rel);
  }
};
walk(root);

const forbiddenFiles=[
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:id_rsa|id_ed25519|credentials?|secrets?)(?:\.|$)/i,
  /\.(?:pem|p12|pfx|jks|keystore)$/i
];
for(const rel of secretScanFiles){
  if(forbiddenFiles.some(rx=>rx.test(rel))&&!/\.env\.example$/i.test(rel)){
    fail("sensitive-looking file must not be committed: "+rel);
  }
  const full=path.join(root,rel);
  const body=fs.readFileSync(full,"utf8");
  const forbidden=[
    /sb_secret_[A-Za-z0-9_-]{8,}/,
    /(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /postgres(?:ql)?:\/\/[^\s"'<>]+/i,
    /PANDASCORE_API_TOKEN\s*[:=]\s*["'][^"']+["']/i,
    /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"']+["']/i,
    /SUPABASE_ACCESS_TOKEN\s*[:=]\s*["'][^"']+["']/i,
    /SUPABASE_DB_URL\s*[:=]\s*["'][^"']+["']/i,
    /LOL_ESPORTS_API_KEY\s*[:=]\s*["'][^"']+["']/i
  ];
  if(forbidden.some(rx=>rx.test(body)))fail("possible backend credential committed in "+rel);
}
if(!failures)pass("repository-wide secret scan found no embedded backend credentials");

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
