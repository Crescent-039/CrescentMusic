import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
for(const name of ['smoke','migration-smoke','import-files-smoke','song-detail-smoke','playlist-order-smoke','taskbar-artwork-smoke','taskbar-smoke','seek-smoke']){
  const result=spawnSync(process.execPath,[path.join(root,'scripts',`${name}.mjs`)],{cwd:root,stdio:'inherit',windowsHide:true});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
