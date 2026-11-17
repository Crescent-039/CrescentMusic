import {_electron as electron} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const options={cwd:root,args:[`--user-data-dir=${path.join(root,'test-results',`import-files-${Date.now()}`)}`],timeout:45000};
if(process.env.CRESCENT_EXE)options.executablePath=process.env.CRESCENT_EXE;else options.args.unshift(root);
const app=await electron.launch(options);
try{
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const mp3=path.join(root,'tests/fixtures/Moonrise.mp3'),flac=path.join(root,'tests/fixtures/Afterglow.flac');
 const original=await fs.readFile(mp3);
 const select=files=>app.evaluate(({dialog},filePaths)=>{
  globalThis.importDialogOptions=null;
  dialog.showOpenDialog=async(_win,options)=>{globalThis.importDialogOptions=options;return {canceled:!filePaths.length,filePaths};};
 },files);
 await page.waitForSelector('#empty-import-files');await select([mp3]);
 await page.locator('#empty-import-files').click();
 await page.waitForFunction(()=>document.querySelector('#library-count').textContent==='1');
 const dialog=await app.evaluate(()=>globalThis.importDialogOptions);
 assert.deepEqual(dialog.properties,['openFile','multiSelections']);
 assert.ok(dialog.filters[0].extensions.includes('mp3'));assert.ok(dialog.filters[0].extensions.includes('flac'));
 let snapshot=await page.evaluate(()=>window.crescent.call('snapshot'));
 assert.equal(path.dirname(snapshot.tracks[0].path),snapshot.musicFolder);assert.deepEqual(await fs.readFile(snapshot.tracks[0].path),original);
 await page.locator('[data-action="like"]').click();await page.waitForFunction(()=>document.querySelector('[data-action="like"]').textContent==='♥');
 await select([mp3,flac]);await page.locator('#import-files').click();
 await page.waitForFunction(()=>document.querySelector('#library-count').textContent==='2');
 snapshot=await page.evaluate(()=>window.crescent.call('snapshot'));assert.equal(snapshot.tracks.filter(t=>t.favorite).length,1);
 await select([]);await page.locator('#import-files').click();await page.waitForFunction(()=>!document.querySelector('#import-files').disabled);
 assert.equal((await page.evaluate(()=>window.crescent.call('snapshot'))).tracks.length,2);
 await page.locator('#settings-open').click();await select([mp3]);await page.locator('#setting-import-files').click();
 await page.waitForFunction(()=>!document.querySelector('#import-files').disabled&&!document.querySelector('#modal').open);
 assert.equal((await page.evaluate(()=>window.crescent.call('snapshot'))).tracks.length,2);
 assert.deepEqual(await fs.readFile(mp3),original);assert.deepEqual(errors,[]);
 await page.setViewportSize({width:1060,height:720});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:path.join(root,'test-results/import-files.png')});
 console.log('PASS: empty library single-file import, MP3/FLAC multiselect, duplicate reuse, favorites preservation, cancel, settings entry and compact layout');
}finally{await app.close();}
