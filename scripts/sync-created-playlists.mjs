import fs from 'node:fs/promises';
import path from 'node:path';
import { backup } from 'node:sqlite';
import { openStore } from '../src/store.js';
import { readCreatedNeteasePlaylists,importCreatedPlaylists } from '../src/netease-playlists.js';
const root=path.resolve(import.meta.dirname,'..');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const source=path.join(process.env.LOCALAPPDATA,'NetEase/CloudMusic/Library/webdb.dat');
const bundle=readCreatedNeteasePlaylists(source);
const data=path.join(root,'dist',`CrescentMusic-${pkg.version}`,'Data');
const store=await openStore(path.join(data,'crescent.sqlite'));
try {
 const imports=path.join(data,'imports');await fs.mkdir(imports,{recursive:true});
 const before=store.snapshot();
 const backupFile=path.join(imports,`before-created-playlists-${Date.now()}.sqlite`);await backup(store.db,backupFile);
 const playlists=importCreatedPlaylists(store,bundle);
 const after=store.snapshot();
 if(JSON.stringify(before.tracks.map(t=>[t.id,t.plays,t.weekPlays,t.favorite]))!==JSON.stringify(after.tracks.map(t=>[t.id,t.plays,t.weekPlays,t.favorite])))throw new Error('歌单导入影响了歌曲统计或收藏');
 const report={source,capturedAt:bundle.capturedAt,backup:backupFile,playlists};
 const file=path.join(imports,'created-playlists-sync.json');await fs.writeFile(file,JSON.stringify(report,null,2));
 console.log({playlists:playlists.length,cachedItems:playlists.reduce((n,p)=>n+p.cached,0),matchedItems:playlists.reduce((n,p)=>n+p.matched,0),pendingItems:playlists.reduce((n,p)=>n+p.pending,0),cacheMismatches:playlists.filter(p=>p.cacheMismatch).length,report:file});
} finally {store.db.close();}
