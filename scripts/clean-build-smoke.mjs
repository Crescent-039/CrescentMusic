import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright-core';
const root=path.resolve(import.meta.dirname,'..'),pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const source=path.join(root,'release',`CrescentMusic-${pkg.version}`);
for(const directory of ['Music','Data'])assert.deepEqual(await fs.readdir(path.join(source,directory)),[]);
const temporary=path.join(root,'test-results',`clean-build-${Date.now()}`);
await fs.cp(source,temporary,{recursive:true});
const app=await electron.launch({executablePath:path.join(temporary,'Crescent Music.exe'),cwd:temporary,args:[],timeout:45000});
try{
  const page=await app.firstWindow();await page.waitForSelector('#empty-import-files');
  const snapshot=await page.evaluate(()=>window.crescent.call('snapshot'));
  assert.equal(snapshot.tracks.length,0);assert.equal(snapshot.playlists.length,0);assert.equal(snapshot.memberships.length,0);assert.deepEqual(snapshot.daily,[]);
  assert.equal(path.resolve(snapshot.dataFolder),path.join(temporary,'Data'));
  assert.equal(path.resolve(snapshot.musicFolder),path.join(temporary,'Music'));
  assert.deepEqual(await fs.readdir(path.join(temporary,'Music')),[]);
  console.log('PASS: clean EXE boots with empty library and its own Data/Music, without importing legacy personal data');
}finally{await app.close();}
for(const directory of ['Music','Data'])assert.deepEqual(await fs.readdir(path.join(source,directory)),[]);
