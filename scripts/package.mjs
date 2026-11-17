import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { migrateRelease, previousRelease } from '../src/upgrade.js';
import {writeThirdPartyNotices} from './third-party-notices.mjs';
import electron from 'electron';
import {copyPublicDocs} from './public-docs.mjs';
const root = path.resolve(import.meta.dirname,'..');
const pkg = JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const lock = JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8'));
const clean=process.argv.includes('--clean');
if(process.argv.slice(2).some(arg=>arg!=='--clean'))throw new Error('Unsupported packaging argument');
const out = path.join(root,clean?'release':'dist',`CrescentMusic-${pkg.version}`);
if(clean&&existsSync(out))throw new Error(`干净成品目录已存在，请使用新的版本号或先移走该目录：${out}`);
await fs.mkdir(out,{recursive:true});
const runtime = path.dirname(electron);
const reuseRuntime = existsSync(path.join(out,'Crescent Music.exe')) && existsSync(path.join(out,'version')) &&
  await fs.readFile(path.join(out,'version'),'utf8') === await fs.readFile(path.join(runtime,'version'),'utf8');
if (!reuseRuntime) {
  await fs.cp(runtime,out,{recursive:true});
  await fs.rename(path.join(out,'electron.exe'),path.join(out,'Crescent Music.exe'));
}
const app = path.join(out,'resources/app');
await fs.mkdir(app,{recursive:true});
await fs.cp(path.join(root,'src'),path.join(app,'src'),{recursive:true});
await fs.writeFile(path.join(app,'package.json'),JSON.stringify({...pkg,devDependencies:undefined,crescentDataMigration:clean?'portable-only':undefined},null,2));
for(const [location, info] of Object.entries(lock.packages)) {
  // npm omits optional native packages for other operating systems/architectures.
  if(info.optional&&!existsSync(path.join(root,location)))continue;
  if(location.startsWith('node_modules/') && !info.dev) await fs.cp(path.join(root,location),path.join(app,location),{recursive:true});
}
await copyPublicDocs(root,out);
await fs.copyFile(path.join(root,'LICENSE'),path.join(out,'LICENSE-CrescentMusic.txt'));
await writeThirdPartyNotices(root,path.join(out,'THIRD-PARTY-NOTICES.txt'));
if(clean){
  await fs.mkdir(path.join(out,'Music'));await fs.mkdir(path.join(out,'Data'));
  await fs.writeFile(path.join(out,'BUILD-INFO.json'),JSON.stringify({version:pkg.version,platform:process.platform,arch:process.arch,dataPolicy:'portable-only',clean:true},null,2));
}else{
const previous = await previousRelease(path.join(root,'dist'),pkg.version);
const legacy = path.join(process.env.APPDATA,'crescentmusic','crescent.sqlite');
console.log('Migrating release data and Music...');
console.log(await migrateRelease(previous || out,out,legacy));
}
console.log(`Windows application: ${path.join(out,'Crescent Music.exe')}`);
