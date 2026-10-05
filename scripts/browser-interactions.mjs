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

  await send("Runtime.enable");
  await evaluate("localStorage.clear()");
  await evaluate("location.hash='home'; location.reload()");
  await sleep(700);

  await expect("home renders","document.title.includes('Home') && document.body.innerText.includes('Fantasy scoring preview')");
  await expect("home fits mobile viewport","document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");

  await evaluate("document.querySelector('#accountBtn').click()");
  await expect("account backend state renders","document.title.includes('Account') && ['Local mode','Cloud backend connected'].includes(document.querySelector('#cloudStatusTitle').innerText)");
  await evaluate("document.querySelector('[data-jump=home]').click()");
  await expect("account back returns home","document.title.includes('Home')");

  await evaluate("document.querySelector('[data-view=players]').click()");
  await expect("players nav works","document.title.includes('Players') && !!document.querySelector('#playerSearch')");

  await evaluate("(()=>{const i=document.querySelector('#playerSearch'); i.value='Faker'; i.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await expect("player search filters","document.querySelectorAll('#freeAgentList .player-row').length >= 1");

  await evaluate("document.querySelector('#freeAgentList [data-open-player]').click()");
  await expect("player profile opens","document.title.includes('Player') && !!document.querySelector('#profileName')");

  await evaluate("document.querySelector('#watchPlayerBtn').click()");
  await expect("watchlist persists","JSON.parse(localStorage.getItem('riftWatchlist')||'[]').length === 1");

  await evaluate("document.querySelector('#playerBackBtn').click()");
  await expect("player back navigation returns to players","document.title.includes('Players') && !!document.querySelector('#freeAgentList')");

  await evaluate("(()=>{const i=document.querySelector('#playerSearch'); i.value=''; i.dispatchEvent(new Event('input',{bubbles:true})); const b=document.querySelector('#freeAgentList .add-btn:not([disabled])'); if(b)b.click();})()");
  await expect("full-roster add opens drop chooser","document.querySelector('#transactionModal') && document.querySelector('#transactionModal').hidden === false");
  await evaluate("document.querySelector('#transactionModal [data-close-transaction]').click()");
  await expect("transaction modal closes","document.querySelector('#transactionModal').hidden === true");

  await evaluate("document.querySelector('[data-view=team]').click()");
  await expect("team nav works","document.title.includes('My Team') && !!document.querySelector('#rosterList')");
  const beforeDrop=await evaluate("JSON.parse(localStorage.getItem('riftUserRoster')||'[]').length || document.querySelectorAll('#rosterList .roster-slot').length");
  await evaluate("window.confirm=()=>true; document.querySelector('[data-drop-roster]').click()");
  await expect("drop updates roster",`JSON.parse(localStorage.getItem('riftUserRoster')||'[]').length === ${Math.max(0,Number(beforeDrop)-1)}`);

  await evaluate("document.querySelector('[data-view=players]').click(); const b=document.querySelector('#freeAgentList .add-btn:not([disabled])'); if(b)b.click()");
  await expect("add updates roster",`JSON.parse(localStorage.getItem('riftUserRoster')||'[]').length === ${Number(beforeDrop)}`);

  await evaluate("document.querySelector('[data-view=team]').click(); document.querySelector('[data-jump=transactions]').click()");
  await expect("transactions view opens","document.title.includes('Transactions') && !!document.querySelector('#transactionContent')");
  await evaluate("document.querySelector('[data-transaction-tab=history]').click()");
  await expect("transaction history records moves","document.querySelector('#transactionContent').innerText.includes('COMPLETE')");

  await evaluate("document.querySelector('[data-view=players]').click(); const r=[...document.querySelectorAll('#freeAgentList .player-row')].find(x=>x.querySelector('.add-btn:not([disabled])')); if(r)r.querySelector('[data-open-player]').click()");
  await expect("available player profile opens","!!document.querySelector('#profileWaiverBtn') && !document.querySelector('#profileWaiverBtn').disabled");
  await evaluate("document.querySelector('#profileWaiverBtn').click()");
  await expect("waiver claim saves","JSON.parse(localStorage.getItem('riftWaiverClaims')||'[]').length === 1");

  await evaluate("document.querySelector('#profileTradeBtn').click()");
  await expect("trade center opens","document.title.includes('Trades') && !!document.querySelector('#tradePartner')");
  await expect("trade center fits mobile viewport","document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");
  await evaluate("(()=>{const a=document.querySelector('[data-trade-mine]'); const b=document.querySelector('[data-trade-theirs]'); if(a)a.click(); if(b)b.click();})()");
  await expect("trade offer becomes submittable","!document.querySelector('#submitTradeBtn').disabled");
  await evaluate("document.querySelector('#submitTradeBtn').click()");
  await expect("trade offer saves","JSON.parse(localStorage.getItem('riftTradeOffers')||'[]').some(x=>x.direction==='outgoing')");

  await evaluate("document.querySelector('[data-view=league]').click(); document.querySelector('[data-jump=setup]').click()");
  await expect("league setup opens","document.title.includes('League Setup') && !!document.querySelector('#leagueName')");
  await evaluate("document.querySelector('#leagueName').value='Audit League'; document.querySelector('#saveLeagueBtn').click()");
  await expect("league settings save","JSON.parse(localStorage.getItem('riftLeagueSettings')||'{}').name === 'Audit League'",3000);

  await evaluate("(()=>{const b=document.querySelector('[data-jump=draft]'); if(b)b.click();})()");
  await expect("draft room opens","document.title.includes('Draft Room') && !!document.querySelector('#startDraftBtn')");
  await expect("draft room contains horizontal board scroll","document.querySelector('#fullDraftBoard').scrollWidth >= document.querySelector('#fullDraftBoard').clientWidth");
  await expect("draft page fits mobile viewport","document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");
  await evaluate("(()=>{const b=document.querySelector('#startDraftBtn'); if(b&&!b.disabled)b.click();})()");
  await expect("mock draft starts","JSON.parse(localStorage.getItem('riftDraftState')||'{}').started === true");
  await evaluate("(()=>{const b=document.querySelector('#draftPlayerList .draft-btn:not([disabled])'); if(b)b.click();})()");
  await expect("draft pick records","JSON.parse(localStorage.getItem('riftDraftState')||'{}').picks.length >= 2");

  await evaluate("document.querySelector('[data-view=schedule]').click(); document.querySelector('[data-day=today]').click()");
  await expect("schedule filter works","document.querySelector('[data-day=today]').classList.contains('active')");
  await expect("schedule fits mobile viewport","document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");

  ws.close();
  console.log("All interaction tests passed.");
} finally {
  cleanup();
}
