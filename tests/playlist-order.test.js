import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../src/store.js';
import {playlistRows,orderedPlaylistRows,savePlaylistOrder} from '../src/playlist-order.js';

test('playlist ordering persists, validates complete membership, and keeps a pending song position after matching',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'crescent-order-'));let store;
 try{
  store=await openStore(path.join(root,'data.sqlite'));
  store.run("INSERT INTO playlists(id,name) VALUES ('p','Playlist')");
  for(const id of ['a','b','c'])store.run('INSERT INTO tracks(id,path,title,artist,album,duration,format,added) VALUES (?,?,?,?,?,?,?,?)',[id,id,id,'Artist','Album',180,'FLAC',1]);
  for(const [i,id] of ['a','b'].entries())store.run('INSERT INTO playlist_tracks VALUES (?,?,?)',['p',id,i]);
  savePlaylistOrder(store,'p',['track:b','track:a']);
  assert.deepEqual(store.collections().playlistOrders.p,['track:b','track:a']);
  for(const invalid of [['track:a'],['track:a','track:a'],['track:a','track:c']])assert.throws(()=>savePlaylistOrder(store,'p',invalid),/内容已变化/);
  assert.throws(()=>savePlaylistOrder(store,'absent',[]),/已删除/);
  const entry={song_id:'n1',title:'Missing',artist:'Artist',album:'Album',duration:180,localTrack:null};
  store.run('INSERT INTO remote_playlist_items(playlist,song_id,position,title,artist,album,duration,known,managed) VALUES (?,?,?,?,?,?,?,?,?)',['p','n1',0,'Missing','Artist','Album',180,1,0]);
  savePlaylistOrder(store,'p',['track:b','remote:n1','track:a']);
  const lookup=id=>({id,title:id});
  let rows=orderedPlaylistRows(playlistRows('p',['a','b'],[entry],lookup),store.collections().playlistOrders.p);
  assert.deepEqual(rows.map(r=>r.orderKey),['track:b','remote:n1','track:a']);assert.equal(rows[1].externalOnly,true);
  rows=orderedPlaylistRows(playlistRows('p',['a','b','c'],[{...entry,localTrack:'c'}],lookup),store.collections().playlistOrders.p);
  assert.equal(rows[1].id,'c');assert.equal(rows[1].orderKey,'remote:n1');
  store.db.close();store=await openStore(path.join(root,'data.sqlite'));
  assert.deepEqual(store.collections().playlistOrders.p,['track:b','remote:n1','track:a']);
  store.run("DELETE FROM playlists WHERE id='p'");assert.deepEqual(store.collections().playlistOrders,{});
 }finally{store?.db.close();await fs.rm(root,{recursive:true,force:true});}
});
