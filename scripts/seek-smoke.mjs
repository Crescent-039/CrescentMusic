import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const options={cwd:root,args:[`--user-data-dir=${path.join(root,'test-results',`seek-${Date.now()}`)}`],timeout:45000};
if(process.env.CRESCENT_EXE)options.executablePath=process.env.CRESCENT_EXE;else options.args.unshift(root);
const app=await electron.launch(options);
try {
 const page=await app.firstWindow();
 await page.waitForSelector('#empty-import');
 const sources=['mp3','flac'].map(ext=>path.join(root,'tests/seek-fixtures',`Seek.${ext}`));
 await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});},sources);
 await page.evaluate(()=>window.crescent.call('import','files'));
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('library-updated'));
 await page.waitForSelector('[data-action="play"]');
 await page.locator('#audio').evaluate(a=>a.muted=true);
 for(let i=0;i<2;i++){
 await page.locator('[data-action="play"]').nth(i).dblclick();
 await page.waitForFunction(()=>document.querySelector('#audio').currentTime>.1);
 await page.locator('#toggle').click();
 await page.locator('#seek').evaluate(s=>{s.value='120';s.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>!document.querySelector('#audio').seeking);
 assert.ok(Math.abs(await page.locator('#audio').evaluate(a=>a.currentTime)-120)<1,'seek must land at 120 seconds');
 await page.locator('#toggle').click();
 await page.waitForFunction(()=>document.querySelector('#audio').currentTime>120.1);
 const box=await page.locator('#seek').boundingBox();
 await page.mouse.click(box.x+box.width*.5,box.y+box.height/2);
 await page.waitForFunction(()=>{const a=document.querySelector('#audio');return !a.seeking&&Math.abs(a.currentTime/a.duration-.5)<.05;});
 await page.locator('#toggle').click();
 assert.match(await page.locator('#elapsed').innerText(),/\d+:\d{2}/);
 }
 console.log('PASS: MP3 and FLAC paused seek to 120s, playing pointer seek, continued playback and progress display');
}finally{await app.close();}
