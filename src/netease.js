import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const normalize = value => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,'');
const artistKey = value => value.split(/[,/、;；]/).map(normalize).filter(Boolean).sort().join('/');
const artistMatches = (local,remote) => artistKey(local)===artistKey(remote) || artistKey(local)===normalize(remote.split(/[,/、;；]/)[0]);
export function readNeteaseDatabase(file) {
  const db=new DatabaseSync(file,{readOnly:true});
  try {
    const rows=db.prepare("SELECT resourceId,playDuration,updateTime,uid FROM playingCount WHERE resourceType='track'").all();
    const events=[];
    for(const row of rows) {
      if(!Number.isSafeInteger(row.updateTime)||row.updateTime<=0||!Number.isFinite(row.playDuration)||row.playDuration<0)throw new Error('网易云播放记录包含无效日期或时长');
      if(row.playDuration<=60)continue;
      const songId=String(row.resourceId);
      const key=createHash('sha256').update(`${row.uid}\0${songId}\0${row.updateTime}`).digest('hex');
      events.push({songId,at:row.updateTime,key});
    }
    const detail=db.prepare('SELECT jsonStr FROM dbTrack WHERE id=?');
    const songs=[];
    for(const id of new Set(events.map(e=>e.songId))) {
      const row=detail.get(id);
      if(!row){songs.push({id,title:'',artist:'',duration:0});continue;}
      const song=JSON.parse(row.jsonStr);
      if(typeof song.name!=='string'||!Array.isArray(song.artists))throw new Error('网易云歌曲资料格式无法识别');
      songs.push({id,title:song.name,artist:song.artists.map(a=>a.name).join(' / '),duration:song.duration/1000});
    }
    return {source:file,totalRecords:rows.length,eligibleRecords:events.length,events,songs};
  } finally { db.close(); }
}

export function planNeteaseImport(history,tracks) {
  const index=new Map();
  for(const t of tracks) {
    if(t.missing)continue;
    const key=normalize(t.title);
    if(!index.has(key))index.set(key,[]);
    index.get(key).push(t);
  }
  const songs=history.songs.map(song=>{
    // The original importer saved common.artist, which is the first credited artist.
    const candidates=song.title&&song.artist ? (index.get(normalize(song.title)) || [])
      .filter(t=>artistMatches(t.artist,song.artist)&&Math.abs(t.duration-song.duration)<=2) : [];
    return {...song,candidates:candidates.map(t=>({id:t.id,title:t.title,artist:t.artist,format:t.format,duration:t.duration})),track:candidates.length===1?candidates[0].id:null};
  });
  const mapped=new Map(songs.filter(s=>s.track).map(s=>[s.id,s.track]));
  return {history,songs,mapped,matchedSongs:mapped.size,matchedEvents:history.events.filter(e=>mapped.has(e.songId)).length};
}

export function applyNeteaseImport(store,plan,choices={}) {
  const mapping=new Map(plan.mapped);
  for(const [song,id] of Object.entries(choices)) {
    const candidate=plan.songs.find(s=>s.id===song)?.candidates.find(t=>t.id===id);
    if(!candidate)throw new Error('歌曲匹配已失效，请重新预览');
    mapping.set(song,id);
  }
  let added=0,duplicates=0;
  store.db.exec('BEGIN');
  try {
    for(const e of plan.history.events) {
      const id=mapping.get(e.songId);
      if(!id)continue;
      const result=store.run("INSERT OR IGNORE INTO plays (track,at,source,source_key) VALUES (?,?,'netease-local',?)",[id,e.at,e.key]);
      if(result.changes)added++;else duplicates++;
    }
    store.db.exec('COMMIT');
  } catch(error){store.db.exec('ROLLBACK');throw error;}
  return {added,duplicates,matchedSongs:mapping.size,unmatchedSongs:plan.songs.filter(s=>!mapping.has(s.id)).map(s=>({id:s.id,title:s.title,artist:s.artist,ambiguous:s.candidates.length>1})),
    eligibleRecords:plan.history.eligibleRecords,totalRecords:plan.history.totalRecords,source:plan.history.source,
    first:plan.history.events.length?Math.min(...plan.history.events.map(e=>e.at)):null,last:plan.history.events.length?Math.max(...plan.history.events.map(e=>e.at)):null};
}
