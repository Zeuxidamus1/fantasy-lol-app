import { writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const YEAR=new Date().getUTCFullYear();
const DATA_URL=`https://chaincc.lol/data/chaincc-players-${YEAR}.csv.gz`;
const OUT="player-stats.js";

function parseCsv(text){
  const rows=[];
  let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(ch==='"')quoted=false;
      else field+=ch;
    }else{
      if(ch==='"')quoted=true;
      else if(ch===","){row.push(field);field="";}
      else if(ch==="\n"){row.push(field);rows.push(row);row=[];field="";}
      else if(ch!=="\r")field+=ch;
    }
  }
  if(field||row.length){row.push(field);rows.push(row);}
  return rows;
}

const norm=s=>String(s||"").trim().toLowerCase().replace(/[^a-z0-9]/g,"");
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
const bool=v=>{
  const x=String(v??"").trim().toLowerCase();
  if(["true","1","win","w","yes"].includes(x))return true;
  if(["false","0","loss","l","no"].includes(x))return false;
  return null;
};
const first=(obj,names)=>{
  for(const name of names){
    if(obj[name]!==undefined&&obj[name]!==null&&String(obj[name]).trim()!=="")return obj[name];
  }
  return null;
};
const canonicalCompetition=(value)=>{
  const raw=String(value||"").trim().toLowerCase();
  if(!raw)return null;
  if(raw==="lcs"||raw.includes("league championship series"))return "lcs";
  if(raw==="cblol"||raw.includes("cblol"))return "cblol";
  if(raw==="lec"||raw.includes("european championship"))return "lec";
  if(raw==="lck"||raw.includes("champions korea"))return "lck";
  if(raw==="lpl"||raw.includes("pro league"))return "lpl";
  if(raw==="lcp"||raw.includes("league of legends championship pacific"))return "lcp";
  if(raw.includes("first stand")||raw==="fst")return "first_stand";
  if(raw==="msi"||raw.includes("mid-season"))return "msi";
  if(raw==="wlds"||raw==="worlds"||raw.includes("world championship"))return "worlds";
  return null;
};

const response=await fetch(DATA_URL,{headers:{
  "user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
  "referer":"https://chaincc.lol/free/data",
  "accept":"application/gzip, application/octet-stream;q=0.9, */*;q=0.8",
  "accept-language":"en-US,en;q=0.9",
  "cache-control":"no-cache"
}});
if(!response.ok){
  console.warn(`ChainCC download unavailable from this runner (${response.status}); preserving the current player-stats.js snapshot.`);
  process.exit(0);
}
const csv=gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");
const parsed=parseCsv(csv);
if(parsed.length<2)throw new Error("ChainCC CSV was empty");

const headers=parsed[0].map(h=>String(h).trim().toLowerCase());
const byName=new Map();
const gameRows=[];

for(let i=1;i<parsed.length;i++){
  const values=parsed[i];
  if(values.length<2)continue;
  const row={};
  headers.forEach((h,idx)=>row[h]=values[idx]??"");

  const player=first(row,["playername","player_name","player","name"]);
  const position=first(row,["position","role"]);
  if(!player||!position)continue;

  const league=first(row,["league","league_name"]);
  const competition=canonicalCompetition(league);
  const entry={
    gameId:first(row,["game_id","gameid","game"]),
    date:first(row,["date","game_date"]),
    league,
    competition,
    split:first(row,["split"]),
    patch:first(row,["patch"]),
    player:String(player),
    team:first(row,["team_name","team","teamname"]),
    opponent:first(row,["opponent_team_name","opponent_name","opponent","opp_team","opponent_team"]),
    side:first(row,["side"]),
    position:String(position).toUpperCase(),
    champion:first(row,["champion","pick"]),
    win:bool(first(row,["result","win","won"])),
    kills:num(first(row,["kills","k"])),
    deaths:num(first(row,["deaths","d"])),
    assists:num(first(row,["assists","a"])),
    cs:num(first(row,["total_cs","cs","creep_score"])),
    cspm:num(first(row,["cspm","cs_per_minute","cs_per_min"])),
    dpm:num(first(row,["dpm","damage_per_minute","damage_per_min"])),
    gpm:num(first(row,["gpm","gold_per_minute","gold_per_min"])),
    kp:num(first(row,["kill_participation","kp"])),
    visionScore:num(first(row,["vision_score","visionscore"])),
    firstBlood:bool(first(row,["firstbloodkill","first_blood_kill","first_blood","firstblood"]))
  };

  const key=norm(player);
  if(!key)continue;
  if(!byName.has(key))byName.set(key,[]);
  byName.get(key).push(entry);

  const gameDate=Date.parse(entry.date||"");
  const cutoff=Date.now()-60*24*60*60*1000;
  if(entry.competition&&entry.gameId&&Number.isFinite(gameDate)&&gameDate>=cutoff){
    gameRows.push(entry);
  }
}

for(const rows of byName.values()){
  rows.sort((a,b)=>{
    const ta=Date.parse(a.date||"");
    const tb=Date.parse(b.date||"");
    return (Number.isFinite(tb)?tb:0)-(Number.isFinite(ta)?ta:0);
  });
}

const players={};
for(const [key,rows] of byName){
  const recent=rows.slice(0,10);
  const valid=recent.filter(r=>r.kills!==null&&r.deaths!==null&&r.assists!==null);
  const sum=(field)=>valid.reduce((a,r)=>a+(Number(r[field])||0),0);
  const avg=(field)=>{
    const vals=recent.map(r=>r[field]).filter(Number.isFinite);
    return vals.length?Number((vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2)):null;
  };
  const wins=recent.filter(r=>r.win===true).length;
  players[key]={
    player:recent[0]?.player||rows[0]?.player||key,
    team:recent[0]?.team||rows[0]?.team||null,
    position:recent[0]?.position||rows[0]?.position||null,
    games:recent.length,
    wins,
    winRate:recent.length?Number((wins/recent.length*100).toFixed(1)):null,
    avgKills:valid.length?Number((sum("kills")/valid.length).toFixed(2)):null,
    avgDeaths:valid.length?Number((sum("deaths")/valid.length).toFixed(2)):null,
    avgAssists:valid.length?Number((sum("assists")/valid.length).toFixed(2)):null,
    kda:valid.length?Number(((sum("kills")+sum("assists"))/Math.max(1,sum("deaths"))).toFixed(2)):null,
    avgCspm:avg("cspm"),
    avgDpm:avg("dpm"),
    avgGpm:avg("gpm"),
    avgKp:avg("kp"),
    recent
  };
}

const payload={
  source:"ChainCC",
  sourceUrl:"https://chaincc.lol/free/data",
  license:"CC BY 4.0",
  season:YEAR,
  updatedAt:new Date().toISOString(),
  datasetUrl:DATA_URL,
  games:gameRows,
  players
};
await writeFile(OUT,`window.PLAYER_STATS = ${JSON.stringify(payload)};\n`,"utf8");
console.log(`Wrote ${OUT} with ${Object.keys(players).length} players and ${gameRows.length} recent supported Tier 1 game rows from ChainCC ${YEAR}`);
