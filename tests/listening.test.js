import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListeningSession, parseLrc } from '../src/listening.js';

test('counts once only after more than sixty actual seconds', () => {
  const s = new ListeningSession(180);
  assert.equal(s.update(0,0,true),false);
  for(let i=1;i<=60;i++) assert.equal(s.update(i,i*1000,true),false);
  assert.equal(s.update(61,61000,true),true);
  for(let i=62;i<120;i++) assert.equal(s.update(i,i*1000,true),false);
  assert.equal(s.finish(),false);
});
test('pauses, seeks and stalled audio do not add listening time', () => {
  const s = new ListeningSession(180);
  s.update(0,0,true);s.update(1,1000,true);
  s.update(1,2000,false);s.update(1,120000,true);s.update(2,121000,true);
  s.resetAnchor();s.update(140,122000,true);s.update(141,123000,true);
  s.update(141,150000,true);
  assert.equal(s.seconds,3);
  assert.equal(s.counted,false);
});
test('large media jumps do not count and wall time bounds playback rate', () => {
  const s = new ListeningSession(180);
  s.update(0,0,true);s.update(80,1000,true);s.update(82,2000,true);
  assert.equal(s.seconds,1);
});
test('short songs require completion after ninety percent listening', () => {
  const s = new ListeningSession(30);s.update(0,0,true);
  for(let i=1;i<=28;i++)s.update(i,i*1000,true);
  assert.equal(s.finish(),true);assert.equal(s.finish(),false);
  const skipped = new ListeningSession(30);skipped.update(28,0,true);skipped.update(29,1000,true);
  assert.equal(skipped.finish(),false);
});
test('each new playback has an independent count',()=>{
  for(let n=0;n<2;n++){const s=new ListeningSession(180);s.update(0,0,true);let counts=0;for(let i=1;i<=70;i++)counts+=Number(s.update(i,i*1000,true));assert.equal(counts,1);}
});
test('LRC supports fractional seconds, repeated timestamps, and ignores metadata',()=>{
  assert.deepEqual(parseLrc('[ar:Artist]\n[01:02.50][00:05.2]Hello\n[00:01]Start'),[{time:1,text:'Start'},{time:5.2,text:'Hello'},{time:62.5,text:'Hello'}]);
});
