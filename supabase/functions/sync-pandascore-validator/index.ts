import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPECTED_TOKEN_SHA256="27668aa7340953f582156c4d0c170f373991225ea64b9e39a1ae4faa4ee19885";
async function sha256(value:string){
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
const norm=(v:any)=>String(v||"").toLowerCase().replace(/[^a-z0-9]/g,"");
const sameTeam=(a:any,b:any)=>{
  const x=norm(a),y=norm(b);
  return !!x&&!!y&&(x===y||(x.length>4&&y.length>4&&(x.includes(y)||y.includes(x))));
};

Deno.serve(async(req)=>{
  const token=req.headers.get("x-sync-token")||"";
  if(!token||await sha256(token)!==EXPECTED_TOKEN_SHA256){
    return new Response(JSON.stringify({error:"Unauthorized"}),{status:401,headers:{"content-type":"application/json"}});
  }

  const supabaseUrl=Deno.env.get("SUPABASE_URL")!;
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const pandaToken=Deno.env.get("PANDASCORE_API_TOKEN")||"";
  const supabase=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}});
  const now=new Date().toISOString();

  const updateHealth=async(ok:boolean,details:any,error:any=null)=>{
    const {data:prev}=await supabase.from("data_source_health")
      .select("last_success_at,consecutive_errors").eq("source","pandascore").maybeSingle();
    const enabled=!!pandaToken;
    await supabase.from("data_source_health").upsert({
      source:"pandascore",
      status:enabled?(ok?"healthy":(prev?.last_success_at?"delayed":"error")):"unknown",
      last_attempt_at:now,
      last_success_at:enabled&&ok?now:(prev?.last_success_at||null),
      last_error_at:enabled&&!ok?now:null,
      consecutive_errors:enabled?(ok?0:(Number(prev?.consecutive_errors)||0)+1):0,
      last_error:enabled&&!ok?String(error instanceof Error?error.message:error||"Unknown error").slice(0,500):null,
      details:{
        role:"independent schedule/result validator",
        authority:"validation_only",
        enabled,
        ...details
      },
      updated_at:now
    },{onConflict:"source"});
  };

  if(!pandaToken){
    await updateHealth(true,{configured:false});
    return new Response(JSON.stringify({ok:true,configured:false}),{headers:{"content-type":"application/json"}});
  }

  try{
    const fetchList=async(path:string)=>{
      const res=await fetch("https://api.pandascore.co"+path,{
        headers:{accept:"application/json",authorization:"Bearer "+pandaToken},
        signal:AbortSignal.timeout(15000)
      });
      if(!res.ok)throw new Error("PandaScore HTTP "+res.status);
      const body=await res.json();
      return Array.isArray(body)?body:[];
    };

    const [upcoming,past,running]=await Promise.all([
      fetchList("/lol/matches/upcoming?page[size]=50"),
      fetchList("/lol/matches/past?page[size]=50"),
      fetchList("/lol/matches/running?page[size]=50")
    ]);
    const remote=[...running,...upcoming,...past];

    const parsed=remote.map((m:any)=>({
      id:m?.id,
      beginAt:m?.begin_at?new Date(m.begin_at):null,
      status:String(m?.status||"").toLowerCase(),
      winnerId:m?.winner_id??m?.winner?.id??null,
      team1:m?.opponents?.[0]?.opponent?.name||m?.opponents?.[0]?.name||"",
      team2:m?.opponents?.[1]?.opponent?.name||m?.opponents?.[1]?.name||"",
      winnerName:m?.winner?.name||""
    })).filter((m:any)=>m.beginAt&&!Number.isNaN(m.beginAt.getTime())&&m.team1&&m.team2);

    const minTime=new Date(Date.now()-14*86400000).toISOString();
    const maxTime=new Date(Date.now()+30*86400000).toISOString();
    const {data:local,error}=await supabase.from("pro_matches")
      .select("id,start_time,team_a_name,team_a_code,team_b_name,team_b_code,status")
      .gte("start_time",minTime).lt("start_time",maxTime);
    if(error)throw error;

    let verified=0;
    let checked=0;
    let scheduleMismatches=0;
    for(const m of (local||[])){
      const mt=Date.parse(m.start_time||"");
      if(!Number.isFinite(mt))continue;
      checked++;
      const hit=parsed.find((p:any)=>{
        const pt=p.beginAt.getTime();
        if(Math.abs(pt-mt)>12*60*60*1000)return false;
        const forward=(sameTeam(p.team1,m.team_a_name)||sameTeam(p.team1,m.team_a_code))
          &&(sameTeam(p.team2,m.team_b_name)||sameTeam(p.team2,m.team_b_code));
        const reverse=(sameTeam(p.team2,m.team_a_name)||sameTeam(p.team2,m.team_a_code))
          &&(sameTeam(p.team1,m.team_b_name)||sameTeam(p.team1,m.team_b_code));
        return forward||reverse;
      });
      if(hit)verified++; else scheduleMismatches++;
    }

    const ratio=checked?verified/checked:1;
    if(checked>=10&&ratio<0.5){
      const since=new Date(Date.now()-6*60*60*1000).toISOString();
      const {count}=await supabase.from("data_anomalies")
        .select("id",{count:"exact",head:true})
        .eq("category","third_source_schedule_mismatch")
        .eq("status","open")
        .gte("detected_at",since);
      if(!count){
        await supabase.from("data_anomalies").insert({
          severity:"warning",
          category:"third_source_schedule_mismatch",
          entity_type:"data_source",
          entity_id:"pandascore",
          details:{checked,verified,schedule_mismatches:scheduleMismatches,verification_ratio:Number(ratio.toFixed(3))}
        });
      }
    }

    await updateHealth(true,{
      configured:true,
      remote_matches:parsed.length,
      local_matches_checked:checked,
      verified_matches:verified,
      schedule_mismatches:scheduleMismatches,
      verification_ratio:Number(ratio.toFixed(3)),
      scope:"fixtures_only"
    });

    return new Response(JSON.stringify({ok:true,configured:true,checked,verified}),{
      headers:{"content-type":"application/json"}
    });
  }catch(err){
    await updateHealth(false,{configured:true},err);
    return new Response(JSON.stringify({ok:false,error:"validator_failed"}),{
      status:500,headers:{"content-type":"application/json"}
    });
  }
});