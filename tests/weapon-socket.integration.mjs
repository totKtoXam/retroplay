import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base=process.env.RETRO_TEST_URL||'http://localhost:3000';
const session=await fetch(base+'/api/session',{method:'POST'});
const cookie=session.headers.get('set-cookie').split(';')[0];await session.json();
async function req(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,body?.title?201:200,JSON.stringify(data));return data;}
const room=await req('/api/rooms',{title:'QA weapon authority',name:'QA',theme:'nauryz'});
const path='/api/rooms/'+room.id;
let ws;
const pending=new Map();
function connect(){return new Promise((resolve,reject)=>{
  ws=new WebSocket(base.replace(/^http/,'ws')+path+'/socket',{headers:{Cookie:cookie}});
  ws.once('open',resolve);ws.once('error',reject);
  ws.on('message',raw=>{const m=JSON.parse(String(raw));if(m.t!=='weapon')return;const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);p.resolve(m);}});
});}
function command(body){const id=body.id||crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Missing weapon acknowledgement'));},4000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({...body,id,life:0}));});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fire=(over={})=>({t:'effect',kind:'paint',origin:[0,1,4],target:[0,1,0],normal:[0,0,1],color:'#ff647c',...over});
try{
  await connect();
  const id=crypto.randomUUID();const first=await command(fire({id}));
  assert.equal(first.ok,true);assert.equal(first.magazine.rounds.paint,23);
  const duplicate=await command(fire({id}));assert.equal(duplicate.ok,false);assert.equal(duplicate.magazine.rounds.paint,23);
  for(let i=1;i<24;i++){await sleep(195);const r=await command(fire());assert.equal(r.ok,true,JSON.stringify(r));}
  await sleep(195);const empty=await command(fire());assert.equal(empty.ok,false);assert.equal(empty.magazine.rounds.paint,0);
  const loading=await command({t:'weapon',action:'reload',tool:'paint'});assert.ok(loading.magazine.loading);
  const early=await command(fire());assert.equal(early.ok,false);assert.equal(early.magazine.rounds.paint,0);
  await sleep(Math.max(0,loading.magazine.loading.end-loading.now)+30);
  const loaded=await command(fire());assert.equal(loaded.ok,true);assert.equal(loaded.magazine.rounds.paint,23);
  await new Promise(r=>{ws.once('close',r);ws.close();});await connect();
  const sync=await command({t:'weapon',action:'sync'});assert.equal(sync.magazine.rounds.paint,23,'reconnect must not refill ammo');
  const http=await req(path,{type:'weapon',id:crypto.randomUUID(),action:'sync',life:0});assert.equal(http.magazine.rounds.paint,sync.magazine.rounds.paint);
  const invalid=await req(path,{type:'effect',id:crypto.randomUUID(),...fire(),life:99});assert.equal(invalid.reason,'stale-life');
  console.log('PASS: WS acknowledgements, duplicate, empty magazine, reload deadline, reconnect and HTTP fallback.');
}finally{
  for(const p of pending.values())clearTimeout(p.timer);
  if(ws&&ws.readyState===WebSocket.OPEN)await new Promise(r=>{ws.once('close',r);ws.close();});
  await req(path,{type:'archive',value:true});
}
