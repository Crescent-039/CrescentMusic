import {_electron as electron} from 'playwright-core';
import assert from 'node:assert/strict';
import {backup,DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {audioHash} from '../src/library.js';
const [exe,source]=process.argv.slice(2);
if(!exe||!source)throw new Error('Usage: node scripts/repair-untagged-title.mjs <exe> <original-audio-file>');
const hash=await audioHash(source),data=path.join(path.dirname(exe),'Data');
const db=new DatabaseSync(path.join(data,'crescent.sqlite'),{readOnly:true});
const matches=db.prepare('SELECT id,title FROM tracks WHERE content_hash=?').all(hash);
assert.equal(matches.length,1,'Expected exactly one existing identical file');
const imports=path.join(data,'imports');await fs.mkdir(imports,{recursive:true});
const backupFile=path.join(imports,`before-title-repair-${Date.now()}.sqlite`);
try{await backup(db,backupFile);}finally{db.close();}
const app=await electron.launch({executablePath:exe,cwd:path.dirname(exe),args:[],timeout:45000});
try{
 const page=await app.firstWindow();await page.waitForSelector('[data-track]');
 const before=await page.evaluate(()=>window.crescent.call('snapshot'));
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},source);
 await page.locator('#import-files').click();await page.waitForFunction(()=>!document.querySelector('#import-files').disabled);
 const after=await page.evaluate(()=>window.crescent.call('snapshot'));
 assert.equal(after.tracks.length,before.tracks.length);
 assert.deepEqual(after.tracks.map(t=>[t.id,t.plays,t.weekPlays,t.favorite]).sort(),before.tracks.map(t=>[t.id,t.plays,t.weekPlays,t.favorite]).sort());
 const repaired=after.tracks.find(t=>t.id===matches[0].id);
 assert.equal(repaired.title,path.basename(source,path.extname(source)));
 assert.equal(await audioHash(repaired.path),hash);assert.equal(await audioHash(source),hash);
 const report={backup:backupFile,id:repaired.id,oldTitle:matches[0].title,title:repaired.title,duration:repaired.duration,tracks:after.tracks.length};
 await fs.writeFile(path.join(imports,'untagged-title-repair.json'),JSON.stringify(report,null,2));
 console.log(report);
}finally{await app.close();}
