import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/player/core/JellyfinPlayer.js', import.meta.url),'utf8').replace(/\r\n/g,'\n');
function extract(signature) {
    const start = source.indexOf('\n    '+signature);
    assert.ok(start >= 0, signature);
    return source.slice(start+1,source.indexOf('\n    }\n',start)+6);
}
const T=10000000;
function player(start) {
    let clock=100000, position=start*T;
    const jumps=[];
    const methods=vm.runInNewContext('({'+[
        'getCurrentChapterIndex(timeTicks) {','_navigateWebOSChapter(direction) {',
        'nextChapter() {','previousChapter() {'
    ].map(extract).join(',')+'})',{
        Date:{now:()=>clock}, log:{info(){},debug(){}}
    });
    return Object.assign(methods,{
        _backendType:'webos',
        _chapters:[0,60,120,180,240].map(seconds=>({StartPositionTicks:seconds*T})),
        getCurrentPositionTicks:()=>position,
        seek(ticks) {this._webosChapterSeek=null; jumps.push(ticks/T);},
        set(seconds,ms=0){position=seconds*T;clock+=ms;},
        jumps
    });
}
test('next always advances, even immediately after a keyframe-early landing',()=>{
    const p=player(62);
    p.nextChapter();
    p.set(117,4000);
    p.nextChapter();
    p.set(176,4000);
    p.nextChapter();
    assert.deepEqual(p.jumps,[120,180,240]);
});
test('previous from a requested chapter that landed early only jumps one chapter',()=>{
    const p=player(65);
    p.nextChapter();
    p.set(116,4000);
    p.previousChapter();
    assert.deepEqual(p.jumps,[120,60]);
});
test('previous uses the three-second restart rule; next never restarts current chapter',()=>{
    const p=player(126);
    p.previousChapter();
    p.set(118,700);
    p.previousChapter();
    assert.deepEqual(p.jumps,[120,60]);
    const q=player(126);
    q.nextChapter();
    q.set(185,5000);
    q.previousChapter();
    assert.deepEqual(q.jumps,[180,180]);
});
test('ordinary playback near a chapter boundary is not rounded up',()=>{
    const p=player(118);
    p.nextChapter();
    assert.deepEqual(p.jumps,[120]);
    const q=player(122);
    q.previousChapter();
    assert.deepEqual(q.jumps,[60]);
});
test('rapid distinct presses use the requested target even if native time is stale',()=>{
    const p=player(126);
    p.previousChapter();
    p.set(126,100);
    p.previousChapter();
    p.set(126,100);
    p.previousChapter();
    assert.deepEqual(p.jumps,[120,60,0]);
});
test('normal seek clears logical chapter anchor and last chapter cannot advance',()=>{
    const p=player(70);
    p.nextChapter();
    p.seek(10*T);
    p.set(10,100);
    p.nextChapter();
    assert.deepEqual(p.jumps,[120,10,60]);
    const q=player(245);
    q.nextChapter();
    assert.deepEqual(q.jumps,[]);
});
