import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.js';
import { readNeteaseDatabase,planNeteaseImport,applyNeteaseImport } from '../src/netease.js';

test('NetEase read-only import respects duration, dates, conservative matching and idempotency',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'crescent-netease-'));
 let store;
 try{
  const file=path.join(root,'webdb.dat');const db=new DatabaseSync(file);
  db.exec('CREATE TABLE playingCount(resourceId TEXT,playDuration INTEGER,updateTime INTEGER,uid TEXT,resourceType TEXT);CREATE TABLE dbTrack(id TEXT PRIMARY KEY,jsonStr TEXT)');
  const now=Date.now();
  for(const [duration,at] of [[60,now-1000],[61,now],[200,now-9*86400000]])db.prepare('INSERT INTO playingCount VALUES (?,?,?,?,?)').run('n1',duration,at,'user','track');
  db.prepare('INSERT INTO dbTrack VALUES (?,?)').run('n1',JSON.stringify({name:'Song',artists:[{name:'Artist'}],duration:200000}));db.close();
  const before=await fs.readFile(file);
  const history=readNeteaseDatabase(file);assert.equal(history.totalRecords,3);assert.equal(history.eligibleRecords,2);assert.deepEqual(await fs.readFile(file),before);
  store=await openStore(path.join(root,'crescent.sqlite'));
  store.run('INSERT INTO tracks (id,path,title,artist,album,duration,format,added) VALUES (?,?,?,?,?,?,?,?)',['a','a.mp3','Song','Artist','Album',200,'MP3',1]);
  let plan=planNeteaseImport(history,store.snapshot().tracks);assert.equal(plan.matchedSongs,1);
  const collaborative={...history,songs:[{...history.songs[0],artist:'Artist / Guest'}]};
  assert.equal(planNeteaseImport(collaborative,store.snapshot().tracks).matchedSongs,1);
  assert.equal(applyNeteaseImport(store,plan).added,2);const second=applyNeteaseImport(store,plan);assert.equal(second.added,0);assert.equal(second.duplicates,2);
  assert.equal(store.snapshot().tracks[0].plays,2);assert.equal(store.snapshot().tracks[0].weekPlays,1);
  store.run('INSERT INTO tracks (id,path,title,artist,album,duration,format,added) VALUES (?,?,?,?,?,?,?,?)',['b','b.flac','Song','Artist','Album',200,'FLAC',2]);
  plan=planNeteaseImport(history,store.snapshot().tracks);assert.equal(plan.matchedSongs,0);assert.equal(plan.songs[0].candidates.length,2);
  assert.equal(applyNeteaseImport(store,plan).added,0);
  assert.throws(()=>applyNeteaseImport(store,plan,{'n1':'unknown'}),/失效/);
 }finally{store?.db.close();await fs.rm(root,{recursive:true,force:true});}
});
