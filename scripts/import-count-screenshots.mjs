import path from 'node:path';
import fs from 'node:fs/promises';
import { backup } from 'node:sqlite';
import { openStore } from '../src/store.js';
import { readCountScreenshots,applyCountSnapshots } from '../src/count-snapshots.js';
const root=path.resolve(import.meta.dirname,'..');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
if(!process.argv[2])throw new Error('请指定包含 counts.tsv 的来源目录');
const source=path.resolve(process.argv[2]);
const data=path.join(root,'dist',`CrescentMusic-${pkg.version}`,'Data');
const store=await openStore(path.join(data,'crescent.sqlite'));
try{
 const rows=await readCountScreenshots(source);
 const directory=path.join(data,'imports');await fs.mkdir(directory,{recursive:true});
 const backupFile=path.join(directory,`before-screenshot-counts-${Date.now()}.sqlite`);
 await backup(store.db,backupFile);
 const before=store.snapshot();const previous=new Map(store.all('SELECT * FROM play_baselines').map(b=>[b.track,b]));
 const eventCount=store.all('SELECT COUNT(*) AS n FROM plays')[0].n;
 const plan=applyCountSnapshots(store,rows);
 const after=store.snapshot();
 for(const match of plan.matches){
   const old=previous.get(match.track),t=after.tracks.find(t=>t.id===match.track);
   const expected=old?.source_key===match.sourceKey?before.tracks.find(t=>t.id===match.track).plays+match.total-old.total:match.total;
   if(t.plays!==expected)throw new Error(`累计值核验失败：${match.title}`);
 }
 for(const t of after.tracks)if(t.weekPlays!==before.tracks.find(b=>b.id===t.id).weekPlays)throw new Error('近一周计数发生变化');
 if(eventCount!==store.all('SELECT COUNT(*) AS n FROM plays')[0].n)throw new Error('原始事件数发生变化');
 const report={source,backup:backupFile,rows:rows.length,matched:plan.matches.length,pending:plan.pending.length,matchedTotal:plan.matches.reduce((n,r)=>n+r.total,0),
  matches:plan.matches.map(m=>({...m,selected:after.tracks.find(t=>t.id===m.track)})),unmatched:plan.pending,duplicates:plan.duplicates};
 const file=path.join(directory,`screenshot-counts-${Date.now()}.json`);await fs.writeFile(file,JSON.stringify(report,null,2));
 await fs.cp(source,path.join(directory,`screenshot-reference-${Date.now()}`),{recursive:true});
 console.log({rows:report.rows,matched:report.matched,pending:report.pending,matchedTotal:report.matchedTotal,eventCount,backup:backupFile,report:file});
}finally{store.db.close();}
