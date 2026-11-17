import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.js';
test('persists favorites and playlists; separates recent week from all-time plays',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'crescent-test-'));
  const file=path.join(folder,'library.sqlite');
  let store;
  try{
    store=await openStore(file);
    store.run('INSERT INTO tracks (id,path,title,artist,album,duration,format,added,favorite) VALUES (?,?,?,?,?,?,?,?,?)',['a',path.join(folder,'a.flac'),'Song','Artist','Album',200,'FLAC',Date.now(),1]);
    store.run('INSERT INTO playlists (id,name,cover) VALUES (?,?,?)',['p','Favorites',null]);
    store.run('UPDATE tracks SET cover=?,lyrics=? WHERE id=?',['data:image/png;base64,'+'a'.repeat(100000),'[00:01]Lyrics','a']);
    store.run('INSERT INTO playlist_tracks VALUES (?,?,?)',['p','a',1]);
    store.run('INSERT INTO plays (track,at) VALUES (?,?)',['a',Date.now()-8*86400000]);
    store.run('INSERT INTO plays (track,at) VALUES (?,?)',['a',Date.now()]);store.db.close();
    store=await openStore(file);
    const snapshot=store.snapshot();
    assert.equal(snapshot.tracks[0].plays,2);assert.equal(snapshot.tracks[0].weekPlays,1);
    assert.equal(snapshot.tracks[0].favorite,1);assert.equal(snapshot.playlists[0].name,'Favorites');assert.equal(snapshot.memberships[0].track,'a');
    assert.equal(snapshot.daily.reduce((n,d)=>n+d.count,0),1);
    assert.equal(store.trackStats('a').plays,2);
    assert.equal(store.trackStats('a').weekPlays,1);
    assert.equal(snapshot.tracks[0].cover,'crescent://cover/track/a?v=0');
    assert.equal('lyrics' in snapshot.tracks[0],false);
    assert.ok(JSON.stringify(snapshot).length<2000);
  }finally{store?.db.close();fs.rmSync(folder,{recursive:true,force:true});}
});
test('corrupted database fails explicitly',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'crescent-test-'));
  try{const file=path.join(folder,'bad.sqlite');fs.writeFileSync(file,'invalid');await assert.rejects(openStore(file));}
  finally{fs.rmSync(folder,{recursive:true,force:true});}
});
