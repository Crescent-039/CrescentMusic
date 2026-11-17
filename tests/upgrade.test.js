import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../src/store.js';
import { migrateRelease } from '../src/upgrade.js';

test('release migration copies audio and all data, rewrites paths, and preserves both versions',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'crescent-upgrade-'));
  const old=path.join(root,'old'),next=path.join(root,'next');
  let original,migrated;
  try{
    await fs.mkdir(path.join(old,'Music'),{recursive:true});await fs.mkdir(next);
    const audio=path.join(old,'Music','song.mp3');await fs.writeFile(audio,'original audio');
    original=await openStore(path.join(old,'Data','crescent.sqlite'));
    original.run('INSERT INTO tracks (id,path,title,artist,album,duration,format,added,favorite,lyrics) VALUES (?,?,?,?,?,?,?,?,?,?)',['a',audio,'Song','Artist','Album',100,'MP3',1,1,'[00:00]Hello']);
    original.run('INSERT INTO playlists (id,name) VALUES (?,?)',['p','Playlist']);original.run('INSERT INTO playlist_tracks VALUES (?,?,?)',['p','a',1]);
    original.run('INSERT INTO plays (track,at) VALUES (?,?)',['a',Date.now()]);
    original.run('INSERT INTO settings VALUES (?,?)',['queue','["a"]']);
    original.run('INSERT INTO playlist_orders VALUES (?,?)',['p','["track:a"]']);
    await fs.mkdir(path.join(old,'Data','imports'));await fs.writeFile(path.join(old,'Data','imports','report.json'),'reference report');
    await migrateRelease(old,next);
    migrated=await openStore(path.join(next,'Data','crescent.sqlite'));
    const s=migrated.snapshot();assert.equal(s.tracks[0].id,'a');assert.equal(s.tracks[0].favorite,1);assert.equal(s.tracks[0].plays,1);assert.equal(s.memberships[0].track,'a');assert.deepEqual(s.settings.queue,['a']);
    assert.equal(s.tracks[0].path,path.join(next,'Music','song.mp3'));
    assert.deepEqual(s.playlistOrders.p,['track:a']);
    assert.equal(await fs.readFile(s.tracks[0].path,'utf8'),'original audio');assert.equal(await fs.readFile(audio,'utf8'),'original audio');
    assert.equal(original.all('SELECT path FROM tracks')[0].path,audio);
    assert.equal(await fs.readFile(path.join(next,'Data','imports','report.json'),'utf8'),'reference report');
    assert.equal((await migrateRelease(old,next)).reason,'existing-data');
  }finally{original?.db.close();migrated?.db.close();await fs.rm(root,{recursive:true,force:true});}
});
