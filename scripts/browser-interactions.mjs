import { spawn, execFileSync } from "node:child_process";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = (() => {
  for (const name of ["google-chrome","google-chrome-stable","chromium","chromium-browser"]) {
    try { return execFileSync("which",[name],{encoding:"utf8"}).trim(); } catch {}
  }
  return "";
})();
if (!chrome) throw new Error("Chrome/Chromium is not available.");

const server = spawn("python3",["-m","http.server","4174","--bind","127.0.0.1"],{stdio:"ignore"});
const browser = spawn(chrome,[
  "--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage","--window-size=390,844",
  "--remote-debugging-port=9223","--user-data-dir=/tmp/rift-cdp",
  "http://127.0.0.1:4174/#home"
],{stdio:"ignore"});

const cleanup=()=>{try{browser.kill("SIGKILL");}catch{} try{server.kill("SIGKILL");}catch{}};
process.on("exit",cleanup);
process.on("SIGINT",()=>{cleanup();process.exit(130);});

async function json(url, options){
  const res=await fetch(url,options);
  if(!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}
async function waitFor(fn, timeout=10000){
  const start=Date.now();
  let last;
  while(Date.now()-start<timeout){
    try{last=await fn();if(last)return last;}catch{}
    await sleep(150);
  }
  throw new Error("Timed out waiting for browser state: "+String(last));
}

try{
  await waitFor(async()=>{
    const r=await fetch("http://127.0.0.1:4174/");
    return r.ok;
  });
  const target=await waitFor(async()=>{
    const list=await json("http://127.0.0.1:9223/json/list");
    return list.find(x=>x.type==="page"&&x.url.includes("127.0.0.1:4174"));
  });

  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    ws.addEventListener("open",resolve,{once:true});
    ws.addEventListener("error",reject,{once:true});
  });

  let nextId=1;
  const pending=new Map();
  ws.addEventListener("message",event=>{
    const msg=JSON.parse(event.data);
    if(msg.id&&pending.has(msg.id)){
      const {resolve,reject}=pending.get(msg.id);
      pending.delete(msg.id);
      if(msg.error)reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=nextId++;
    pending.set(id,{resolve,reject});
    ws.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async(expression)=>{
    const result=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails) throw new Error(result.exceptionDetails.text||"Runtime exception");
    return result.result?.value;
  };
  const expect=async(label, expression, timeout=5000)=>{
    const ok=await waitFor(()=>evaluate(expression),timeout);
    if(!ok)throw new Error("Failed: "+label);
    console.log("PASS",label);
  };
  const route=async hash=>{
    await evaluate(`location.hash='${hash}'; location.reload()`);
    await sleep(700);
  };

  await send("Runtime.enable");
  await evaluate("localStorage.clear()");
  await route("home");

  await expect("signed-out home routes to login","document.title.includes('Sign In') && !!document.querySelector('#landingSignIn')");
  await expect("login fits mobile viewport","document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");
  await evaluate("document.querySelector('#landingCreateAccount').click()");
  await expect("create account opens dedicated signup","document.title.includes('Create Account') && !!document.querySelector('#signupPasswordConfirm')");
  await evaluate("document.querySelector('#signupBack').click()");
  await expect("signup back returns to sign in","document.title.includes('Sign In') && !!document.querySelector('#landingEmail')");

  await route("players");
  await expect("players route renders","document.title.includes('Players') && !!document.querySelector('#playerSearch')");
  await evaluate("(()=>{const i=document.querySelector('#playerSearch'); i.value='Faker'; i.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await expect("player search filters","document.querySelectorAll('#freeAgentList .player-row').length >= 1");
  await evaluate("document.querySelector('#freeAgentList [data-open-player]').click()");
  await expect("player profile opens","document.title.includes('Player') && !!document.querySelector('#profileName')");
  await evaluate("document.querySelector('#watchPlayerBtn').click()");
  await expect("watchlist persists","JSON.parse(localStorage.getItem('riftWatchlist')||'[]').length === 1");

  await route("team");
  await expect("team route renders","document.title.includes('My Team') && !!document.querySelector('#teamNoLeague')");
  await expect("team shows no-league state without active league","document.querySelector('#teamNoLeague').hidden === false");

  await route("league");
  await expect("league route renders","document.title.includes('League') && !!document.querySelector('#joinCloudLeagueBtn')");
  await expect("join disabled until required fields entered","document.querySelector('#joinCloudLeagueBtn').disabled === true");

  await route("draft");
  await expect("draft room renders","document.title.includes('Draft Room') && !!document.querySelector('#draftPlayerList')");
  await expect("draft page fits mobile viewport","document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");

  await route("matchup");
  await expect("matchup avoids fake scores","document.body.innerText.includes('Fantasy scoring is not live yet')");

  await route("schedule");
  await evaluate("document.querySelector('[data-day=today]').click()");
  await expect("schedule filter works","document.querySelector('[data-day=today]').classList.contains('active')");
  await expect("schedule fits mobile viewport","document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");

  ws.close();
  console.log("All interaction tests passed.");
} finally {
  cleanup();
}
