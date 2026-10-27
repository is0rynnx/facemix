import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {dirname,resolve,relative,isAbsolute,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const mount=process.argv.find(a=>a.startsWith('--base='))?.slice(7).replace(/\/$/,'')??'';
if(mount&&!/^\/[a-z0-9/_-]+$/i.test(mount))throw new Error('Invalid base path.');
const port=Number(process.argv.find(a=>a.startsWith('--port='))?.slice(7)??process.env.FACEMIX_PORT??8768);
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port.');
try{await stat(resolve(root,'index.html'));}catch{throw new Error('Build FaceMix first: npm install, then npm run build.');}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp'};
const server=createServer(async(req,res)=>{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
 try{
  let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(mount){if(pathname===mount){res.writeHead(302,{Location:mount+'/'}).end();return;}if(!pathname.startsWith(mount+'/')){res.writeHead(404).end();return;}pathname=pathname.slice(mount.length);}
  const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname)),within=relative(root,file);
  if(within.startsWith('..')||isAbsolute(within)){res.writeHead(403).end();return;}
  const info=await stat(file);if(!info.isFile()){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
  if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
 }catch{res.writeHead(404).end();}
});
server.on('error',error=>{console.error(`FaceMix could not start: ${error.message}`);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`FaceMix: http://127.0.0.1:${server.address().port}/ — all image processing runs in your browser.`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
