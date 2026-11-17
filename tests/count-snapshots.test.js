import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.js';
import { applyCountSnapshots,readCountScreenshots } from '../src/count-snapshots.js';

test('screenshot totals replace overlapping history and retain dates, subsequent plays, case variants and FLAC preference',async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'crescent-counts-'));let s;
 try{
  s=await openStore(path.join(folder,'db.sqlite'));
  for(const [id,title,format] of [['mp3','Song','MP3'],['flac','Song','FLAC'],['other','song','MP3']])s.run('INSERT INTO tracks(id,path,title,artist,album,duration,format,added) VALUES (?,?,?,?,?,?,?,?)',[id,id+'.audio',title,'Artist','Album',180,format,1]);
  assert.equal(s.trackStats('flac').plays,0);
  const now=Date.now();s.run("INSERT INTO plays(track,at,source,source_key) VALUES (?,?,'netease-local',?)",['flac',now-1000,'old-event']);
  const rows=[{rank:1,title:'Song',artist:'Artist',localTitle:'Song',total:120,captured:now,reference:'shot.png',sourceKey:'shot-1'},
   {rank:2,title:'song',artist:'Artist',localTitle:'song',total:40,captured:now,reference:'shot.png',sourceKey:'shot-2'}];
  const result=applyCountSnapshots(s,rows);assert.equal(result.matches.length,2);
  let snapshot=s.snapshot();assert.equal(snapshot.tracks.find(t=>t.id==='flac').plays,120);assert.equal(snapshot.tracks.find(t=>t.id==='mp3').plays,0);assert.equal(snapshot.tracks.find(t=>t.id==='other').plays,40);
  assert.equal(s.trackStats('flac').weekPlays,1);assert.equal(s.trackStats('flac').plays,120);
  s.run("INSERT INTO plays(track,at) VALUES (?,?)",['flac',now+1000]);
  assert.equal(s.trackStats('flac').plays,121);
  applyCountSnapshots(s,rows);assert.equal(s.trackStats('flac').plays,121);
  assert.equal(s.snapshot().tracks.find(t=>t.id==='flac').plays,121);
  s.run("INSERT INTO plays(track,at,source,source_key) VALUES (?,?,'netease-local',?)",['flac',now-2000,'late-old-event']);
  assert.equal(s.trackStats('flac').plays,121);
  assert.equal(s.all('SELECT COUNT(*) AS n FROM plays')[0].n,3);
 }finally{s?.db.close();await fs.rm(folder,{recursive:true,force:true});}
});

test('generic TSV accepts arbitrary rows and explicit aliases, hashes sources, rejects duplicate ranks and escaping references',async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'crescent-transcription-'));
 try{
  await fs.writeFile(path.join(folder,'reference.png'),'synthetic source');
  const header='rank\ttitle\tartist\ttotal\tcaptured_at\treference\tlocal_title\tlocal_artist\n';
  const row='1\tSource title\tSource artist\t12\t2026-01-01T00:00:00Z\treference.png\tLocal title\tLocal artist\n';
  await fs.writeFile(path.join(folder,'counts.tsv'),header+row);
  const result=await readCountScreenshots(folder);assert.equal(result.length,1);assert.equal(result[0].localTitle,'Local title');assert.equal(result[0].localArtist,'Local artist');assert.equal(result[0].total,12);
  assert.deepEqual(await readCountScreenshots(folder),result);
  await fs.writeFile(path.join(folder,'counts.tsv'),header+row+row);await assert.rejects(readCountScreenshots(folder),/重复排名/);
  await fs.writeFile(path.join(folder,'counts.tsv'),header+row.replace('reference.png','../outside.png'));await assert.rejects(readCountScreenshots(folder),/来源目录内/);
 }finally{await fs.rm(folder,{recursive:true,force:true});}
});
