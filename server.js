require("dotenv").config();
const express=require("express"),helmet=require("helmet"),rateLimit=require("express-rate-limit");
const bcrypt=require("bcryptjs"),jwt=require("jsonwebtoken"),Database=require("better-sqlite3");
const {execFile}=require("child_process"),{promisify}=require("util"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const run=promisify(execFile),app=express(),PORT=Number(process.env.PORT||8080),SECRET=process.env.JWT_SECRET||"";
if(SECRET.length<32)throw new Error("JWT_SECRET must be at least 32 characters");
if(!process.env.ADMIN_PASSWORD||process.env.ADMIN_PASSWORD.length<12)throw new Error("ADMIN_PASSWORD must be at least 12 characters");
const DATA=path.resolve(process.env.DATA_DIR||"./data"),CHECKOUTS=path.join(DATA,"apps");fs.mkdirSync(CHECKOUTS,{recursive:true});
const db=new Database(path.join(DATA,"cloud.sqlite"));db.pragma("journal_mode=WAL");
db.exec(`CREATE TABLE IF NOT EXISTS admin(id INTEGER PRIMARY KEY,email TEXT UNIQUE,password_hash TEXT);
CREATE TABLE IF NOT EXISTS apps(id TEXT PRIMARY KEY,name TEXT,slug TEXT UNIQUE,repo TEXT,branch TEXT,port INTEGER,status TEXT,container TEXT,created_at TEXT,last_error TEXT);
CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT,app_id TEXT,message TEXT,created_at TEXT);`);
const email=(process.env.ADMIN_EMAIL||"admin@example.com").toLowerCase();
if(!db.prepare("SELECT id FROM admin WHERE id=1").get())db.prepare("INSERT INTO admin VALUES(1,?,?)").run(email,bcrypt.hashSync(process.env.ADMIN_PASSWORD,12));
const stamp=()=>new Date().toISOString(),log=(id,msg)=>db.prepare("INSERT INTO logs(app_id,message,created_at) VALUES(?,?,?)").run(id,String(msg).slice(0,3000),stamp());
app.use(helmet({contentSecurityPolicy:false}));app.use(express.json({limit:"32kb"}));app.use(rateLimit({windowMs:900000,limit:180}));app.use(express.static(path.join(__dirname,"public")));
function auth(req,res,next){try{req.user=jwt.verify((req.headers.authorization||"").replace(/^Bearer\s+/i,""),SECRET);next()}catch{return res.status(401).json({error:"Sign in required"})}}
function slugify(v){return String(v||"").toLowerCase().trim().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,40)}
function validRepo(v){try{const u=new URL(v);return u.protocol==="https:"&&["github.com","gitlab.com"].includes(u.hostname)&&/^\/[\w.-]+\/[\w.-]+(\.git)?\/?$/.test(u.pathname)}catch{return false}}
async function docker(args,timeout=120000){return run("docker",args,{timeout,maxBuffer:2*1024*1024})}
async function deploy(a){
 const dir=path.join(CHECKOUTS,a.slug),image="wbc-"+a.slug+":latest";
 try{
  fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
  log(a.id,"Cloning repository "+a.repo);
  await run("git",["clone","--depth","1","--branch",a.branch,a.repo,dir],{timeout:120000});
  if(!fs.existsSync(path.join(dir,"Dockerfile")))throw new Error("A Dockerfile is required in the repository root.");
  log(a.id,"Building Docker image…");await docker(["build","-t",image,dir],600000);
  try{await docker(["rm","-f",a.container],30000)}catch{}
  log(a.id,"Starting application container…");
  await docker(["run","-d","--name",a.container,"--restart","unless-stopped","--network",process.env.DOCKER_NETWORK||"webbase-cloud","-p", "127.0.0.1::"+a.port,"-e","PORT="+a.port,image],60000);
  db.prepare("UPDATE apps SET status='running',last_error=NULL WHERE id=?").run(a.id);log(a.id,"Container started.");
 }catch(e){db.prepare("UPDATE apps SET status='failed',last_error=? WHERE id=?").run(String(e.message).slice(0,900),a.id);log(a.id,"ERROR: "+e.message)}
}
app.get("/api/health",(q,s)=>s.json({ok:true,service:"webbase-cloud"}));
app.post("/api/auth/login",(q,s)=>{const u=db.prepare("SELECT * FROM admin WHERE email=?").get(String(q.body?.email||"").toLowerCase());if(!u||!bcrypt.compareSync(String(q.body?.password||""),u.password_hash))return s.status(401).json({error:"Invalid email or password"});s.json({token:jwt.sign({email:u.email},SECRET,{expiresIn:"12h"}),email:u.email})});
app.get("/api/me",auth,(q,s)=>s.json({email:q.user.email}));
app.get("/api/apps",auth,(q,s)=>s.json({apps:db.prepare("SELECT id,name,slug,repo,branch,port,status,created_at,last_error FROM apps ORDER BY created_at DESC").all()}));
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
app.get("/api/apps/:id/logs",auth,(q,s)=>s.json({logs:db.prepare("SELECT message,created_at FROM logs WHERE app_id=? ORDER BY id DESC LIMIT 150").all(q.params.id).reverse()}));
app.post("/api/apps/:id/action",auth,async(q,s)=>{const a=db.prepare("SELECT * FROM apps WHERE id=?").get(q.params.id);if(!a)return s.status(404).json({error:"App not found"});try{const act=q.body?.action;if(act==="deploy"){db.prepare("UPDATE apps SET status='queued' WHERE id=?").run(a.id);deploy(a)}else if(act==="stop"){await docker(["rm","-f",a.container]);db.prepare("UPDATE apps SET status='stopped' WHERE id=?").run(a.id);log(a.id,"Stopped")}else if(act==="restart"){await docker(["restart",a.container]);db.prepare("UPDATE apps SET status='running' WHERE id=?").run(a.id);log(a.id,"Restarted")}else return s.status(400).json({error:"Unsupported action"});s.json({ok:true})}catch(e){s.status(500).json({error:e.message})}});
app.delete("/api/apps/:id",auth,async(q,s)=>{const a=db.prepare("SELECT * FROM apps WHERE id=?").get(q.params.id);if(!a)return s.status(404).json({error:"App not found"});try{await docker(["rm","-f",a.container])}catch{}db.prepare("DELETE FROM logs WHERE app_id=?").run(a.id);db.prepare("DELETE FROM apps WHERE id=?").run(a.id);s.json({ok:true})});
app.get("*",(q,s)=>s.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,"0.0.0.0",()=>console.log("Webbase Cloud listening on "+PORT));
