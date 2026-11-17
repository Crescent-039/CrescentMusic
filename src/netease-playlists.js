import { DatabaseSync } from 'node:sqlite';

function requestKey(id) {
  const end=id.lastIndexOf('}');
  return {request:JSON.parse(id.slice(0,end+1)),captured:Number(id.slice(end+2))};
}
function songInfo(song,id) {
  if(!song)return {id,title:`网易云歌曲 ${id}`,artist:'未知歌手',album:'未知专辑',duration:0,known:false};
  const artists=song.artists || song.ar;
  if(typeof song.name!=='string'||!Array.isArray(artists))throw new Error(`网易云歌曲 ${id} 的缓存资料格式无法识别`);
  return {id,title:song.name,artist:artists.map(a=>a.name).join(' / '),album:(song.album || song.al)?.name || '未知专辑',duration:(song.duration ?? song.dt)/1000,known:true};
}

export function readCreatedNeteasePlaylists(file) {
  const db=new DatabaseSync(file,{readOnly:true});
  try {
    const active=db.prepare('SELECT uid FROM playingCount ORDER BY updateTime DESC LIMIT 1').get();
    if(!active)throw new Error('网易云本地缓存缺少当前账号标识');
    let latest=null;
    for(const row of db.prepare("SELECT id,jsonStr FROM requestCache WHERE id LIKE '%user/playlist%'").iterate()){
      const {request,captured}=requestKey(row.id);
      if(String(request.uid)!==String(active.uid))continue;
      const cached=JSON.parse(JSON.parse(row.jsonStr).cache);
      if(cached.code!==200||cached.more!==false||!Array.isArray(cached.playlist)||!cached.playlist.length)continue;
      if(!latest||captured>latest.captured)latest={captured,playlists:cached.playlist};
    }
    if(!latest)throw new Error('本地没有完整的账号歌单列表缓存');
    const created=latest.playlists.filter(p=>String(p.creator?.userId ?? p.userId)===String(active.uid)&&p.specialType===0);
    const wanted=new Set(created.map(p=>String(p.id)));
    const lists=new Map([...wanted].map(id=>[id,[]]));
    const metadata=new Map();
    for(const row of db.prepare("SELECT id,jsonStr FROM requestCache WHERE id LIKE '%v6/playlist/detail%'").iterate()){
      const data=JSON.parse(JSON.parse(row.jsonStr).cache),p=data.playlist;
      if(data.code!==200||!p||!wanted.has(String(p.id))||!Array.isArray(p.trackIds))continue;
      lists.get(String(p.id)).push({ids:p.trackIds.map(t=>String(t.id)),captured:requestKey(row.id).captured});
      for(const song of p.tracks || [])metadata.set(String(song.id),song);
    }
    for(const row of db.prepare('SELECT id,jsonStr FROM playlistTrackIds').iterate()){
      if(!wanted.has(row.id))continue;
      const data=JSON.parse(row.jsonStr);
      if(!Array.isArray(data.trackIds))throw new Error('网易云歌单缓存缺少歌曲 ID 列表');
      lists.get(row.id).push({ids:data.trackIds.map(t=>String(t.id)),captured:data.updateTime});
    }
    const page=db.prepare("SELECT jsonStr FROM persistentModel WHERE uniKey='page:playlist'").get();
    if(page){
      const cached=JSON.parse(page.jsonStr);
      for(const [id,p] of Object.entries(cached.data.entities))if(wanted.has(id)&&Array.isArray(p.trackIds))lists.get(id).push({ids:p.trackIds.map(t=>String(t.id)),captured:cached.time});
      for(const [id,song] of Object.entries(cached.data.trackEntities))metadata.set(id,song);
    }
    const detail=db.prepare('SELECT jsonStr FROM dbTrack WHERE id=?');
    const playlists=created.map((p,order)=>{
      const candidates=lists.get(String(p.id));
      candidates.sort((a,b)=>Number(b.ids.length===p.trackCount)-Number(a.ids.length===p.trackCount)||b.captured-a.captured);
      const selected=candidates[0];
      const ids=[...new Set(selected?.ids || [])];
      const tracks=ids.map(id=>{if(!metadata.has(id)){const row=detail.get(id);if(row)metadata.set(id,JSON.parse(row.jsonStr));}return songInfo(metadata.get(id),id);});
      return {id:String(p.id),name:p.name,coverUrl:p.coverImgUrl,expected:p.trackCount,cached:ids.length,cacheMismatch:ids.length!==p.trackCount,
        cachedAt:selected?.captured || null,order,tracks};
    });
    return {source:file,capturedAt:latest.captured,playlists};
  } finally {db.close();}
}

