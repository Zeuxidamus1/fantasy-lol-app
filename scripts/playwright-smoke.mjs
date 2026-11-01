import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {chromium} from "playwright";

const PORT=4179;
const server=spawn("python3",["-m","http.server",String(PORT),"--bind","127.0.0.1"],{stdio:"ignore"});
let browser;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const base="http://127.0.0.1:"+PORT;
const results=[];
const test=async(name,fn)=>{
  await fn();results.push(name);console.log("PASS",name);
};
try{
  for(let i=0;i<60;i++){
    try{const r=await fetch(base);if(r.ok)break;}catch{}
    if(i===59)throw new Error("Local HTTP server unavailable");
    await delay(200);
  }
  browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  for(const device of [
    {name:"phone",width:390,height:844},
    {name:"small-phone",width:320,height:700},
    {name:"desktop",width:1440,height:900}
  ]){
    const context=await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:1});
    const page=await context.newPage();
    const runtime=[];
    page.on("pageerror",error=>runtime.push(String(error)));
    await page.goto(base+"/index.html",{waitUntil:"domcontentloaded"});
    await test(device.name+": login screen available",async()=>{
      await page.locator("#landingEmail").waitFor({state:"visible",timeout:15000});
      assert.equal(await page.title(),"Rift Fantasy");
      assert.ok(await page.locator("#landingSignIn").isVisible());
    });
    await test(device.name+": login page fits viewport",async()=>{
      const m=await page.evaluate(()=>({w:document.documentElement.clientWidth,s:document.documentElement.scrollWidth}));
      assert.ok(m.s<=m.w+1,JSON.stringify(m));
    });
    await test(device.name+": create-account entry works",async()=>{
      await page.locator("#landingCreateAccount").click();
      await page.locator(".signup-screen").waitFor({state:"visible",timeout:5000});
      await page.goBack({waitUntil:"domcontentloaded"}).catch(()=>{});
      await page.goto(base+"/index.html",{waitUntil:"domcontentloaded"});
      await page.locator("#landingEmail").waitFor({state:"visible",timeout:5000});
    });
    await test(device.name+": legal navigation works",async()=>{
      await page.locator('[data-jump="terms"]').first().click();
      await page.waitForTimeout(100);
      assert.ok((await page.locator("main#app").innerText()).length>30);
      await page.goto(base+"/index.html",{waitUntil:"domcontentloaded"});
    });
    await test(device.name+": critical browser exceptions",async()=>{
      assert.deepEqual(runtime.filter(x=>!x.includes("NetworkError")),[],JSON.stringify(runtime));
    });
    await context.close();
  }
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const replay=await context.newPage();
  await replay.goto(base+"/season-replay.html",{waitUntil:"domcontentloaded"});
  await test("historical replay starts at standard playoff format",async()=>{
    await replay.locator("#bracket .item").first().waitFor({state:"visible"});
    assert.match(await replay.locator("#bracket").innerText(),/Championship/);
    assert.doesNotMatch(await replay.locator("#bracket").innerText(),/Semifinal/);
  });
  await test("replay blocks unfair historical calendar",async()=>{
    await replay.locator('[data-mode="calendar"]').click();
    assert.match(await replay.locator("#summary").innerText(),/BLOCKED/);
    assert.match(await replay.locator("#bracket").innerText(),/No championship/);
  });
  await test("optional playoff bracket reveals semifinals",async()=>{
    await replay.locator('[data-mode="synchronized"]').click();
    assert.match(await replay.locator("#bracket").innerText(),/Semifinal/);
  });
  await test("hypothetical roster replacement labeled",async()=>{
    await replay.locator('[data-mode="emergencyReplacement"]').click();
    assert.match(await replay.locator("#summary").innerText(),/HYPOTHETICAL EVENT/);
    assert.match(await replay.locator("#rosters").innerText(),/Canna/);
  });
  await test("replay mobile page fits viewport",async()=>{
    const m=await replay.evaluate(()=>({w:document.documentElement.clientWidth,s:document.documentElement.scrollWidth}));
    assert.ok(m.s<=m.w+1,JSON.stringify(m));
  });
  await context.close();
  console.log("PLAYWRIGHT PASS: "+results.length+" browser checks.");
}catch(error){
  console.error("PLAYWRIGHT FAIL after "+results.length+" checks",error);
  process.exitCode=1;
}finally{
  await browser?.close().catch(()=>{});
  server.kill();
}
