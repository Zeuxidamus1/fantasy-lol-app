(function(){
  "use strict";

  const config=window.RIFT_CONFIG||{};
  const base=String(config.supabaseUrl||"").replace(/\/$/,"");
  const anonKey=String(config.supabaseAnonKey||"").trim();
  const SESSION_KEY="riftCloudSession";
  const listeners=new Set();

  const isConfigured=()=>/^https:\/\/.+\.supabase\.co$/i.test(base)&&anonKey.length>20;

  function readSession(){
    try{
      const raw=localStorage.getItem(SESSION_KEY);
      return raw?JSON.parse(raw):null;
    }catch{return null;}
  }

  function writeSession(session){
    try{
      if(session)localStorage.setItem(SESSION_KEY,JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    }catch{}
    listeners.forEach(fn=>{try{fn(session);}catch{}});
  }

  function authHeaders(session,extra={}){
    const token=session?.access_token||anonKey;
    return {
      "apikey":anonKey,
      "Authorization":"Bearer "+token,
      "Content-Type":"application/json",
      ...extra
    };
  }

  async function request(path,{method="GET",body,session=readSession(),headers={}}={}){
    if(!isConfigured())throw new Error("Cloud backend is not configured.");
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const res=await fetch(base+path,{
        method,
        headers:authHeaders(session,headers),
        body:body===undefined?undefined:JSON.stringify(body),
        signal:controller.signal
      });
      const text=await res.text();
      let payload=null;
      try{payload=text?JSON.parse(text):null;}catch{payload=text||null;}
      if(!res.ok){
        const message=payload?.msg||payload?.message||payload?.error_description||payload?.error||("Request failed ("+res.status+")");
        const err=new Error(message);
        err.status=res.status;
        throw err;
      }
      return payload;
    }finally{
      clearTimeout(timer);
    }
  }

  function publicAppUrl(){
    return location.origin + location.pathname;
  }

  function captureAuthCallback(){
    const raw=location.hash.startsWith("#")?location.hash.slice(1):"";
    if(!raw.includes("access_token="))return false;
    const params=new URLSearchParams(raw);
    const access_token=params.get("access_token");
    const refresh_token=params.get("refresh_token");
    const expires_in=Number(params.get("expires_in")||3600);
    const token_type=params.get("token_type")||"bearer";
    const authType=params.get("type")||"";
    if(!access_token||!refresh_token)return false;
    writeSession({
      access_token,
      refresh_token,
      token_type,
      expires_in,
      expires_at:Math.floor(Date.now()/1000)+expires_in
    });
    try{
      if(authType==="recovery")sessionStorage.setItem("riftRecoveryMode","1");
    }catch{}
    if(authType==="recovery"){
      history.replaceState({view:"account",depth:0},"",location.pathname+"#account");
    }else{
      history.replaceState({view:"home",depth:0},"",location.pathname+"#home");
    }
    return true;
  }

  async function signUp(email,password){
    const redirect=encodeURIComponent(publicAppUrl());
    const payload=await request("/auth/v1/signup?redirect_to="+redirect,{method:"POST",body:{email,password},session:null});
    if(payload?.access_token)writeSession(payload);
    return payload;
  }

  async function resendSignup(email){
    const redirect=encodeURIComponent(publicAppUrl());
    return request("/auth/v1/resend?redirect_to="+redirect,{method:"POST",body:{type:"signup",email},session:null});
  }

  async function requestPasswordReset(email){
    const redirect=encodeURIComponent(publicAppUrl());
    return request("/auth/v1/recover?redirect_to="+redirect,{method:"POST",body:{email},session:null});
  }

  async function updatePassword(password){
    const current=await session();
    if(!current)throw new Error("Open the password-reset email link before setting a new password.");
    const payload=await request("/auth/v1/user",{method:"PUT",body:{password},session:current});
    try{sessionStorage.removeItem("riftRecoveryMode");}catch{}
    return payload;
  }

  function isRecoveryMode(){
    try{return sessionStorage.getItem("riftRecoveryMode")==="1";}catch{return false;}
  }

  async function signIn(email,password){
    const payload=await request("/auth/v1/token?grant_type=password",{method:"POST",body:{email,password},session:null});
    writeSession(payload);
    return payload;
  }

  async function refreshSession(){
    const current=readSession();
    if(!current?.refresh_token)return null;
    try{
      const payload=await request("/auth/v1/token?grant_type=refresh_token",{method:"POST",body:{refresh_token:current.refresh_token},session:null});
      writeSession(payload);
      return payload;
    }catch{
      writeSession(null);
      return null;
    }
  }

  async function session(){
    const current=readSession();
    if(!current)return null;
    const expiresAt=Number(current.expires_at||0)*1000;
    if(expiresAt&&expiresAt-Date.now()<60000)return refreshSession();
    return current;
  }

  async function signOut(){
    const current=readSession();
    if(current&&isConfigured()){
      try{await request("/auth/v1/logout",{method:"POST",session:current});}catch{}
    }
    writeSession(null);
  }

  async function currentUser(){
    const current=await session();
    if(!current)return null;
    try{return await request("/auth/v1/user",{session:current});}
    catch{
      const refreshed=await refreshSession();
      if(!refreshed)return null;
      return request("/auth/v1/user",{session:refreshed});
    }
  }

  async function listLeagues(){
    const current=await session();
    if(!current)return [];
    return request("/rest/v1/leagues?select=id,name,invite_code,settings,status,created_at&order=created_at.desc",{session:current});
  }

  async function createLeague(name,settings={}){
    const current=await session();
    if(!current)throw new Error("Sign in before creating a cloud league.");
    return request("/rest/v1/rpc/create_league",{method:"POST",body:{p_name:name,p_settings:settings},session:current});
  }

  async function joinLeague(inviteCode,teamName){
    const current=await session();
    if(!current)throw new Error("Sign in before joining a league.");
    return request("/rest/v1/rpc/join_league",{method:"POST",body:{p_invite_code:String(inviteCode||"").trim().toUpperCase(),p_team_name:String(teamName||"").trim()},session:current});
  }

  async function updateLeagueSettings(leagueId,name,settings){
    const current=await session();
    if(!current)throw new Error("Sign in before changing league settings.");
    return request("/rest/v1/rpc/update_league_settings",{method:"POST",body:{p_league_id:leagueId,p_name:name,p_settings:settings},session:current});
  }

  async function getLeagueDraft(leagueId){
    const current=await session();
    if(!current)return null;
    const rows=await request("/rest/v1/league_drafts?league_id=eq."+encodeURIComponent(leagueId)+"&select=league_id,status,manager_order,current_pick,total_rounds,started_at,updated_at",{session:current});
    return Array.isArray(rows)?(rows[0]||null):rows;
  }

  async function listDraftPicks(leagueId){
    const current=await session();
    if(!current)return [];
    return request("/rest/v1/draft_picks?league_id=eq."+encodeURIComponent(leagueId)+"&select=league_id,pick_number,round_number,user_id,player_id,role,created_at&order=pick_number.asc",{session:current});
  }

  async function startLeagueDraft(leagueId){
    const current=await session();
    if(!current)throw new Error("Sign in before starting the draft.");
    return request("/rest/v1/rpc/start_league_draft",{method:"POST",body:{p_league_id:leagueId},session:current});
  }

  async function makeDraftPick(leagueId,playerId,role){
    const current=await session();
    if(!current)throw new Error("Sign in before drafting.");
    return request("/rest/v1/rpc/make_draft_pick",{method:"POST",body:{p_league_id:leagueId,p_player_id:String(playerId),p_role:String(role)},session:current});
  }

  async function listLeagueMembers(leagueId){
    const current=await session();
    if(!current)return [];
    return request("/rest/v1/league_members?league_id=eq."+encodeURIComponent(leagueId)+"&select=league_id,user_id,role,team_name,joined_at&order=joined_at",{session:current});
  }

  async function listRosters(leagueId){
    const current=await session();
    if(!current)return [];
    return request("/rest/v1/rosters?league_id=eq."+encodeURIComponent(leagueId)+"&select=league_id,user_id,player_id,slot,created_at",{session:current});
  }

  async function saveRoster(leagueId,players){
    const current=await session();
    const userId=current?.user?.id;
    if(!current||!userId)throw new Error("Sign in before syncing a roster.");
    const normalized=(players||[]).map(p=>({
      player_id:String(p.id||p.name||""),
      slot:String(p.slot||p.role||"BN")
    })).filter(p=>p.player_id);
    return request("/rest/v1/rpc/replace_roster",{method:"POST",body:{p_league_id:leagueId,p_players:normalized},session:current});
  }

  async function listWaivers(leagueId){
    const current=await session();
    if(!current)return [];
    return request("/rest/v1/waiver_claims?league_id=eq."+encodeURIComponent(leagueId)+"&select=*&order=priority.asc,created_at.asc",{session:current});
  }

  async function createWaiver(leagueId,playerId,priority=1){
    const current=await session();
    if(!current)throw new Error("Sign in before creating a waiver claim.");
    return request("/rest/v1/rpc/create_waiver",{method:"POST",body:{p_league_id:leagueId,p_player_id:String(playerId),p_priority:Number(priority)||1},session:current});
  }

  async function cancelWaiver(id){
    const current=await session();
    if(!current)throw new Error("Sign in before changing a waiver claim.");
    return request("/rest/v1/rpc/cancel_waiver",{method:"POST",body:{p_claim_id:id},session:current});
  }

  async function listTrades(leagueId){
    const current=await session();
    if(!current)return [];
    return request("/rest/v1/trades?league_id=eq."+encodeURIComponent(leagueId)+"&select=*&order=created_at.desc",{session:current});
  }

  async function createTrade(leagueId,toUser,offer){
    const current=await session();
    if(!current)throw new Error("Sign in before creating a trade.");
    return request("/rest/v1/rpc/create_trade",{method:"POST",body:{p_league_id:leagueId,p_to_user:toUser,p_offer:offer},session:current});
  }

  async function updateTrade(id,status){
    const allowed=new Set(["declined","canceled"]);
    if(!allowed.has(status))throw new Error("Invalid trade status.");
    const current=await session();
    if(!current)throw new Error("Sign in before updating a trade.");
    return request("/rest/v1/rpc/resolve_trade",{method:"POST",body:{p_trade_id:id,p_status:status},session:current});
  }

  async function acceptTrade(id){
    const current=await session();
    if(!current)throw new Error("Sign in before accepting a trade.");
    return request("/rest/v1/rpc/accept_trade",{method:"POST",body:{p_trade_id:id},session:current});
  }

  captureAuthCallback();

  window.RiftBackend=Object.freeze({
    isConfigured,
    readSession,
    onSessionChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    signUp,resendSignup,requestPasswordReset,updatePassword,isRecoveryMode,signIn,signOut,currentUser,
    listLeagues,createLeague,joinLeague,updateLeagueSettings,listLeagueMembers,
    getLeagueDraft,listDraftPicks,startLeagueDraft,makeDraftPick,
    listRosters,saveRoster,
    listWaivers,createWaiver,cancelWaiver,
    listTrades,createTrade,updateTrade,acceptTrade,
    request
  });
})();
