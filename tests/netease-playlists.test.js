import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.js';
import { readCreatedNeteasePlaylists,importCreatedPlaylists,reconcilePlaylistItems } from '../src/netease-playlists.js';
import {savePlaylistOrder} from '../src/playlist-order.js';

test('only ordinary self-created playlists import, preserving source order, pending items, local extras and FLAC preference',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'crescent-playlist-'));let store;
 try{
  const file=path.join(root,'webdb.dat'),db=new DatabaseSync(file);
  db.exec('CREATE TABLE playingCount(uid TEXT,updateTime INTEGER);CREATE TABLE requestCache(id TEXT,jsonStr TEXT);CREATE TABLE playlistTrackIds(id TEXT,jsonStr TEXT);CREATE TABLE persistentModel(uniKey TEXT,jsonStr TEXT);CREATE TABLE dbTrack(id TEXT,jsonStr TEXT)');
  db.prepare('INSERT INTO playingCount VALUES (?,?)').run('self',1);
  const playlists=[{id:11,name:'My playlist',creator:{userId:'self'},specialType:0,trackCount:2},
   {id:22,name:'Collected',creator:{userId:'other'},specialType:0,trackCount:1},
   {id:33,name:'Annual',creator:{userId:'self'},specialType:20,trackCount:1},
   {id:44,name:'Liked',creator:{userId:'self'},specialType:5,trackCount:1}];
  db.prepare('INSERT INTO requestCache VALUES (?,?)').run(JSON.stringify({url:'/xeapi/user/playlist',uid:'self'})+'-100',JSON.stringify({cache:JSON.stringify({code:200,more:false,playlist:playlists})}));
  db.prepare('INSERT INTO playlistTrackIds VALUES (?,?)').run('11',JSON.stringify({trackIds:[{id:'n2'},{id:'n1'}],updateTime:10}));
  for(const [id,name] of [['n1','Song'],['n2','Missing']])db.prepare('INSERT INTO dbTrack VALUES (?,?)').run(id,JSON.stringify({name,artists:[{name:'Artist'}],album:{name:'Album'},duration:180000}));
  db.close();const bytes=await fs.readFile(file);
  const bundle=readCreatedNeteasePlaylists(file);assert.equal(bundle.playlists.length,1);assert.equal(bundle.playlists[0].id,'11');assert.equal(bundle.playlists[0].tracks[0].title,'Missing');assert.deepEqual(await fs.readFile(file),bytes);
  store=await openStore(path.join(root,'crescent.sqlite'));
  for(const [id,title,format] of [['mp3','Song','MP3'],['flac','Song','FLAC'],['extra','Local extra','MP3']])store.run('INSERT INTO tracks(id,path,title,artist,album,duration,format,added) VALUES (?,?,?,?,?,?,?,?)',[id,id+'.audio',title,'Artist','Album',180,format,1]);
  const result=importCreatedPlaylists(store,bundle);assert.equal(result.length,1);assert.equal(result[0].matched,1);assert.equal(result[0].pending,1);
  assert.equal(store.snapshot().memberships[0].track,'flac');
  store.run('INSERT INTO playlist_tracks VALUES (?,?,?)',['netease-11','extra',100]);
  savePlaylistOrder(store,'netease-11',['track:extra','remote:n1','remote:n2']);
  importCreatedPlaylists(store,bundle);
  assert.deepEqual(store.collections().playlistOrders['netease-11'],['track:extra','remote:n1','remote:n2']);
  assert.equal(store.snapshot().playlists.length,1);assert.equal(store.snapshot().memberships.length,2);
  assert.equal(store.all('SELECT song_id FROM remote_playlist_items ORDER BY position')[0].song_id,'n2');
  store.run('INSERT INTO tracks(id,path,title,artist,album,duration,format,added) VALUES (?,?,?,?,?,?,?,?)',['new','new.flac','Missing','Artist','Album',180,'FLAC',2]);
  reconcilePlaylistItems(store);
  assert.equal(store.all("SELECT local_track FROM remote_playlist_items WHERE song_id='n2'")[0].local_track,'new');
  assert.equal(store.snapshot().memberships.length,3);
 }finally{store?.db.close();await fs.rm(root,{recursive:true,force:true});}
});
