import { spawn, execFileSync } from "node:child_process";
import http from "node:http";

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

function requestText(url){
  return new Promise((resolve,reject)=>{
    const req=http.get(url,res=>{
      let body="";
      res.setEncoding("utf8");
      res.on("data",chunk=>{body+=chunk;});
      res.on("end",()=>{
        if((res.statusCode||500)>=400)return reject(new Error(url+" -> "+res.statusCode));
        resolve(body);
      });
    });
    req.setTimeout(5000,()=>req.destroy(new Error("Request timed out: "+url)));
    req.on("error",reject);
  });
}
async function json(url){
  return JSON.parse(await requestText(url));
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
    await requestText("http://127.0.0.1:4174/");
    return true;
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
  await send("Page.enable");
  await send("Page.navigate",{url:"http://127.0.0.1:4174/#home"});
  await sleep(700);
  await expect("test page loaded","location.origin === 'http://127.0.0.1:4174' && document.readyState !== 'loading'");
  await expect("skip link exists","!!document.querySelector('.skip-link')");
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
  await expect("player profile has projection panel","!!document.querySelector('#profileProjectedFp') && !!document.querySelector('#profileAvailability')");
  await evaluate("document.querySelector('#watchPlayerBtn').click()");
  await expect("watchlist persists","JSON.parse(localStorage.getItem('riftWatchlist')||'[]').length === 1");

  await route("team");
  await expect("team route renders","document.title.includes('My Team') && !!document.querySelector('#teamNoLeague')");
  await expect("team shows no-league state without active league","document.querySelector('#teamNoLeague').hidden === false");

  await expect("empty roster is incomplete","(()=>{const v=validateRoster([],{bench:2});return !v.isComplete&&v.missingStarterSlots===5&&v.missingFlexSlots===1&&v.missingBenchSlots===2&&v.totalPlayersMissing===8})()");
  await expect("full starters without FLEX are incomplete","(()=>{const ps=['TOP','JNG','MID','ADC','SUP'].map((r,i)=>({id:'p'+i,position:r,role:r,slot:r}));const v=validateRoster(ps,{bench:1});return !v.isComplete&&v.missingStarterSlots===0&&v.missingFlexSlots===1&&v.missingBenchSlots===1})()");
  await expect("full lineup with FLEX but short bench is incomplete","(()=>{const ps=['TOP','JNG','MID','ADC','SUP'].map((r,i)=>({id:'p'+i,position:r,role:r,slot:r}));ps.push({id:'f',position:'ADC',role:'ADC',slot:'FLEX'});const v=validateRoster(ps,{bench:2});return !v.isComplete&&v.missingFlexSlots===0&&v.missingBenchSlots===2})()");
  await expect("complete FLEX roster validates","(()=>{const ps=['TOP','JNG','MID','ADC','SUP'].map((r,i)=>({id:'p'+i,position:r,role:r,slot:r}));ps.push({id:'f',position:'ADC',role:'ADC',slot:'FLEX'},{id:'b1',position:'TOP',role:'BN',slot:'BN'},{id:'b2',position:'MID',role:'BN',slot:'BN'});const v=validateRoster(ps,{bench:2});return v.isComplete&&v.totalPlayersMissing===0})()");
  await expect("bench warning uses singular grammar","(()=>{const v={isComplete:false,missingStarterSlots:0,missingStarterPositions:[],missingFlexSlots:0,missingBenchSlots:1,requiredBenchSize:2};return rosterStatusText(v).includes('1 Bench Player')&&!rosterStatusText(v).includes('1 Bench Players')})()");
  await expect("bench warning uses plural grammar","(()=>{const v={isComplete:false,missingStarterSlots:0,missingStarterPositions:[],missingFlexSlots:0,missingBenchSlots:2,requiredBenchSize:2};return rosterStatusText(v).includes('2 Bench Players')})()");
  await expect("draft assignment creates FLEX before bench","(()=>{const p=[{pick_number:1,role:'TOP'},{pick_number:2,role:'JNG'},{pick_number:3,role:'MID'},{pick_number:4,role:'ADC'},{pick_number:5,role:'SUP'},{pick_number:6,role:'ADC'},{pick_number:7,role:'TOP'}];const a=draftAssignments(p);return a[5].slot==='FLEX'&&a[6].slot==='BN'})()");
  await expect("FLEX eligibility is centralized","isFlexEligible({position:'ADC'})===true && isFlexEligible({position:'COACH'})===false");

  await expect("league entry choices exist","(()=>{const t=document.querySelector('#league-template');return !!t?.content.querySelector('[data-jump=\"create-league\"]')&&!!t.content.querySelector('[data-jump=\"join-league\"]')&&!!t.content.querySelector('[data-jump=\"bot-league\"]')})()");
  await expect("join route is dedicated","(()=>{const t=document.querySelector('#join-league-template');return !!t?.content.querySelector('#joinLeagueCode')&&!t.content.querySelector('#createLeagueName')})()");
  await expect("bot league offers sizes one through ten","(()=>{const t=document.querySelector('#bot-league-template');const values=[...t.content.querySelectorAll('[data-bot-size]')].map(x=>Number(x.dataset.botSize));return values.length===10&&values.every((v,i)=>v===i+1)})()");

  await route("draft");
  await expect("draft room renders","document.title.includes('Draft Room') && !!document.querySelector('#draftPlayerList')");
  await expect("draft page fits mobile viewport","document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");

  await route("matchup");
  await expect("matchup uses real scoring surface","!!document.querySelector('#matchupScoreList') && !document.body.innerText.includes('Fantasy scoring is not live yet')");
  await expect("matchup fits mobile viewport","document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");

  await route("schedule");
  await evaluate("document.querySelector('[data-day=today]').click()");
  await expect("schedule filter works","document.querySelector('[data-day=today]').classList.contains('active')");
  await expect("schedule fits mobile viewport","document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");

  const visualRoutes=["home","players","team","league","transactions","trade","draft","matchup","schedule","account"];
  const viewports=[
    {name:"small-phone",width:320,height:700,mobile:true},
    {name:"phone",width:390,height:844,mobile:true},
    {name:"tablet",width:768,height:1024,mobile:true},
    {name:"small-desktop",width:1024,height:768,mobile:false},
    {name:"desktop",width:1440,height:1000,mobile:false}
  ];

  const noOverflowExpression=`(()=>{
    const vw=document.documentElement.clientWidth;
    const offenders=[...document.querySelectorAll('body *')].filter(el=>{
      const cs=getComputedStyle(el);
      if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0)return false;
      const r=el.getBoundingClientRect();
      if(!r.width&&!r.height)return false;
      if(r.right>vw+1||r.left<-1)return true;
      const scrollX=el.scrollWidth-el.clientWidth;
      const scrollY=el.scrollHeight-el.clientHeight;
      const text=(el.textContent||'').trim();
      const isScrollable=['auto','scroll'].includes(cs.overflowX);
      return !!text && scrollX>2 && !isScrollable;
    });
    window.__visualOffenders=offenders.slice(0,10).map(el=>({
      tag:el.tagName,id:el.id,cls:el.className,
      text:(el.textContent||'').trim().slice(0,80),
      scrollWidth:el.scrollWidth,clientWidth:el.clientWidth
    }));
    return offenders.length===0 && document.documentElement.scrollWidth<=vw+1;
  })()`;

  for(const vp of viewports){
    await send("Emulation.setDeviceMetricsOverride",{
      width:vp.width,height:vp.height,deviceScaleFactor:1,mobile:vp.mobile
    });
    for(const visualRoute of visualRoutes){
      await route(visualRoute);
      await expect(vp.name+" "+visualRoute+" has no horizontal/text overflow",noOverflowExpression,7000);
    }
  }

  await send("Emulation.setDeviceMetricsOverride",{width:320,height:700,deviceScaleFactor:1,mobile:true});
  await route("players");
  await evaluate(`(()=>{
    const row=document.querySelector('#freeAgentList .player-row');
    if(!row)return;
    const strong=row.querySelector('strong');
    const small=row.querySelector('small');
    if(strong)strong.textContent='ExtremelyLongProfessionalPlayerNameThatMustStayInsideThePlayerCard';
    if(small)small.textContent='Extremely Long Professional Esports Team Name That Must Wrap Correctly Without Breaking Layout';
  })()`);
  await expect("long player/team text stays contained",noOverflowExpression);

  await route("league");
  await evaluate(`(()=>{
    const btn=document.querySelector('[data-jump="create-league"]');
    if(btn)btn.textContent='Create A League With A Very Long Action Label That Must Remain Inside The Button';
  })()`);
  await expect("long button text stays contained",noOverflowExpression);

  await route("account");
  await expect("account remains usable at 320px","document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");

  await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await route("team");
  await expect("team fits desktop viewport","document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");
  await route("draft");
  await expect("draft fits desktop viewport","document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");

  ws.close();
  console.log("All interaction tests passed.");
} finally {
  cleanup();
}
