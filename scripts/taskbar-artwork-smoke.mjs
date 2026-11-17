import {_electron as electron} from 'playwright-core';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const options={cwd:root,args:[`--user-data-dir=${path.join(root,'test-results',`artwork-${Date.now()}`)}`],timeout:45000};
if(process.env.CRESCENT_EXE)options.executablePath=process.env.CRESCENT_EXE;else options.args.unshift(root);
const app=await electron.launch(options);
try{
 await (await app.firstWindow()).waitForSelector('#empty-import-files');
 const result=await app.evaluate(async({BrowserWindow,nativeImage},root)=>{
  const {createRequire}=process.getBuiltinModule('module');
  const require=createRequire(root+'/package.json'),koffi=require('koffi');
  const load=koffi.load,records=[],hooks=new Map();let deleted=0;
  koffi.load=name=>{const lib=load(name);return {func(signature){const fn=lib.func(signature);
   if(signature.includes('CreateDIBSection'))return (...args)=>{const handle=fn(...args);records.push({width:args[1].readInt32LE(4),height:args[1].readInt32LE(8),bits:koffi.decode(args[3],'void *')});return handle;};
   if(signature.includes('DeleteObject'))return (...args)=>{deleted++;const record=records.at(-1);record.pixel=[...koffi.decode(record.bits,koffi.array('uint8_t',4))];delete record.bits;return fn(...args);};
   return fn;
  }};};
  let artwork;
  const win=BrowserWindow.getAllWindows()[0];
  try{
   const {createTaskbarArtwork}=require(root+'/src/taskbar-artwork.js');
   artwork=createTaskbarArtwork({getNativeWindowHandle:()=>win.getNativeWindowHandle(),hookWindowMessage:(id,fn)=>hooks.set(id,fn)},error=>{throw error;},koffi);
  }finally{koffi.load=load;}
  const request=()=>{const l=Buffer.alloc(8);l.writeUInt32LE((240<<16)|160);hooks.get(0x0323)(null,l);};
  const image=color=>{const pixels=Buffer.alloc(32*32*4);for(let i=0;i<pixels.length;i+=4)color.forEach((value,j)=>pixels[i+j]=value);return nativeImage.createFromBitmap(pixels,{width:32,height:32});};
  artwork.set(image([0,0,255,255]));request();
  win.minimize();artwork.set(image([255,0,0,255]));request();
  hooks.get(0x0326)();win.restore();
  return {records,deleted};
 },root);
 assert.equal(result.records[0].width,160);assert.equal(result.records[0].height,-160);
 assert.deepEqual(result.records[0].pixel,[0,0,255,255]);assert.deepEqual(result.records[1].pixel,[255,0,0,255]);
 assert.equal(result.deleted,result.records.length);
 console.log('PASS: DWM receives current artwork pixels, switches cover while minimized, respects requested size, provides peek bitmap and releases every native bitmap');
}finally{await app.close();}
