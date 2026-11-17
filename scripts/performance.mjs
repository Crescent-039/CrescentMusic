import { _electron as electron } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.js';
const root=path.resolve(import.meta.dirname,'..');
const label=process.argv[2] || 'current';
const count=Number(process.argv[3] || 500);
const profile=path.join(root,'test-results',`performance-${label}-${Date.now()}`);
await fs.mkdir(profile,{recursive:true});
const art=Buffer.concat([await fs.readFile(path.join(root,'tests/fixtures/cover.png')),Buffer.alloc(count>=1000?0:64000,42)]);
const image=`data:image/png;base64,${art.toString('base64')}`;
const store=await openStore(path.join(profile,'crescent.sqlite'));
store.db.exec('BEGIN');
for(let i=0;i<count;i++){
 const id=`track-${String(i).padStart(5,'0')}`;
 store.run('INSERT INTO tracks (id,path,title,artist,album,duration,format,cover,added,favorite,content_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[id,path.join(profile,'Music',id+'.mp3'),`Song ${String(i).padStart(5,'0')}`,'Crescent Studio','Performance',180,'MP3',image,Date.now()-i,i%5===0?1:0,id]);
 if(i%3===0)store.run('INSERT INTO plays (track,at) VALUES (?,?)',[id,Date.now()]);
}
store.db.exec('COMMIT');store.db.close();
await fs.mkdir(path.join(profile,'Music'),{recursive:true});
await fs.copyFile(path.join(root,'tests/fixtures/Moonrise.mp3'),path.join(profile,'Music','track-00000.mp3'));
const options={cwd:root,timeout:60000,args:[`--user-data-dir=${profile}`]};
if(process.env.CRESCENT_EXE)options.executablePath=process.env.CRESCENT_EXE;else options.args.unshift(root);
const start=performance.now();
const app=await electron.launch(options);
try{
 const page=await app.firstWindow();
 await page.waitForFunction(()=>document.querySelector('#library-count').textContent!=='',{},{timeout:60000});
 const startupMs=performance.now()-start;
 await page.evaluate(()=>Promise.all(Array.from(document.images).filter(img=>{const r=img.getBoundingClientRect();return r.top<innerHeight&&r.bottom>40;}).map(img=>img.decode())));
 const snapshot=await page.evaluate(async()=>{const start=performance.now();const s=await window.crescent.call('snapshot');return{ms:performance.now()-start,bytes:new TextEncoder().encode(JSON.stringify(s)).length};});
 const switches=[];
 for(const view of ['unplayed','favorites','library','unplayed','library','unplayed']){
  switches.push(await page.evaluate(async view=>{
   const start=performance.now();document.querySelector(`[data-view="${view}"]`).click();const syncMs=performance.now()-start;
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   return{view,syncMs,paintMs:performance.now()-start,rows:document.querySelectorAll('#track-list .track-row').length};
  },view));
 }
 const checks={};
 if(!label.startsWith('before')){
  assert.ok(snapshot.bytes<count*700,'Snapshot must contain lightweight metadata');
  assert.ok(switches.every(s=>s.rows<=30),'Visible song rows must be bounded');
  await page.evaluate(()=>{document.querySelector('[data-view="library"]').click();window.scrollTo(0,document.querySelector('#track-list').offsetTop+68*200);});
  await page.waitForFunction(()=>Number(document.querySelector('#track-list .track-row')?.dataset.track.split('-')[1])>=190);
  checks.scrolledRows=await page.locator('#track-list .track-row').count();
  assert.ok(checks.scrolledRows<=30);
  await page.locator('#search').fill(`Song ${String(count-1).padStart(5,'0')}`);
  await page.waitForFunction(()=>document.querySelector('#track-list').dataset.count==='1');
  assert.match(await page.locator('.track-info strong').first().textContent(),new RegExp(String(count-1).padStart(5,'0')));
  await page.locator('#search').fill('');
  await page.locator('#play-all').click();
  await page.waitForFunction(()=>document.querySelector('#audio').currentTime>.05);
  await page.locator('#audio').evaluate(a=>a.pause());
  await page.locator('#queue-open').click();
  assert.equal(await page.locator('#queue-list').getAttribute('data-count'),String(count));
  assert.ok(await page.locator('.queue-row').count()<=30);
  await page.locator('#drawer').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await page.waitForFunction(count=>document.querySelector(`[data-queue-play="track-${String(count-1).padStart(5,'0')}"]`),count);
  checks.queueRows=await page.locator('.queue-row').count();
  assert.ok(checks.queueRows<=30);
  console.log('PASS: bounded rows, scroll, search and full queue for',count,'songs');
 }
 const result={label,count,startupMs,snapshot,switches,checks};
 await fs.writeFile(path.join(root,'test-results',`performance-${label}.json`),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}finally{await app.close();}
