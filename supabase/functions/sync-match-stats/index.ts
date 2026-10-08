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
function normalizeName(v:any){return String(v||"").toLowerCase().replace(/[^a-z0-9]/g,"");}
function parseCsvLine(line:string){
  const out:string[]=[];
  let field="",quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(quoted){
      if(ch==='"'&&line[i+1]==='"'){field+='"';i++;}
      else if(ch==='"')quoted=false;
      else field+=ch;
    }else{
      if(ch==='"')quoted=true;
      else if(ch===','){out.push(field);field="";}
      else field+=ch;
    }
  }
  out.push(field);
  return out;
}
async function loadChainccRows(targetDates:Set<string>){
  const year=new Date().getUTCFullYear();
  const url=`https://chaincc.lol/data/chaincc-players-${year}.csv.gz`;
  const res=await fetch(url,{headers:{
    "user-agent":"Mozilla/5.0",
    "referer":"https://chaincc.lol/free/data",
    "accept":"application/gzip, application/octet-stream;q=0.9, */*;q=0.8"
  },signal:AbortSignal.timeout(30000)});
  if(!res.ok)throw new Error("ChainCC download failed: "+res.status);
  const stream=res.body?.pipeThrough(new DecompressionStream("gzip"));
  if(!stream)throw new Error("ChainCC gzip stream unavailable");
  const text=await new Response(stream).text();
  const lines=text.split(/\r?\n/);
  if(lines.length<2)return [];
  const headers=parseCsvLine(lines[0]).map(h=>h.trim().toLowerCase());
  const ix=(name:string)=>headers.indexOf(name);
  const idx={
    game:ix("game_id"),date:ix("date"),league:ix("league"),
    team:ix("team_name"),opp:ix("opponent_team_name"),
    player:ix("playername"),result:ix("result"),
    kills:ix("kills"),deaths:ix("deaths"),assists:ix("assists"),
    cs:ix("total_cs"),fb:ix("firstbloodkill")
  };
  const rows:any[]=[];
  for(let i=1;i<lines.length;i++){
    const line=lines[i];
    if(!line)continue;
    const values=parseCsvLine(line);
    const date=idx.date>=0?String(values[idx.date]||"").slice(0,10):"";
    if(!targetDates.has(date))continue;
    const bool=(v:any)=>{
      const x=String(v||"").trim().toLowerCase();
      if(x==="true"||x==="1")return true;
      if(x==="false"||x==="0")return false;
      return null;
    };
    rows.push({
      gameId:idx.game>=0?values[idx.game]:null,
      date,
      league:idx.league>=0?values[idx.league]:null,
      team:idx.team>=0?values[idx.team]:null,
      opponent:idx.opp>=0?values[idx.opp]:null,
      player:idx.player>=0?values[idx.player]:null,
      result:idx.result>=0?bool(values[idx.result]):null,
      firstBlood:idx.fb>=0?bool(values[idx.fb]):null,
      kills:idx.kills>=0?Number(values[idx.kills]):null,
      deaths:idx.deaths>=0?Number(values[idx.deaths]):null,
      assists:idx.assists>=0?Number(values[idx.assists]):null,
      cs:idx.cs>=0?Number(values[idx.cs]):null
    });
  }
  return rows;
}
function findChainccStat(chainRows:any[],playerName:string,kills:number,deaths:number,assists:number,cs:number){
  const nameKey=normalizeName(playerName);
  const candidates=chainRows.filter(r=>
    normalizeName(r.player)===nameKey &&
    Number(r.kills)===Number(kills) &&
    Number(r.deaths)===Number(deaths) &&
    Number(r.assists)===Number(assists) &&
    Number(r.cs)===Number(cs)
  );
  return candidates.length===1?candidates[0]:null;
}

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
      const detailsNoTime=await liveDetails(gameId);
      const detailsAround=body?.startingTime?await liveDetails(gameId,String(body.startingTime)):null;
      const summarize=(payload:any)=>{
        const rawFrames=payload?.frames||[];
        const lf=rawFrames.at(-1)||{};
        const firstParticipant=(lf?.participants||[])[0]||{};
        return {
        gameId:payload?.esportsGameId||null,
        matchId:payload?.esportsMatchId||null,
        topLevelKeys:Object.keys(payload||{}),
        metadata:payload?.gameMetadata||null,
        lastFrameKeys:Object.keys(lf),
        lastBlueKeys:Object.keys(lf?.blueTeam||{}),
        lastRedKeys:Object.keys(lf?.redTeam||{}),
        lastParticipantKeys:Object.keys(firstParticipant),
        lastParticipantSample:firstParticipant,
        frames:rawFrames.map((f:any)=>({
          ts:f.rfc460Timestamp,
          state:f.gameState,
          blueKills:f.blueTeam?.totalKills,
          redKills:f.redTeam?.totalKills,
          blueParticipants:(f.blueTeam?.participants||[]).map((p:any)=>({id:p.participantId,k:p.kills,d:p.deaths,a:p.assists,cs:p.creepScore})),
          redParticipants:(f.redTeam?.participants||[]).map((p:any)=>({id:p.participantId,k:p.kills,d:p.deaths,a:p.assists,cs:p.creepScore}))
        }))
      }};
      return new Response(JSON.stringify({
        noTime:summarize(noTime),
        aroundMatch:aroundMatch?summarize(aroundMatch):null,
        detailsNoTime:summarize(detailsNoTime),
        detailsAround:detailsAround?summarize(detailsAround):null
      }),{headers:{"content-type":"application/json"}});
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

    const chainDates=new Set<string>();
    for(const m of (matches||[])){
      const t=Date.parse(m.start_time||"");
      if(Number.isFinite(t)){
        for(const delta of [-1,0,1]){
          chainDates.add(new Date(t+delta*86400000).toISOString().slice(0,10));
        }
      }
    }
    let chainRows:any[]|null=null;
    const getChainRows=async()=>{
      if(chainRows!==null)return chainRows;
      try{chainRows=await loadChainccRows(chainDates);}catch(err){
        console.warn("ChainCC enrichment unavailable",err);
        chainRows=[];
      }
      return chainRows;
    };

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
          .select("id,stats_status,winner_team_id,first_blood_status,state")
          .eq("match_id",match.id);
        const finalizedGameIds=new Set((existingGameRows||[])
          .filter((g:any)=>
            g.stats_status==="final" &&
            (
              String(g.state||"").toLowerCase()==="unneeded" ||
              (!!g.winner_team_id && g.first_blood_status==="final")
            )
          )
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

          const normalizedGameState=gameState.toLowerCase();
          const baseGameRow:any={
            id:gameId,
            match_id:match.id,
            game_number:Number(game?.number)||null,
            state:gameState,
            blue_team_id:blueSide?.id||null,
            red_team_id:redSide?.id||null,
            updated_at:new Date().toISOString()
          };
          if(normalizedGameState==="unneeded"){
            baseGameRow.stats_status="final";
            baseGameRow.first_blood_status="unavailable";
            baseGameRow.ingest_error=null;
          }
          await supabase.from("pro_games").upsert(baseGameRow,{onConflict:"id"});

          const isCompleted=normalizedGameState==="completed";
          const isLive=["inprogress","in_progress","in progress"].includes(normalizedGameState);
          if(!isCompleted&&!isLive)continue;
          if(isCompleted&&finalizedGameIds.has(gameId)){finalGames++;continue;}

          const matchStart=Date.parse(match.start_time||"");
          const lookupTime=isCompleted
            ? new Date((Number.isFinite(matchStart)?matchStart:Date.now())+12*60*60*1000).toISOString()
            : undefined;
          const [windowPayload,detailsPayload]=await Promise.all([
            liveWindow(gameId,lookupTime),
            liveDetails(gameId,lookupTime)
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
          let firstBloodId:any=null;

          let winnerTeamId:any=null;
          let winnerSource:any=null;
          for(const t of (game?.teams||[])){
            const outcome=String(t?.result?.outcome||t?.outcome||"").toLowerCase();
            if(["win","won","victory"].includes(outcome)){winnerTeamId=String(t.id);winnerSource="riot_lolesports";}
          }
          if(!winnerTeamId && games.length===1){
            for(const t of (evt?.match?.teams||[])){
              const outcome=String(t?.result?.outcome||"").toLowerCase();
              if(["win","won","victory"].includes(outcome)){winnerTeamId=String(t.id);winnerSource="riot_lolesports";}
            }
          }

          const rows:any[]=[];
          const unmapped:string[]=[];
          const chaincc=isCompleted?await getChainRows():[];
          if(!isCompleted){
            firstBloodId=await firstBloodParticipant(gameId);
          }
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
            const k=Number(stat.kills)||0;
            const d=Number(stat.deaths)||0;
            const a=Number(stat.assists)||0;
            const cs=Number(stat.creepScore)||0;
            const chainStat=isCompleted?findChainccStat(chaincc,String(fp.name||meta.summonerName||""),k,d,a,cs):null;
            if(chainStat?.firstBlood===true)firstBloodId=participantId;
            const rowWin=isCompleted?(winnerTeamId?teamId===winnerTeamId:(chainStat?.result??null)):null;
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
              kills:k,
              deaths:d,
              assists:a,
              cs,
              win:rowWin,
              first_blood:firstBloodId!==null?Number(participantId)===Number(firstBloodId):(chainStat?.firstBlood??null),
              stats_source:"riot_lolesports",
              result_source:rowWin===null?null:(winnerSource||"chaincc"),
              first_blood_source:firstBloodId!==null?(isCompleted?"chaincc":"riot_lolesports"):(chainStat?.firstBlood===null||chainStat?.firstBlood===undefined?null:"chaincc"),
              total_gold:Number(stat.totalGold)||null,
              total_gold_earned:Number(stat.totalGoldEarned)||null,
              wards_placed:Number(stat.wardsPlaced)||null,
              wards_destroyed:Number(stat.wardsDestroyed)||null,
              kill_participation:Number.isFinite(Number(stat.killParticipation))?Number(stat.killParticipation):null,
              champion_damage_share:Number.isFinite(Number(stat.championDamageShare))?Number(stat.championDamageShare):null,
              source_timestamp:df?.rfc460Timestamp||wf?.rfc460Timestamp||null,
              finalized:isCompleted,
              updated_at:new Date().toISOString()
            });
          }

          if(!winnerTeamId){
            const winnerRow=rows.find(r=>r.win===true);
            if(winnerRow?.team_id){
              winnerTeamId=winnerRow.team_id;
              winnerSource=winnerRow.result_source||"chaincc";
            }
          }
          if(winnerTeamId){
            for(const row of rows){
              if(row.team_id){
                row.win=String(row.team_id)===String(winnerTeamId);
                row.result_source=winnerSource||row.result_source||"chaincc";
              }
            }
          }
          if(firstBloodId===null){
            const fbRow=rows.find(r=>r.first_blood===true);
            if(fbRow)firstBloodId=fbRow.participant_id;
          }
          if(firstBloodId!==null){
            for(const row of rows){
              row.first_blood=Number(row.participant_id)===Number(firstBloodId);
              row.first_blood_source=row.first_blood_source||(isCompleted?"chaincc":"riot_lolesports");
            }
          }

          if(rows.length){
            const {error:statsError}=await supabase.from("player_game_stats").upsert(rows,{onConflict:"game_id,player_id"});
            if(statsError)throw statsError;
          }
          const winComplete=rows.length===10&&rows.every(r=>r.win===true||r.win===false);
          const firstBloodComplete=rows.filter(r=>r.first_blood===true).length===1;
          const complete=isCompleted&&rows.length===10&&unmapped.length===0&&winComplete&&firstBloodComplete;
          const liveComplete=!isCompleted&&rows.length===10&&unmapped.length===0;
          const {error:gameError}=await supabase.from("pro_games").update({
            state:isCompleted?"completed":"inProgress",
            blue_team_id:String(blueMeta?.esportsTeamId||blueSide?.id||"")||null,
            red_team_id:String(redMeta?.esportsTeamId||redSide?.id||"")||null,
            winner_team_id:winnerTeamId,
            patch_version:String(metadata?.patchVersion||"")||null,
            completed_at:isCompleted?(wf?.rfc460Timestamp||null):null,
            source_timestamp:df?.rfc460Timestamp||wf?.rfc460Timestamp||null,
            stats_status:isCompleted?(complete?"final":"error"):(liveComplete?"processing":"error"),
            first_blood_player_id:firstBloodId?String((rows.find(r=>r.participant_id===firstBloodId)||{}).player_id||"")||null:null,
            first_blood_status:firstBloodComplete?"final":"pending",
            stats_ingested_at:new Date().toISOString(),
            ingest_error:(complete||liveComplete)?null:(
              unmapped.length?"Unmapped players: "+unmapped.join(", "):
              rows.length!==10?"Expected 10 player stat rows, received "+rows.length:
              isCompleted&&!winComplete?"Game winner not yet resolved":
              isCompleted&&!firstBloodComplete?"First Blood not yet resolved":
              "Stat ingestion incomplete"
            ),
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