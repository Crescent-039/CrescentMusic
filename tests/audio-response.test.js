import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { audioResponse } from '../src/audio-response.js';

test('audio byte ranges return exact partial contents and explicit unsatisfiable ranges',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'crescent-range-'));
 try {
  const file=path.join(dir,'song.mp3');await fs.writeFile(file,'0123456789');
  const request=(range,method='GET')=>new Request('https://local/song',{method,headers:range?{Range:range}:{}});
  const whole=await audioResponse(file,request());assert.equal(whole.status,200);assert.equal(whole.headers.get('content-length'),'10');assert.equal(whole.headers.get('accept-ranges'),'bytes');assert.equal(await whole.text(),'0123456789');
  for(const [range,body,contentRange] of [['bytes=3-5','345','bytes 3-5/10'],['bytes=7-','789','bytes 7-9/10'],['bytes=-2','89','bytes 8-9/10'],['bytes=8-99','89','bytes 8-9/10']]){
   const r=await audioResponse(file,request(range));assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),contentRange);assert.equal(await r.text(),body);
  }
  for(const range of ['bytes=10-','bytes=5-3','bytes=-0','bytes=','bytes=0-1,4-5']){const r=await audioResponse(file,request(range));assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */10');}
  assert.equal(await (await audioResponse(file,request(null,'HEAD'))).text(),'');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