const titleKey=s=>s.normalize('NFKC').replace(/\s+/g,' ').trim();
const artistKey=s=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase().replace(/\s+/g,'');
const primary=s=>artistKey(s.split(/[,/、;；]/)[0]);
export function matchPlaylistSong(song,tracks) {
  if(!song.known)return null;
  let candidates=tracks.filter(t=>!t.missing&&titleKey(t.title)===titleKey(song.title)&&
    (artistKey(t.artist)===artistKey(song.artist)||primary(t.artist)===primary(song.artist))&&Math.abs(t.duration-song.duration)<=2);
  const album=candidates.filter(t=>titleKey(t.album)===titleKey(song.album));
  if(album.length)candidates=album;
  if(!candidates.length)return null;
  if(new Set(candidates.map(t=>`${t.album}\0${Math.round(t.duration)}`)).size>1)return null;
  candidates.sort((a,b)=>(b.format==='FLAC')-(a.format==='FLAC')||(b.file_size || 0)-(a.file_size || 0)||a.id.localeCompare(b.id));
  return candidates[0].id;
}

export function importCreatedPlaylists(store,bundle) {
  const tracks=store.all('SELECT id,title,artist,album,duration,format,file_size,missing FROM tracks');
  const report=[];
  store.db.exec('BEGIN');
  try {
    for(const p of bundle.playlists){
      const id=`netease-${p.id}`;
      store.run('INSERT INTO playlists(id,name,sort_order) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sort_order=excluded.sort_order',[id,p.name,p.order]);
      // Source-owned links are replaceable; locally added songs stay in the playlist.
      for(const old of store.all('SELECT local_track FROM remote_playlist_items WHERE playlist=? AND managed=1 AND local_track IS NOT NULL',[id]))store.run('DELETE FROM playlist_tracks WHERE playlist=? AND track=?',[id,old.local_track]);
      store.run('DELETE FROM remote_playlist_items WHERE playlist=?',[id]);
      store.run(`INSERT INTO playlist_origins(playlist,external_id,expected_count,cached_count,cache_mismatch,cached_at,cover_url) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(playlist) DO UPDATE SET expected_count=excluded.expected_count,cached_count=excluded.cached_count,cache_mismatch=excluded.cache_mismatch,cached_at=excluded.cached_at,cover_url=excluded.cover_url`,
        [id,p.id,p.expected,p.cached,p.cacheMismatch?1:0,p.cachedAt,p.coverUrl || null]);
      let matched=0;
      for(const [position,song] of p.tracks.entries()){
        const local=matchPlaylistSong(song,tracks);
        let managed=0;
        if(local){const r=store.run('INSERT OR IGNORE INTO playlist_tracks VALUES (?,?,?)',[id,local,position]);managed=r.changes?1:0;matched++;}
        store.run('INSERT INTO remote_playlist_items(playlist,song_id,position,title,artist,album,duration,known,local_track,managed) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [id,song.id,position,song.title,song.artist,song.album,song.duration,song.known?1:0,local,managed]);
      }
      report.push({id,externalId:p.id,name:p.name,expected:p.expected,cached:p.cached,matched,pending:p.cached-matched,cacheMismatch:p.cacheMismatch});
    }
    store.db.exec('COMMIT');
  }catch(error){store.db.exec('ROLLBACK');throw error;}
  return report;
}

export function reconcilePlaylistItems(store) {
  const tracks=store.all('SELECT id,title,artist,album,duration,format,file_size,missing FROM tracks');
  const pending=store.all('SELECT * FROM remote_playlist_items WHERE local_track IS NULL AND known=1 AND suppressed=0');
  for(const item of pending){
    const local=matchPlaylistSong({...item,known:true},tracks);
    if(!local)continue;
    const result=store.run('INSERT OR IGNORE INTO playlist_tracks VALUES (?,?,?)',[item.playlist,local,item.position]);
    store.run('UPDATE remote_playlist_items SET local_track=?,managed=? WHERE playlist=? AND song_id=?',[local,result.changes?1:0,item.playlist,item.song_id]);
  }
}
