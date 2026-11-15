const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const enc=new TextEncoder();
const b64url=(bytes)=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
const fromB64url=(s)=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
const safeEqual=(a,b)=>{if(typeof a!=="string"||typeof b!=="string"||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0};
const slugify=(s)=>String(s||"").toLowerCase().trim().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,58);
async function schema(db){
 await db.exec(`CREATE TABLE IF NOT EXISTS apps(id TEXT PRIMARY KEY,name TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,repo TEXT NOT NULL,branch TEXT NOT NULL,build_command TEXT NOT NULL,output_dir TEXT NOT NULL,project_name TEXT NOT NULL UNIQUE,url TEXT,status TEXT NOT NULL,created_at TEXT NOT NULL,last_deployment_id TEXT,last_error TEXT,domain TEXT);
 CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT,app_id TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS login_attempts(ip TEXT NOT NULL,created_at INTEGER NOT NULL);`);
}
async function signToken(email,secret){
 const header=b64url(enc.encode(JSON.stringify({alg:"HS256",typ:"JWT"}))),payload=b64url(enc.encode(JSON.stringify({sub:email,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+43200}))),data=header+"."+payload;
 const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return data+"."+b64url(await crypto.subtle.sign("HMAC",key,enc.encode(data)));
}
async function verifyToken(request,secret){
 try{const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,""),p=token.split(".");if(p.length!==3)return null;
 const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
 const ok=await crypto.subtle.verify("HMAC",key,fromB64url(p[2]),enc.encode(p[0]+"."+p[1]));if(!ok)return null;
 const claims=JSON.parse(new TextDecoder().decode(fromB64url(p[1])));return claims.exp>Date.now()/1000?claims:null;
 }catch{return null}
}
async function cf(env,path,options={}){
 if(!env.CLOUDFLARE_API_TOKEN||!env.CLOUDFLARE_ACCOUNT_ID)throw new Error("Connect Cloudflare API first: add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in Pages settings.");
 const r=await fetch("https://api.cloudflare.com/client/v4/accounts/"+env.CLOUDFLARE_ACCOUNT_ID+path,{...options,headers:{authorization:"Bearer "+env.CLOUDFLARE_API_TOKEN,...(options.headers||{})}});
 const data=await r.json().catch(()=>({}));
 if(!r.ok||data.success===false)throw new Error((data.errors||[]).map(x=>x.message).join("; ")||"Cloudflare API request failed ("+r.status+")");
 return data.result;
}
async function body(request){const raw=await request.text();if(raw.length>32768)throw new Error("Request body is too large");return raw?JSON.parse(raw):{}}
function repoInfo(value){
 let u;try{u=new URL(value)}catch{throw new Error("Enter a valid GitHub or GitLab HTTPS repository URL");}
 if(u.protocol!=="https:"||!["github.com","gitlab.com"].includes(u.hostname))throw new Error("Only GitHub and GitLab HTTPS repositories are supported");
 const parts=u.pathname.replace(/^\/|\/$/g,"").replace(/\.git$/,"").split("/");
 if(parts.length!==2||parts.some(x=>! /^[A-Za-z0-9_.-]+$/.test(x)))throw new Error("Repository URL must look like https://github.com/owner/repository");
 return {provider:u.hostname==="github.com"?"github":"gitlab",owner:parts[0],name:parts[1]};
}
async function addLog(db,id,message){await db.prepare("INSERT INTO logs(app_id,message,created_at) VALUES(?,?,?)").bind(id,String(message).slice(0,2000),new Date().toISOString()).run();}
async function handleRequest({request,env}){
 const url=new URL(request.url),path=url.pathname.replace(/^\/api\/?/,"").replace(/\/$/,""),method=request.method;
 if(path==="health"&&method==="GET")return json({ok:true,service:"webbase-cloud-pages-functions",database:!!env.DB,cloudflareApi:!!(env.CLOUDFLARE_API_TOKEN&&env.CLOUDFLARE_ACCOUNT_ID),authConfigured:!!(env.ADMIN_EMAIL&&env.ADMIN_PASSWORD&&env.JWT_SECRET&&env.JWT_SECRET.length>=32)});
 if(!env.DB)return json({error:"D1 database is not connected. In Cloudflare Pages > Settings > Bindings, add a D1 binding named DB, then redeploy."},503);
 try{await schema(env.DB)}catch(e){return json({error:"D1 initialization failed: "+e.message},503)}
 if(path==="auth/login"&&method==="POST"){
  if(!env.ADMIN_EMAIL||!env.ADMIN_PASSWORD||!env.JWT_SECRET||env.JWT_SECRET.length<32)return json({error:"Set ADMIN_EMAIL, ADMIN_PASSWORD (12+ characters), and JWT_SECRET (32+ characters) in Pages environment variables."},503);
  const ip=request.headers.get("CF-Connecting-IP")||"unknown",cutoff=Date.now()-900000;
  await env.DB.prepare("DELETE FROM login_attempts WHERE created_at < ?").bind(cutoff).run();
  const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE ip=? AND created_at>?").bind(ip,cutoff).first();
  if((count?.n||0)>=10)return json({error:"Too many login attempts. Try again in 15 minutes."},429);
  const data=await body(request),email=String(data.email||"").trim().toLowerCase(),password=String(data.password||"");
  if(!safeEqual(email,env.ADMIN_EMAIL.trim().toLowerCase())||!safeEqual(password,env.ADMIN_PASSWORD)){
   await env.DB.prepare("INSERT INTO login_attempts(ip,created_at) VALUES(?,?)").bind(ip,Date.now()).run();
   return json({error:"Invalid email or password"},401);
  }
  await env.DB.prepare("DELETE FROM login_attempts WHERE ip=?").bind(ip).run();
  return json({token:await signToken(email,env.JWT_SECRET),email});
 }
 if(!env.JWT_SECRET||env.JWT_SECRET.length<32)return json({error:"JWT_SECRET is not configured (minimum 32 characters)."},503);
 const user=await verifyToken(request,env.JWT_SECRET);if(!user)return json({error:"Sign in required"},401);
 if(path==="me"&&method==="GET")return json({email:user.sub});
 if(path==="system"&&method==="GET")return json({platform:"Cloudflare Pages",database:"D1",pagesApi:!!(env.CLOUDFLARE_API_TOKEN&&env.CLOUDFLARE_ACCOUNT_ID),docker:"not-supported-on-pages",deployTarget:"Cloudflare Pages"});
 if(path==="apps"&&method==="GET"){
  const rows=await env.DB.prepare("SELECT * FROM apps ORDER BY created_at DESC").all();
  const apps=await Promise.all((rows.results||[]).map(async a=>{
   let status=a.status,latest=null;
   let stableUrl=a.url;
   if(env.CLOUDFLARE_API_TOKEN&&env.CLOUDFLARE_ACCOUNT_ID){try{const project=await cf(env,"/pages/projects/"+encodeURIComponent(a.project_name));stableUrl=project?.subdomain?"https://"+project.subdomain:stableUrl;latest=project?.latest_deployment||null;if(latest){status=latest.latest_stage?.status==="success"?"running":latest.latest_stage?.status==="failure"?"failed":latest.latest_stage?.status==="active"||latest.latest_stage?.status==="idle"?"building":a.status;await env.DB.prepare("UPDATE apps SET status=?,last_deployment_id=?,url=COALESCE(?,url),last_error=? WHERE id=?").bind(status,latest.id||null,stableUrl,latest.latest_stage?.status==="failure"?"Latest Cloudflare Pages deployment failed":null,a.id).run();}}catch{}}
   return {...a,status,url:stableUrl||a.url,health:"managed by Cloudflare Pages",public_url:stableUrl||a.url,domain_url:a.domain?"https://"+a.domain:null,node_name:"Cloudflare Pages"};
  }));
  return json({apps});
 }
 if(path==="apps"&&method==="POST"){
  const data=await body(request),name=String(data.name||"").trim(),slug=slugify(data.slug||name),repo=String(data.repo||""),branch=String(data.branch||"main").trim(),buildCommand=String(data.build_command??"").trim(),outputDir=String(data.output_dir||"public").trim();
  if(!env.CLOUDFLARE_API_TOKEN||!env.CLOUDFLARE_ACCOUNT_ID)return json({error:"Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in Cloudflare Pages environment variables before deploying sites."},503);
  if(!name||name.length>80||!slug)return json({error:"Enter a valid project name."},400);
  if(!/^[A-Za-z0-9._/-]{1,100}$/.test(branch))return json({error:"Invalid branch name."},400);
  if(outputDir.startsWith("/")||outputDir.includes("..")||! /^[A-Za-z0-9._/-]{1,100}$/.test(outputDir))return json({error:"Output directory must be a relative path such as dist or public."},400);
  const repoData=repoInfo(repo);if(repoData.owner.toLowerCase()==="xsoftwareabdullah1-create"&&repoData.name.toLowerCase()==="webbase-cloud")return json({error:"You selected Webbase Cloud's own dashboard repository. Choose your actual website's GitHub/GitLab repository instead."},400);const existing=await env.DB.prepare("SELECT id FROM apps WHERE slug=?").bind(slug).first();if(existing)return json({error:"This project name is already registered."},409);
  const project=await cf(env,"/pages/projects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:slug,production_branch:branch,build_config:{build_command:buildCommand||undefined,destination_dir:outputDir,root_dir:"/"},source:{type:repoData.provider,config:{owner:repoData.owner,repo_name:repoData.name,production_branch:branch,production_deployments_enabled:true,preview_deployment_setting:"all",pr_comments_enabled:false}}})});
  const id=crypto.randomUUID(),created=new Date().toISOString(),live=project.subdomain?"https://"+project.subdomain:"https://"+slug+".pages.dev",deployment=project.canonical_deployment;
  await env.DB.prepare("INSERT INTO apps(id,name,slug,repo,branch,build_command,output_dir,project_name,url,status,created_at,last_deployment_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,name,slug,repo,branch,buildCommand,outputDir,slug,live,deployment?.latest_stage?.status==="success"?"running":"building",created,deployment?.id||null).run();
  await addLog(env.DB,id,"Cloudflare Pages project created. Git provider authorization is required for the repository.");
  return json({app:{id,name,slug,repo,branch,status:"building",url:live,public_url:live,node_name:"Cloudflare Pages"}},201);
 }
 const match=path.match(/^apps\/([A-Za-z0-9-]+)(?:\/(.*))?$/);
 if(match){
  const id=match[1],sub=match[2]||"",app=await env.DB.prepare("SELECT * FROM apps WHERE id=?").bind(id).first();if(!app)return json({error:"Application not found"},404);
  if(sub==="action"&&method==="POST"){
   const data=await body(request);if(!["deploy","redeploy"].includes(data.action))return json({error:"Cloudflare Pages supports redeploy. Stop/restart are not available for static Pages projects."},400);
   const form=new FormData();form.set("branch",app.branch);
   const deployment=await cf(env,"/pages/projects/"+encodeURIComponent(app.project_name)+"/deployments",{method:"POST",body:form});
   await env.DB.prepare("UPDATE apps SET status='building',last_deployment_id=?,last_error=NULL WHERE id=?").bind(deployment.id||null,id).run();
   await addLog(env.DB,id,"Redeployment requested for branch "+app.branch);
   return json({ok:true,deployment_id:deployment.id,url:deployment.url||app.url});
  }
  if(sub==="logs"&&method==="GET"){
   const rows=await env.DB.prepare("SELECT message,created_at FROM logs WHERE app_id=? ORDER BY id DESC LIMIT 100").bind(id).all();
   let runtime="";if(env.CLOUDFLARE_API_TOKEN&&env.CLOUDFLARE_ACCOUNT_ID){try{const d=await cf(env,"/pages/projects/"+encodeURIComponent(app.project_name)+"/deployments");const latest=Array.isArray(d)?d[0]:null;if(latest){const l=await cf(env,"/pages/projects/"+encodeURIComponent(app.project_name)+"/deployments/"+encodeURIComponent(latest.id)+"/history/logs");runtime=JSON.stringify(l).slice(0,12000)}}catch(e){runtime=e.message}}
   return json({logs:(rows.results||[]).reverse(),runtime:runtime||"Build logs are available in Cloudflare Dashboard > Workers & Pages > project > Deployments."});
  }
  if(sub==="domain"&&method==="PUT"){
   const data=await body(request),domain=String(data.domain||"").trim().toLowerCase();
   if(!domain||domain.length>253||!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))return json({error:"Enter a valid custom domain."},400);
   await cf(env,"/pages/projects/"+encodeURIComponent(app.project_name)+"/domains",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:domain})});
   await env.DB.prepare("UPDATE apps SET domain=? WHERE id=?").bind(domain,id).run();await addLog(env.DB,id,"Custom domain added: "+domain);
   return json({ok:true,domain,url:"https://"+domain,message:"Cloudflare is validating DNS and TLS for this domain."});
  }
  if(!sub&&method==="DELETE"){
   await cf(env,"/pages/projects/"+encodeURIComponent(app.project_name),{method:"DELETE"});
   await env.DB.prepare("DELETE FROM logs WHERE app_id=?").bind(id).run();await env.DB.prepare("DELETE FROM apps WHERE id=?").bind(id).run();return json({ok:true});
  }
 }
 return json({error:"API route not found"},404);
}


// Normalize unexpected route, JSON parsing, D1 and Cloudflare API failures into JSON responses.
export async function onRequest(context){
 try {
  return await handleRequest(context);
 } catch (error) {
  const message = error instanceof SyntaxError
   ? "Invalid JSON request body. Check the submitted form data."
   : (error && typeof error.message === "string" ? error.message : "Unexpected server error");
  const status = error instanceof SyntaxError ? 400 : 502;
  return json({ error: message }, status);
 }
}
