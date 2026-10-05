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

  async function signUp(email,password){
    const payload=await request("/auth/v1/signup",{method:"POST",body:{email,password},session:null});
    if(payload?.access_token)writeSession(payload);
    return payload;
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
    return request("/rest/v1/leagues?select=id,name,invite_code,settings,created_at&order=created_at.desc",{session:current});
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
      league_id:leagueId,
      user_id:userId,
      player_id:String(p.id||p.name||""),
      slot:String(p.slot||p.role||"BN")
    })).filter(p=>p.player_id);
    await request("/rest/v1/rosters?league_id=eq."+encodeURIComponent(leagueId)+"&user_id=eq."+encodeURIComponent(userId),{method:"DELETE",session:current});
    if(!normalized.length)return [];
    return request("/rest/v1/rosters",{method:"POST",body:normalized,session:current,headers:{"Prefer":"return=representation"}});
  }

  async function listWaivers(leagueId){
    const current=await session();
    if(!current)return [];
    return request("/rest/v1/waiver_claims?league_id=eq."+encodeURIComponent(leagueId)+"&select=*&order=priority.asc,created_at.asc",{session:current});
  }

  async function createWaiver(leagueId,playerId,priority=1){
    const current=await session();
    const userId=current?.user?.id;
    if(!current||!userId)throw new Error("Sign in before creating a waiver claim.");
    return request("/rest/v1/waiver_claims",{method:"POST",body:{league_id:leagueId,user_id:userId,player_id:String(playerId),priority:Number(priority)||1,status:"pending"},session:current,headers:{"Prefer":"return=representation"}});
  }

  async function cancelWaiver(id){
    const current=await session();
    if(!current)throw new Error("Sign in before changing a waiver claim.");
    return request("/rest/v1/waiver_claims?id=eq."+encodeURIComponent(id),{method:"PATCH",body:{status:"canceled"},session:current,headers:{"Prefer":"return=representation"}});
  }

  async function listTrades(leagueId){
    const current=await session();
    if(!current)return [];
    return request("/rest/v1/trades?league_id=eq."+encodeURIComponent(leagueId)+"&select=*&order=created_at.desc",{session:current});
  }

  async function createTrade(leagueId,toUser,offer){
    const current=await session();
    const userId=current?.user?.id;
    if(!current||!userId)throw new Error("Sign in before creating a trade.");
    return request("/rest/v1/trades",{method:"POST",body:{league_id:leagueId,from_user:userId,to_user:toUser,offer,status:"pending"},session:current,headers:{"Prefer":"return=representation"}});
  }

  async function updateTrade(id,status){
    const allowed=new Set(["accepted","declined","canceled"]);
    if(!allowed.has(status))throw new Error("Invalid trade status.");
    const current=await session();
    if(!current)throw new Error("Sign in before updating a trade.");
    return request("/rest/v1/trades?id=eq."+encodeURIComponent(id),{method:"PATCH",body:{status,resolved_at:new Date().toISOString()},session:current,headers:{"Prefer":"return=representation"}});
  }

  window.RiftBackend=Object.freeze({
    isConfigured,
    readSession,
    onSessionChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    signUp,signIn,signOut,currentUser,
    listLeagues,createLeague,joinLeague,listLeagueMembers,
    listRosters,saveRoster,
    listWaivers,createWaiver,cancelWaiver,
    listTrades,createTrade,updateTrade,
    request
  });
})();
