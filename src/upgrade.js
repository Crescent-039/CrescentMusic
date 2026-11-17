import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { DatabaseSync, backup } from 'node:sqlite';
import { isManaged } from './library.js';

// Only a fresh release receives a snapshot; an existing release keeps its own data.
export async function migrateRelease(previousRoot, nextRoot, legacyDatabase) {
  const destination = path.join(nextRoot,'Data','crescent.sqlite');
  if (existsSync(destination)) return { migrated:false, reason:'existing-data' };
  const previousDatabase = path.join(previousRoot,'Data','crescent.sqlite');
  const source = existsSync(previousDatabase) ? previousDatabase : legacyDatabase;
  await fs.mkdir(path.join(nextRoot,'Data'),{recursive:true});
  const staging = await fs.mkdtemp(path.join(nextRoot,'.upgrade-'));
  try {
    const oldMusic = path.join(previousRoot,'Music');
    const newMusic = path.join(nextRoot,'Music');
    const oldData = path.join(previousRoot,'Data');
    if(previousRoot!==nextRoot&&existsSync(oldData))await fs.cp(oldData,path.join(staging,'Data'),{
      recursive:true,preserveTimestamps:true,
      filter:file=>!['crescent.sqlite','crescent.sqlite-wal','crescent.sqlite-shm','crescent.sqlite-journal'].includes(path.basename(file))
    });
    if (previousRoot !== nextRoot && existsSync(oldMusic)) {
      if (existsSync(newMusic)) throw new Error('新版 Music 已存在且尚无迁移数据库，请先检查目录后再更新');
      await fs.cp(oldMusic,path.join(staging,'Music'),{recursive:true,preserveTimestamps:true});
    }
    let tracks = 0;
    if (source && existsSync(source)) {
      const original = new DatabaseSync(source,{readOnly:true});
      try { await backup(original,path.join(staging,'crescent.sqlite')); } finally { original.close(); }
      const copied = new DatabaseSync(path.join(staging,'crescent.sqlite'));
      try {
        const rows = copied.prepare('SELECT id,path FROM tracks').all();
        tracks = rows.length;
        copied.exec('BEGIN');
        const update = copied.prepare('UPDATE tracks SET path=? WHERE id=?');
        for (const row of rows) if (isManaged(row.path,oldMusic)) update.run(path.join(newMusic,path.relative(oldMusic,row.path)),row.id);
        copied.exec('COMMIT');
      } finally { copied.close(); }
    }
    if (existsSync(path.join(staging,'Music'))) await fs.rename(path.join(staging,'Music'),newMusic);
    if (existsSync(path.join(staging,'Data'))) {
      for(const entry of await fs.readdir(path.join(staging,'Data')))await fs.cp(path.join(staging,'Data',entry),path.join(nextRoot,'Data',entry),{recursive:true,force:false,errorOnExist:true});
    }
    if (existsSync(path.join(staging,'crescent.sqlite'))) await fs.rename(path.join(staging,'crescent.sqlite'),destination);
    const report={migrated:true,previousRoot,nextRoot,source:source || null,tracks,at:new Date().toISOString()};
    await fs.writeFile(path.join(nextRoot,'Data','upgrade.json'),JSON.stringify(report,null,2));
    return report;
  } finally {
    const resolved=path.resolve(staging);
    if (!isManaged(resolved,path.resolve(nextRoot))) throw new Error('迁移临时目录越界');
    await fs.rm(resolved,{recursive:true,force:true});
  }
}

export async function previousRelease(dist, version) {
  const compare = (a,b) => { const x=a.split('.').map(Number),y=b.split('.').map(Number);return x[0]-y[0]||x[1]-y[1]||x[2]-y[2]; };
  const versions=(await fs.readdir(dist,{withFileTypes:true})).filter(e=>e.isDirectory()&&/^CrescentMusic-\d+\.\d+\.\d+$/.test(e.name))
    .map(e=>e.name.slice('CrescentMusic-'.length)).filter(v=>compare(v,version)<0).sort(compare);
  return versions.length ? path.join(dist,`CrescentMusic-${versions.at(-1)}`) : null;
}
