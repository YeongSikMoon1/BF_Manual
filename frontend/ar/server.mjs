import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('.',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
createServer(async(req,res)=>{
 const requestedPath=decodeURIComponent((req.url||'/').split('?')[0]);
 const path=normalize(requestedPath).replace(/^(\.\.[/\\])+/,''),file=join(root,(requestedPath==='/'||path==='.'||path==='\\')?'index.html':path);
 try{const body=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(body)}catch{res.writeHead(404);res.end('Not found')}
}).listen(process.env.PORT||8000,()=>console.log('BF AR: http://localhost:8000'));
