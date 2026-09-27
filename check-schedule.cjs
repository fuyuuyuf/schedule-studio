// 验证跨天区间、旧数据兼容及日期边界；不读取或修改用户浏览器数据。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const node = { addEventListener() {} };
const source = fs.readFileSync(`${__dirname}/dist/app.js`, 'utf8');
const context = vm.createContext({
  document: { querySelector: () => node, querySelectorAll: () => [], addEventListener() {} },
  window: { addEventListener() {} },
  localStorage: { getItem: () => '[]' }, crypto: { randomUUID: () => 'split-id' }, Date, console,
});
vm.runInContext(source.slice(0, source.lastIndexOf('\nrenderStandby();')), context);
const evaluate = expression => JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
vm.runInContext(`globalThis.sample = {span:true,startDate:'2026-09-30',endDate:'2026-10-03',start:1380,end:90};`, context);
assert.equal(evaluate("segmentForDate(sample,'2026-09-29')"), null);
assert.equal(evaluate("segmentForDate(sample,'2026-09-30').start"), 1380);
assert.equal(evaluate("segmentForDate(sample,'2026-09-30').end"), 1440);
assert.equal(evaluate("segmentForDate(sample,'2026-10-01').start"), 0);
assert.equal(evaluate("segmentForDate(sample,'2026-10-01').end"), 1440);
assert.equal(evaluate("segmentForDate(sample,'2026-10-03').end"), 90);
assert.equal(evaluate("spanBounds(sample).width"), 498);
assert.equal(evaluate("spanMarkup({...sample,title:'跨天',color:'#2aa198'}).includes('width:498px')"), true);
assert.equal(evaluate("segmentForDate(sample,'2026-10-04')"), null);
assert.deepEqual(evaluate("removeDayFromEvent({...sample,id:'original',dates:['2026-09-30','2026-10-03']},'2026-10-01').map(e=>[e.id,e.startDate,e.endDate,e.start,e.end])"), [
  ['original','2026-09-30','2026-09-30',1380,1440],
  ['split-id','2026-10-02','2026-10-03',0,90],
]);
assert.deepEqual(evaluate("removeDayFromEvent({...sample,id:'original',dates:['2026-09-30','2026-10-03']},'2026-09-30').map(e=>[e.id,e.startDate,e.endDate])"), [['original','2026-10-01','2026-10-03']]);
assert.deepEqual(evaluate("removeDayFromEvent({...sample,id:'original',dates:['2026-09-30','2026-10-03']},'2026-10-03').map(e=>[e.id,e.startDate,e.endDate,e.end])"), [['original','2026-09-30','2026-10-02',1440]]);
assert.deepEqual(evaluate("removeDayFromEvent({...sample,id:'midnight',end:0,endDate:'2026-10-01',dates:['2026-09-30','2026-10-01']},'2026-09-30')"), []);
assert.deepEqual(evaluate("removeDayFromEvent({id:'repeat',dates:['2026-09-30','2026-10-01'],start:600,end:660},'2026-09-30').map(e=>e.dates)"), [['2026-10-01']]);
assert.equal(evaluate("segmentForDate({...sample,end:0},'2026-10-03')"), null);
assert.equal(evaluate("segmentForDate({dates:['2026-09-24','2026-09-26'],start:600,end:660},'2026-09-25')"), null);
assert.equal(evaluate("segmentForDate({dates:['2026-09-24'],start:600,end:660},'2026-09-24').start"), 600);
assert.equal(evaluate("toKey(addDays(parseKey('2028-02-28'),1))"), '2028-02-29');
assert.equal(evaluate("toKey(addDays(parseKey('2026-12-31'),1))"), '2027-01-01');
assert.equal(evaluate("eventMarkup({id:'note',title:'较长日程',dates:['2026-09-25'],start:600,end:900,color:'#2aa198',notes:'**重点**'}).includes('<div class=\"event-notes\">')"), true);
assert.equal(evaluate("eventMarkup({id:'note',title:'短日程',dates:['2026-09-25'],start:600,end:660,color:'#2aa198',notes:'**重点**'}).includes('event-notes')"), false);
assert.equal(evaluate("eventMarkup({id:'past',title:'已过期',dates:['2020-01-01'],start:600,end:660,color:'#2aa198',notes:''}).includes('expired')"), true);
assert.equal(evaluate("eventMarkup({id:'future',title:'未过期',dates:['2099-01-01'],start:600,end:660,color:'#2aa198',notes:''}).includes('expired')"), false);
assert.equal(evaluate('CACHE_RADIUS * 2 + 1'), 55);
assert.equal(evaluate("progressFor({span:true,startDate:'2020-01-01',endDate:'2020-01-03',start:0,end:0})"), 100);
assert.equal(evaluate("progressFor({span:true,startDate:'2099-01-01',endDate:'2099-01-03',start:0,end:0})"), 0);
vm.runInContext("editing={startDate:'2026-12-31',endDate:'2026-12-31',start:1380,end:60};ensureEndAfterStart();", context);
assert.equal(evaluate('editing.endDate'), '2027-01-01');
assert.deepEqual(evaluate("selectedRange({date:'2026-09-30',currentDate:'2026-10-03',anchor:1380,current:90})"), {span:true,startDate:'2026-09-30',endDate:'2026-10-03',start:1380,end:90,displayMinute:1380});
assert.deepEqual(evaluate("selectedRange({date:'2026-10-03',currentDate:'2026-09-30',anchor:90,current:1380})"), {span:true,startDate:'2026-09-30',endDate:'2026-10-03',start:1380,end:90,displayMinute:90});
assert.equal(evaluate("spanBounds({...sample,...selectedRange({date:'2026-10-03',currentDate:'2026-09-30',anchor:90,current:1380})}).top"), 108);
assert.equal(evaluate("spanBounds({...sample,...selectedRange({date:'2026-10-03',currentDate:'2026-09-29',anchor:90,current:900})}).top"), 108);
assert.equal(evaluate("selectedRange({date:'2026-09-30',currentDate:'2026-09-30',anchor:600,current:600}).end"), 615);
console.log('日期、双向跨天拖选和旧数据兼容检查通过。');
