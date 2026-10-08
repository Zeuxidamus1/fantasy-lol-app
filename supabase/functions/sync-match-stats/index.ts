import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const EXPECTED_TOKEN_SHA256="27668aa7340953f582156c4d0c170f373991225ea64b9e39a1ae4faa4ee19885";
const API_KEY="0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z";
const API_BASE="https://esports-api.lolesports.com/persisted/gw";
const LIVE_BASE="https://feed.lolesports.com/livestats/v1";

async function sha256(value:string){
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function jsonFetch(url:string){
  const res=await fetch(url,{headers:{"x-api-key":API_KEY,"accept":"application/json"},signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw new Error(url+" -> "+res.status);
  const body=await res.text();
  if(!body.trim())return {};
  return JSON.parse(body);
}
async function eventDetails(matchId:string){
  const url=new URL(API_BASE+"/getEventDetails");
  url.searchParams.set("hl","en-US");
  url.searchParams.set("id",matchId);
  return await jsonFetch(url.toString());
}
async function liveWindow(gameId:string,startingTime?:string){
  const url=new URL(LIVE_BASE+"/window/"+encodeURIComponent(gameId));
  if(startingTime)url.searchParams.set("startingTime",startingTime);
  return await jsonFetch(url.toString());
}
async function liveDetails(gameId:string,startingTime?:string){
  const url=new URL(LIVE_BASE+"/details/"+encodeURIComponent(gameId));
  if(startingTime)url.searchParams.set("startingTime",startingTime);
  return await jsonFetch(url.toString());
}
function roleMap(role:any){
  const r=String(role||"").toLowerCase();
  return r==="top"?"TOP":r==="jungle"?"JNG":r==="mid"?"MID":r==="bottom"?"ADC":r==="support"?"SUP":null;
}
function lastFrame(frames:any[]){
  return [...(Array.isArray(frames)?frames:[])].sort((a,b)=>Date.parse(a?.rfc460Timestamp||"")-Date.parse(b?.rfc460Timestamp||"")).at(-1)||null;
}
function normalizeId(v:any){return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g,"-");}

async function firstBloodParticipant(gameId:string){
  let payload:any;
  try{payload=await liveWindow(gameId);}catch{return null;}
  let frames=[...(payload?.frames||[])].sort((a:any,b:any)=>Date.parse(a?.rfc460Timestamp||"")-Date.parse(b?.rfc460Timestamp||""));
  if(!frames.length)return null;
  const previous=new Map<number,number>();

  for(let page=0;page<20;page++){
    for(const frame of frames){
      const participants=[...(frame?.blueTeam?.participants||[]),...(frame?.redTeam?.participants||[])];
      const before=[...previous.values()].reduce((sum,n)=>sum+n,0);
      for(const p of participants){
        const id=Number(p.participantId);
        const kills=Number(p.kills)||0;
        const prior=previous.get(id)||0;
        if(before===0&&kills>prior)return id;
      }
      for(const p of participants)previous.set(Number(p.participantId),Number(p.kills)||0);
      if(frame?.gameState==="finished")return null;
    }
    const last=frames.at(-1);
    const t=Date.parse(last?.rfc460Timestamp||"");
    if(!Number.isFinite(t))return null;
    try{
      payload=await liveWindow(gameId,new Date(t+60*1000).toISOString());
    }catch{
      return null;
    }
    frames=[...(payload?.frames||[])].sort((a:any,b:any)=>Date.parse(a?.rfc460Timestamp||"")-Date.parse(b?.rfc460Timestamp||""));
    if(!frames.length)return null;
  }
  return null;
}

Deno.serve(async(req:Request)=>{
  try{
    const token=req.headers.get("x-sync-token")||"";
    if(!token||await sha256(token)!==EXPECTED_TOKEN_SHA256){
      return new Response(JSON.stringify({error:"Unauthorized"}),{status:401,headers:{"content-type":"application/json"}});
    }
    const body=await req.json().catch(()=>({}));
    const supabaseUrl=Deno.env.get("SUPABASE_URL");
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!supabaseUrl||!serviceKey)throw new Error("Supabase service credentials unavailable");
    const supabase=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}});

    if(body?.debugMatch){
      const event=await eventDetails(String(body.debugMatch));
      const match=event?.data?.event?.match||{};
      return new Response(JSON.stringify({
        id:event?.data?.event?.id||null,
        state:event?.data?.event?.state||null,
        teams:match?.teams||[],
        games:(match?.games||[]).map((g:any)=>({id:g.id,state:g.state,number:g.number,teams:g.teams,vods:g.vods?.length||0}))
      }),{headers:{"content-type":"application/json"}});
    }

    if(body?.debugGame){
      const gameId=String(body.debugGame);
      const noTime=await liveWindow(gameId);
      const aroundMatch=body?.startingTime?await liveWindow(gameId,String(body.startingTime)):null;
      const summarize=(payload:any)=>{
        const rawFrames=payload?.frames||[];
        const lf=rawFrames.at(-1)||{};
        return {
        gameId:payload?.esportsGameId||null,
        matchId:payload?.esportsMatchId||null,
        metadata:payload?.gameMetadata||null,
        lastFrameKeys:Object.keys(lf),
        lastBlueKeys:Object.keys(lf?.blueTeam||{}),
        lastRedKeys:Object.keys(lf?.redTeam||{}),
        frames:rawFrames.map((f:any)=>({
          ts:f.rfc460Timestamp,
          state:f.gameState,
          blueKills:f.blueTeam?.totalKills,
          redKills:f.redTeam?.totalKills,
          blueParticipants:(f.blueTeam?.participants||[]).map((p:any)=>({id:p.participantId,k:p.kills,d:p.deaths,a:p.assists,cs:p.creepScore})),
          redParticipants:(f.redTeam?.participants||[]).map((p:any)=>({id:p.participantId,k:p.kills,d:p.deaths,a:p.assists,cs:p.creepScore}))
        }))
      }};
      return new Response(JSON.stringify({noTime:summarize(noTime),aroundMatch:aroundMatch?summarize(aroundMatch):null}),{headers:{"content-type":"application/json"}});
    }

    let query=supabase.from("pro_matches")
      .select("id,competition,start_time,status,team_a_id,team_b_id")
      .lte("start_time",new Date().toISOString())
      .in("status",["COMPLETED","INPROGRESS","IN_PROGRESS"])
      .order("start_time",{ascending:false})
      .limit(Math.max(1,Math.min(20,Number(body?.limit)||8)));
    if(body?.matchId)query=query.eq("id",String(body.matchId));
    const {data:matches,error:matchError}=await query;
    if(matchError)throw matchError;

    const {data:players,error:playerError}=await supabase
      .from("fantasy_players")
      .select("id,name,team_id,role");
    if(playerError)throw playerError;
    const byId=new Map((players||[]).map((p:any)=>[String(p.id),p]));
    const byTeamName=new Map((players||[]).map((p:any)=>[String(p.team_id||"")+"|"+String(p.name||"").toLowerCase(),p]));

    const summary:any[]=[];
    for(const match of (matches||[])){
      try{
        const event=await eventDetails(match.id);
        const evt=event?.data?.event;
        const games=evt?.match?.games||[];

        const {data:existingGameRows}=await supabase
          .from("pro_games")
          .select("id,stats_status")
          .eq("match_id",match.id);
        const finalizedGameIds=new Set((existingGameRows||[])
          .filter((g:any)=>g.stats_status==="final")
          .map((g:any)=>String(g.id)));

        const seriesTeams=Array.isArray(evt?.match?.teams)?evt.match.teams:[];
        const seriesA=seriesTeams.find((t:any)=>String(t.id)===String(match.team_a_id))||seriesTeams[0]||null;
        const seriesB=seriesTeams.find((t:any)=>String(t.id)===String(match.team_b_id))||seriesTeams[1]||null;
        const aWins=Number(seriesA?.result?.gameWins);
        const bWins=Number(seriesB?.result?.gameWins);
        const seriesWinner=Number.isFinite(aWins)&&Number.isFinite(bWins)&&aWins!==bWins
          ? String((aWins>bWins?seriesA:seriesB)?.id||"")||null
          : null;
        if(Number.isFinite(aWins)||Number.isFinite(bWins)||seriesWinner){
          await supabase.from("pro_matches").update({
            team_a_game_wins:Number.isFinite(aWins)?aWins:null,
            team_b_game_wins:Number.isFinite(bWins)?bWins:null,
            winner_team_id:seriesWinner,
            result_finalized_at:String(match.status).toUpperCase()==="COMPLETED"?new Date().toISOString():null,
            updated_at:new Date().toISOString()
          }).eq("id",match.id);
        }

        let finalGames=0;
        for(const game of games){
          const gameId=String(game?.id||"");
          if(!gameId)continue;
          const gameState=String(game?.state||"unstarted");
          const blueSide=(game?.teams||[]).find((t:any)=>String(t.side).toLowerCase()==="blue");
          const redSide=(game?.teams||[]).find((t:any)=>String(t.side).toLowerCase()==="red");

          await supabase.from("pro_games").upsert({
            id:gameId,
            match_id:match.id,
            game_number:Number(game?.number)||null,
            state:gameState,
            blue_team_id:blueSide?.id||null,
            red_team_id:redSide?.id||null,
            updated_at:new Date().toISOString()
          },{onConflict:"id"});

          if(gameState.toLowerCase()!=="completed")continue;
          if(finalizedGameIds.has(gameId)){finalGames++;continue;}

          const matchStart=Date.parse(match.start_time||"");
          const finalLookupTime=new Date((Number.isFinite(matchStart)?matchStart:Date.now())+12*60*60*1000).toISOString();
          const [windowPayload,detailsPayload]=await Promise.all([
            liveWindow(gameId,finalLookupTime),
            liveDetails(gameId,finalLookupTime)
          ]);
          const wf=lastFrame(windowPayload?.frames||[]);
          const df=lastFrame(detailsPayload?.frames||[]);
          if(!wf||!df)throw new Error("Finished frames unavailable for game "+gameId);

          const metadata=windowPayload?.gameMetadata||{};
          const blueMeta=metadata?.blueTeamMetadata||{};
          const redMeta=metadata?.redTeamMetadata||{};
          const metaPlayers=[
            ...(blueMeta?.participantMetadata||[]).map((p:any)=>({...p,teamId:String(blueMeta?.esportsTeamId||blueSide?.id||"")})),
            ...(redMeta?.participantMetadata||[]).map((p:any)=>({...p,teamId:String(redMeta?.esportsTeamId||redSide?.id||"")}))
          ];
          const metaByParticipant=new Map(metaPlayers.map((p:any)=>[Number(p.participantId),p]));
          const statByParticipant=new Map((df?.participants||[]).map((p:any)=>[Number(p.participantId),p]));
          const firstBloodId=await firstBloodParticipant(gameId);

          let winnerTeamId:any=null;
          for(const t of (game?.teams||[])){
            const outcome=String(t?.result?.outcome||t?.outcome||"").toLowerCase();
            if(["win","won","victory"].includes(outcome))winnerTeamId=String(t.id);
          }
          if(!winnerTeamId && games.length===1){
            for(const t of (evt?.match?.teams||[])){
              const outcome=String(t?.result?.outcome||"").toLowerCase();
              if(["win","won","victory"].includes(outcome))winnerTeamId=String(t.id);
            }
          }

          const rows:any[]=[];
          const unmapped:string[]=[];
          for(const [participantId,meta] of metaByParticipant){
            const stat:any=statByParticipant.get(participantId);
            if(!stat)continue;
            const rawPlayerId=String(meta?.esportsPlayerId||"");
            let fp:any=rawPlayerId?byId.get(normalizeId(rawPlayerId)):null;
            if(!fp)fp=byTeamName.get(String(meta.teamId||"")+"|"+String(meta.summonerName||"").toLowerCase());
            if(!fp){unmapped.push(String(meta.summonerName||participantId));continue;}
            const teamId=String(meta.teamId||"")||null;
            const opponentTeamId=teamId===String(blueMeta?.esportsTeamId||blueSide?.id||"")
              ? String(redMeta?.esportsTeamId||redSide?.id||"")||null
              : String(blueMeta?.esportsTeamId||blueSide?.id||"")||null;
            rows.push({
              game_id:gameId,
              match_id:match.id,
              player_id:fp.id,
              participant_id:participantId,
              team_id:teamId,
              opponent_team_id:opponentTeamId,
              role:roleMap(meta.role)||fp.role,
              summoner_name:String(meta.summonerName||fp.name),
              champion_id:String(meta.championId||"")||null,
              kills:Number(stat.kills)||0,
              deaths:Number(stat.deaths)||0,
              assists:Number(stat.assists)||0,
              cs:Number(stat.creepScore)||0,
              win:winnerTeamId?teamId===winnerTeamId:null,
              first_blood:firstBloodId===null?null:firstBloodId===participantId,
              total_gold:Number(stat.totalGold)||null,
              total_gold_earned:Number(stat.totalGoldEarned)||null,
              wards_placed:Number(stat.wardsPlaced)||null,
              wards_destroyed:Number(stat.wardsDestroyed)||null,
              kill_participation:Number.isFinite(Number(stat.killParticipation))?Number(stat.killParticipation):null,
              champion_damage_share:Number.isFinite(Number(stat.championDamageShare))?Number(stat.championDamageShare):null,
              source_timestamp:df?.rfc460Timestamp||wf?.rfc460Timestamp||null,
              finalized:true,
              updated_at:new Date().toISOString()
            });
          }

          if(rows.length){
            const {error:statsError}=await supabase.from("player_game_stats").upsert(rows,{onConflict:"game_id,player_id"});
            if(statsError)throw statsError;
          }
          const complete=rows.length===10&&unmapped.length===0;
          const {error:gameError}=await supabase.from("pro_games").update({
            state:"completed",
            blue_team_id:String(blueMeta?.esportsTeamId||blueSide?.id||"")||null,
            red_team_id:String(redMeta?.esportsTeamId||redSide?.id||"")||null,
            winner_team_id:winnerTeamId,
            patch_version:String(metadata?.patchVersion||"")||null,
            completed_at:wf?.rfc460Timestamp||null,
            source_timestamp:df?.rfc460Timestamp||wf?.rfc460Timestamp||null,
            stats_status:complete?"final":"error",
            first_blood_player_id:firstBloodId?String((rows.find(r=>r.participant_id===firstBloodId)||{}).player_id||"")||null:null,
            first_blood_status:firstBloodId?"final":"unavailable",
            stats_ingested_at:new Date().toISOString(),
            ingest_error:complete?null:(unmapped.length?"Unmapped players: "+unmapped.join(", "):"Expected 10 player stat rows, received "+rows.length),
            updated_at:new Date().toISOString()
          }).eq("id",gameId);
          if(gameError)throw gameError;
          if(complete)finalGames++;
        }
        summary.push({matchId:match.id,games:games.length,finalized:finalGames});
      }catch(err){
        summary.push({matchId:match.id,error:err instanceof Error?err.message:String(err)});
      }
    }

    return new Response(JSON.stringify({ok:true,matches:summary}),{headers:{"content-type":"application/json"}});
  }catch(err){
    return new Response(JSON.stringify({error:err instanceof Error?err.message:String(err)}),{status:500,headers:{"content-type":"application/json"}});
  }
});