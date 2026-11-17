export function playlistRows(id,members,entries,lookup) {
  const memberSet=new Set(members),seen=new Set(),rows=[];
  for(const entry of entries){
    if(entry.suppressed)continue;
    const local=entry.localTrack&&memberSet.has(entry.localTrack)?lookup(entry.localTrack):null;
    const orderKey=`remote:${entry.song_id}`;
    if(local){if(!seen.has(local.id)){rows.push({...local,orderKey});seen.add(local.id);}}
    else rows.push({id:`pending-${id}-${entry.song_id}`,orderKey,songId:entry.song_id,title:entry.title,artist:entry.artist,album:entry.album,duration:entry.duration,externalOnly:true,missing:1,plays:0,weekPlays:0,searchText:`${entry.title} ${entry.artist} ${entry.album}`.toLocaleLowerCase()});
  }
  for(const key of members)if(!seen.has(key))rows.push({...lookup(key),orderKey:`track:${key}`});
  return rows;
}

export function orderedPlaylistRows(rows,order) {
  const positions=new Map(order.map((key,index)=>[key,index]));
  return rows.sort((a,b)=>(positions.get(a.orderKey)??Infinity)-(positions.get(b.orderKey)??Infinity));
}

export function savePlaylistOrder(store,id,order) {
  if(!store.all('SELECT id FROM playlists WHERE id=?',[id]).length)throw new Error('歌单已删除');
  const tracks=new Map(store.all('SELECT * FROM tracks').map(t=>[t.id,t]));
  const members=store.all('SELECT track FROM playlist_tracks WHERE playlist=? ORDER BY position',[id]).map(r=>r.track);
  const entries=store.all('SELECT *,local_track AS localTrack FROM remote_playlist_items WHERE playlist=? ORDER BY position',[id]);
  const keys=new Set(playlistRows(id,members,entries,key=>tracks.get(key)).map(r=>r.orderKey));
  if(!Array.isArray(order)||order.length!==keys.size||new Set(order).size!==keys.size||order.some(key=>!keys.has(key)))throw new Error('歌单内容已变化，请刷新后重新排序');
  store.run('INSERT INTO playlist_orders(playlist,items) VALUES (?,?) ON CONFLICT(playlist) DO UPDATE SET items=excluded.items',[id,JSON.stringify(order)]);
}
