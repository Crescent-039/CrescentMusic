import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleRange } from '../src/virtual-list.js';
test('large libraries have a bounded visible range at the beginning, middle and end',()=>{
  for(const count of [100,500,10000]){
    for(const top of [560,-count*34,-count*68+700]){
      const r=visibleRange(count,68,top,40,838);
      assert.ok(r.start>=0&&r.end<=count&&r.end>=r.start);
      assert.ok(r.end-r.start<=23);
    }
  }
  assert.deepEqual(visibleRange(0,68,500,40,838),{start:0,end:0});
});
