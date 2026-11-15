require("dotenv").config();
const express=require("express"),helmet=require("helmet"),rateLimit=require("express-rate-limit");
const bcrypt=require("bcryptjs"),jwt=require("jsonwebtoken"),Database=require("better-sqlite3");
const {execFile}=require("child_process"),{promisify}=require("util"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const run=promisify(execFile),app=express(),PORT=Number(process.env.PORT||8080),SECRET=process.env.JWT_SECRET||"";
if(SECRET.length<32)throw new Error("JWT_SECRET must be at least 32 characters");
if(!process.env.ADMIN_PASSWORD||process.env.ADMIN_PASSWORD.length<12)throw new Error("ADMIN_PASSWORD must be at least 12 characters");
const DATA=path.resolve(process.env.DATA_DIR||"./data"),CHECKOUTS=path.join(DATA,"apps");fs.mkdirSync(CHECKOUTS,{recursive:true});
const ENC_RAW=process.env.APP_ENCRYPTION_KEY||"";
if(ENC_RAW&&!/^(?:[a-f0-9]{64}|[A-Za-z0-9+/]{43}=)$/.test(ENC_RAW))throw new Error("APP_ENCRYPTION_KEY must be 32-byte hex or base64");
const ENC_KEY=ENC_RAW?Buffer.from(ENC_RAW,ENC_RAW.length===64?"hex":"base64"):null;
function encryptEnv(value){if(!ENC_KEY)throw new Error("Environment-variable management is disabled. Configure APP_ENCRYPTION_KEY.");const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",ENC_KEY,iv),body=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);return [iv.toString("base64"),cipher.getAuthTag().toString("base64"),body.toString("base64")].join(".")}
function decryptEnv(value){if(!value)return {};if(!ENC_KEY)throw new Error("APP_ENCRYPTION_KEY is missing; configure the original key to read saved app variables.");const [iv,tag,body]=value.split(".");if(!iv||!tag||!body)throw new Error("Stored environment data is invalid");const decipher=crypto.createDecipheriv("aes-256-gcm",ENC_KEY,Buffer.from(iv,"base64"));decipher.setAuthTag(Buffer.from(tag,"base64"));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body,"base64")),decipher.final()]).toString("utf8"))}
function validateEnvPatch(input){if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Send environment variables as a JSON object");const entries=Object.entries(input);if(entries.length>100)throw new Error("A maximum of 100 environment variables is allowed");const patch={};let bytes=0;for(const [key,value] of entries){if(!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key))throw new Error("Invalid environment variable name: "+key);if(["PORT","HOST","HOME","PATH","PWD"].includes(key))throw new Error(key+" is reserved by Webbase Cloud");if(value!==null&&typeof value!=="string")throw new Error("Values must be strings or null (null deletes a variable)");if(typeof value==="string"){if(/[\r\n\0]/.test(value))throw new Error("Environment values cannot contain newline or NUL characters");if(value.length>8192)throw new Error("An environment value exceeds 8 KB");bytes+=Buffer.byteLength(key+"="+value+"\n")}patch[key]=value}if(bytes>32768)throw new Error("Environment update exceeds 32 KB");return patch}

const db=new Database(path.join(DATA,"cloud.sqlite"));db.pragma("journal_mode=WAL");
db.exec(`CREATE TABLE IF NOT EXISTS admin(id INTEGER PRIMARY KEY,email TEXT UNIQUE,password_hash TEXT);
CREATE TABLE IF NOT EXISTS apps(id TEXT PRIMARY KEY,name TEXT,slug TEXT UNIQUE,repo TEXT,branch TEXT,port INTEGER,status TEXT,container TEXT,created_at TEXT,last_error TEXT,host_port INTEGER,env_ciphertext TEXT);
CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT,app_id TEXT,message TEXT,created_at TEXT);`);
const cols=db.prepare("PRAGMA table_info(apps)").all().map(x=>x.name);if(!cols.includes("host_port"))db.exec("ALTER TABLE apps ADD COLUMN host_port INTEGER");if(!cols.includes("env_ciphertext"))db.exec("ALTER TABLE apps ADD COLUMN env_ciphertext TEXT");
const email=(process.env.ADMIN_EMAIL||"admin@example.com").toLowerCase();
if(!db.prepare("SELECT id FROM admin WHERE id=1").get())db.prepare("INSERT INTO admin VALUES(1,?,?)").run(email,bcrypt.hashSync(process.env.ADMIN_PASSWORD,12));
const stamp=()=>new Date().toISOString(),log=(id,msg)=>db.prepare("INSERT INTO logs(app_id,message,created_at) VALUES(?,?,?)").run(id,String(msg).slice(0,3000),stamp());
app.use(helmet({contentSecurityPolicy:false}));app.use(express.json({limit:"32kb"}));app.use(rateLimit({windowMs:900000,limit:180}));app.use(express.static(path.join(__dirname,"public")));
function auth(req,res,next){try{req.user=jwt.verify((req.headers.authorization||"").replace(/^Bearer\s+/i,""),SECRET);next()}catch{return res.status(401).json({error:"Sign in required"})}}
function slugify(v){return String(v||"").toLowerCase().trim().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,40)}
function validRepo(v){try{const u=new URL(v);return u.protocol==="https:"&&["github.com","gitlab.com"].includes(u.hostname)&&/^\/[\w.-]+\/[\w.-]+(\.git)?\/?$/.test(u.pathname)}catch{return false}}
async function docker(args,timeout=120000){return run("docker",args,{timeout,maxBuffer:2*1024*1024})}
function publicUrl(port){const host=process.env.PUBLIC_HOST||process.env.PUBLIC_DOMAIN||"localhost";const safe=host.includes(":")&&!host.startsWith("[")?"["+host+"]":host;return (process.env.PUBLIC_SCHEME||"http")+"://"+safe+":"+port}
function allocateHostPort(){const start=Number(process.env.APP_PORT_START||20000),end=Number(process.env.APP_PORT_END||20100);const used=new Set(db.prepare("SELECT host_port FROM apps WHERE host_port IS NOT NULL").all().map(x=>x.host_port));for(let p=start;p<=end;p++)if(!used.has(p))return p;throw new Error("No free app ports remain. Increase APP_PORT_END or remove stopped apps.");}
async function deploy(a){
 const dir=path.join(CHECKOUTS,a.slug),image="wbc-"+a.slug+":latest";
 try{
  const hostPort=allocateHostPort();db.prepare("UPDATE apps SET status='building',host_port=?,last_error=NULL WHERE id=?").run(hostPort,a.id);
  fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
  log(a.id,"Cloning repository "+a.repo);
  await run("git",["clone","--depth","1","--branch",a.branch,a.repo,dir],{timeout:120000});
  if(!fs.existsSync(path.join(dir,"Dockerfile")))throw new Error("A Dockerfile is required in the repository root.");
  log(a.id,"Building Docker image…");const buildResult=await docker(["build","--pull","-t",image,dir],600000);for(const line of (buildResult.stdout+"\n"+buildResult.stderr).split(/\r?\n/).filter(Boolean).slice(-40))log(a.id,"BUILD: "+line.slice(0,2500));
  try{await docker(["rm","-f",a.container],30000)}catch{}
  log(a.id,"Starting app with resource limits (512 MiB RAM, 1 CPU, 256 processes)…");
  const saved=db.prepare("SELECT env_ciphertext FROM apps WHERE id=?").get(a.id),env=decryptEnv(saved?.env_ciphertext),envFile=path.join(DATA,".env-"+a.id);
  const envLines=Object.entries({...env,PORT:String(a.port)}).map(([k,v])=>k+"="+v).join("\n")+"\n";
  fs.writeFileSync(envFile,envLines,{mode:0o600,flag:"w"});fs.chmodSync(envFile,0o600);
  try{await docker(["run","-d","--name",a.container,"--restart","unless-stopped","--network",process.env.DOCKER_NETWORK||"webbase-cloud","--memory",process.env.APP_MEMORY_LIMIT||"512m","--cpus",process.env.APP_CPU_LIMIT||"1","--pids-limit","256","--label","webbase-cloud.managed=true","-p","0.0.0.0:"+hostPort+":"+a.port+"/tcp","--env-file",envFile,image],60000)}finally{try{fs.rmSync(envFile,{force:true})}catch{}}
  db.prepare("UPDATE apps SET status='running',host_port=?,last_error=NULL WHERE id=?").run(hostPort,a.id);
  log(a.id,"Container started at "+publicUrl(hostPort));
 }catch(e){const output=[e.stdout,e.stderr].filter(Boolean).join("\n").split(/\r?\n/).filter(Boolean).slice(-40);for(const line of output)log(a.id,"BUILD: "+line.slice(0,2500));db.prepare("UPDATE apps SET status='failed',host_port=NULL,last_error=? WHERE id=?").run(String(e.message).slice(0,900),a.id);log(a.id,"ERROR: "+e.message)}
}
app.get("/api/health",(q,s)=>s.json({ok:true,service:"webbase-cloud"}));
app.post("/api/auth/login",(q,s)=>{const u=db.prepare("SELECT * FROM admin WHERE email=?").get(String(q.body?.email||"").toLowerCase());if(!u||!bcrypt.compareSync(String(q.body?.password||""),u.password_hash))return s.status(401).json({error:"Invalid email or password"});s.json({token:jwt.sign({email:u.email},SECRET,{expiresIn:"12h"}),email:u.email})});
app.get("/api/me",auth,(q,s)=>s.json({email:q.user.email}));
app.get("/api/system",auth,async(q,s)=>{try{const r=await docker(["info","--format","{{.ServerVersion}}"]);s.json({docker:"online",dockerVersion:r.stdout.trim(),publicHost:process.env.PUBLIC_HOST||process.env.PUBLIC_DOMAIN||"localhost",appPortRange:"20000-20100",appMemoryLimit:process.env.APP_MEMORY_LIMIT||"512m",appCpuLimit:process.env.APP_CPU_LIMIT||"1"})}catch(e){s.status(503).json({docker:"offline",error:e.message})}});
app.get("/api/apps",auth,(q,s)=>s.json({apps:db.prepare("SELECT id,name,slug,repo,branch,port,status,created_at,last_error,host_port FROM apps ORDER BY created_at DESC").all().map(a=>({...a,public_url:a.host_port?publicUrl(a.host_port):null}))}));
app.post("/api/apps",auth,async(q,s)=>{
 const name=String(q.body?.name||"").trim(),slug=slugify(q.body?.slug||name),repo=String(q.body?.repo||""),branch=String(q.body?.branch||"main"),port=Number(q.body?.port||3000);
 if(!name||name.length>80||!slug)return s.status(400).json({error:"Enter a valid app name"});
 if(!validRepo(repo))return s.status(400).json({error:"Use a public HTTPS GitHub or GitLab repository URL"});
 if(!/^[\w./-]{1,100}$/.test(branch))return s.status(400).json({error:"Invalid branch"});
 if(!Number.isInteger(port)||port<1||port>65535)return s.status(400).json({error:"Invalid app port"});
 if(db.prepare("SELECT id FROM apps WHERE slug=?").get(slug))return s.status(409).json({error:"App slug already exists"});
 const a={id:crypto.randomUUID(),name,slug,repo,branch,port,status:"queued",container:"wbc-"+slug,created_at:stamp()};
 db.prepare("INSERT INTO apps(id,name,slug,repo,branch,port,status,container,created_at) VALUES(@id,@name,@slug,@repo,@branch,@port,@status,@container,@created_at)").run(a);
 log(a.id,"Deployment queued");s.status(202).json({app:a});deploy(a);
});
app.get("/api/apps/:id/env",auth,(q,s)=>{const a=db.prepare("SELECT env_ciphertext FROM apps WHERE id=?").get(q.params.id);if(!a)return s.status(404).json({error:"App not found"});if(!ENC_KEY)return s.status(503).json({error:"Configure APP_ENCRYPTION_KEY to manage environment variables"});try{s.json({keys:Object.keys(decryptEnv(a.env_ciphertext))})}catch(e){s.status(500).json({error:e.message})}});
app.put("/api/apps/:id/env",auth,(q,s)=>{const a=db.prepare("SELECT env_ciphertext FROM apps WHERE id=?").get(q.params.id);if(!a)return s.status(404).json({error:"App not found"});if(!ENC_KEY)return s.status(503).json({error:"Configure APP_ENCRYPTION_KEY to manage environment variables"});try{const patch=validateEnvPatch(q.body?.variables),current=decryptEnv(a.env_ciphertext);for(const [k,v] of Object.entries(patch)){if(v===null)delete current[k];else current[k]=v}const encrypted=encryptEnv(current);db.prepare("UPDATE apps SET env_ciphertext=? WHERE id=?").run(encrypted,q.params.id);log(q.params.id,"Environment variables updated ("+Object.keys(patch).length+" changed)");s.json({ok:true,keys:Object.keys(current),message:"Saved. Redeploy the app to apply changes."})}catch(e){s.status(400).json({error:e.message})}});
app.get("/api/apps/:id/logs",auth,async(q,s)=>{const a=db.prepare("SELECT container FROM apps WHERE id=?").get(q.params.id);if(!a)return s.status(404).json({error:"App not found"});const logs=db.prepare("SELECT message,created_at FROM logs WHERE app_id=? ORDER BY id DESC LIMIT 150").all(q.params.id).reverse();let runtime="";try{const r=await docker(["logs","--tail","200",a.container],15000);runtime=(r.stdout||"")+(r.stderr||"")}catch(e){runtime=(e.stdout||"")+(e.stderr||"")||e.message} s.json({logs,runtime})});
app.post("/api/apps/:id/action",auth,async(q,s)=>{const a=db.prepare("SELECT * FROM apps WHERE id=?").get(q.params.id);if(!a)return s.status(404).json({error:"App not found"});try{const act=q.body?.action;if(act==="deploy"){db.prepare("UPDATE apps SET status='queued' WHERE id=?").run(a.id);deploy(a)}else if(act==="stop"){try{await docker(["rm","-f",a.container])}catch(e){if(!/No such container|No such object/i.test(String(e.stderr||e.message)))throw e}db.prepare("UPDATE apps SET status='stopped',host_port=NULL WHERE id=?").run(a.id);log(a.id,"Stopped")}else if(act==="restart"){if(a.status!=="running")return s.status(409).json({error:"Only running apps can be restarted. Use Redeploy for stopped or failed apps."});await docker(["restart",a.container]);db.prepare("UPDATE apps SET status='running' WHERE id=?").run(a.id);log(a.id,"Restarted")}else return s.status(400).json({error:"Unsupported action"});s.json({ok:true})}catch(e){s.status(500).json({error:e.message})}});
app.delete("/api/apps/:id",auth,async(q,s)=>{const a=db.prepare("SELECT * FROM apps WHERE id=?").get(q.params.id);if(!a)return s.status(404).json({error:"App not found"});try{await docker(["rm","-f",a.container])}catch{}db.prepare("DELETE FROM logs WHERE app_id=?").run(a.id);db.prepare("DELETE FROM apps WHERE id=?").run(a.id);s.json({ok:true})});
app.get("*",(q,s)=>s.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,"0.0.0.0",()=>console.log("Webbase Cloud listening on "+PORT));
