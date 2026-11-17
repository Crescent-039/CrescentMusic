import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const titleKey=value=>value.normalize('NFKC').replace(/\s+/g,' ').trim();
const artistKey=value=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,'');

export async function readCountScreenshots(folder) {
  const tsv=await fs.readFile(path.join(folder,'counts.tsv'),'utf8');
  const [header,...records]=tsv.trim().split(/\r?\n/),columns=header.split('\t');
  const required=['rank','title','artist','total','captured_at','reference'];
  if(required.some(name=>!columns.includes(name)))throw new Error('累计 TSV 缺少必需列');
  const rows=records.map(line=>Object.fromEntries(line.split('\t').map((value,i)=>[columns[i],value])));
  const seen=new Set(),hash=createHash('sha256').update(tsv);
  for(const name of [...new Set(rows.map(row=>row.reference))].sort()){
    const resolved=path.resolve(folder,name),relative=path.relative(path.resolve(folder),resolved);
    if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('来源图片必须位于来源目录内');
    hash.update(await fs.readFile(resolved));
  }
  const dataset=hash.digest('hex');
  return rows.map(row=>{
    const rank=Number(row.rank),total=Number(row.total),captured=Date.parse(row.captured_at);
    if(!Number.isSafeInteger(rank)||rank<=0||seen.has(rank)||!Number.isSafeInteger(total)||total<0||!row.title||!row.artist||!Number.isFinite(captured)||!/(Z|[+-]\d{2}:\d{2})$/.test(row.captured_at))throw new Error('累计 TSV 含无效行或重复排名');
    seen.add(rank);
    return {rank,title:row.title,artist:row.artist,total,captured,reference:row.reference,sourceKey:'screenshot:'+dataset+':'+rank,localTitle:row.local_title||row.title,localArtist:row.local_artist||row.artist};
  });
}

export function matchCountSnapshots(rows,tracks) {
  const matches=[],pending=[],duplicates=[];
  for(const row of rows) {
    const candidates=tracks.filter(t=>titleKey(t.title)===titleKey(row.localTitle)&&
      (t.artist==='未知歌手'||artistKey(t.artist)===artistKey(row.localArtist || row.artist)));
    if(!candidates.length){pending.push(row);continue;}
    const versions=new Set(candidates.map(t=>`${t.album}\0${Math.round(t.duration)}`));
    if(versions.size>1){pending.push({...row,reason:'ambiguous-version',candidates:candidates.map(t=>t.id)});continue;}
    candidates.sort((a,b)=>(b.format==='FLAC')-(a.format==='FLAC')||(b.file_size || 0)-(a.file_size || 0)||a.id.localeCompare(b.id));
    matches.push({...row,track:candidates[0].id});
    if(candidates.length>1)duplicates.push({rank:row.rank,title:row.title,selected:candidates[0].id,skipped:candidates.slice(1).map(t=>t.id)});
  }
  return {matches,pending,duplicates};
}

export function applyCountSnapshots(store,rows) {
  const tracks=store.all('SELECT id,title,artist,album,duration,format,file_size FROM tracks');
  const plan=matchCountSnapshots(rows,tracks);
  const cutoff=store.all('SELECT COALESCE(MAX(id),0) AS id FROM plays')[0].id;
  store.db.exec('BEGIN');
  try {
    for(const row of rows)store.run(`INSERT INTO count_snapshots(source_key,rank,title,artist,total,captured_at,reference,local_title,local_artist)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET title=excluded.title,artist=excluded.artist,total=excluded.total,local_title=excluded.local_title,local_artist=excluded.local_artist`,
      [row.sourceKey,row.rank,row.title,row.artist,row.total,row.captured,row.reference,row.localTitle,row.localArtist || row.artist]);
    for(const row of plan.matches){
      store.run('DELETE FROM play_baselines WHERE source_key=? AND track<>?',[row.sourceKey,row.track]);
      store.run(`INSERT INTO play_baselines(track,total,captured_at,play_id,source_key) VALUES (?,?,?,?,?)
      ON CONFLICT(track) DO UPDATE SET total=excluded.total,captured_at=excluded.captured_at,
      play_id=CASE WHEN play_baselines.source_key=excluded.source_key THEN play_baselines.play_id ELSE excluded.play_id END,source_key=excluded.source_key
      WHERE excluded.captured_at>=play_baselines.captured_at`,[row.track,row.total,row.captured,cutoff,row.sourceKey]);
      store.run("UPDATE tracks SET artist=? WHERE id=? AND artist='未知歌手'",[row.artist,row.track]);
    }
    store.db.exec('COMMIT');
  }catch(error){store.db.exec('ROLLBACK');throw error;}
  return plan;
}

export function reconcileCountSnapshots(store) {
  const rows=store.all('SELECT source_key AS sourceKey,rank,title,artist,total,captured_at AS captured,reference,local_title AS localTitle,local_artist AS localArtist FROM count_snapshots ORDER BY captured_at,rank');
  if(rows.length)applyCountSnapshots(store,rows);
}
