import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/webos/WebOSAdapter.js', import.meta.url), 'utf8').replace(/\r\n/g,'\n');
const start = source.indexOf('\n    _setupKeyHandler() {');
const end = source.indexOf('\n    }\n', start);
assert.ok(start >= 0 && end > start);
const keyMap = source.match(/const WEBOS_KEYS = \{[\s\S]*?\n\};/)[0];

test('LG Page Up/Down during playback emit only chapter/channel events', () => {
    const events = [];
    let keydown;
    const document = {activeElement:null, addEventListener: (type,fn) => {if(type==='keydown') keydown=fn;}};
    const window = {location:{hash:'#/player/movie'}};
    const adapter = vm.runInNewContext(keyMap+'\n({'+source.slice(start+1,end+6)+'})',{
        document, window, eventBus:{emit: name => events.push(name)}
    });
    adapter._setupKeyHandler();
    let prevented=0;
    const press = keyCode => keydown({keyCode,preventDefault:()=>prevented++});
    press(33);
    press(34);
    assert.deepEqual(events,['key:channelUp','key:channelDown']);
    assert.equal(prevented,2);
    document.activeElement={tagName:'INPUT',type:'text'};
    press(33);
    assert.equal(events.length,2);
    document.activeElement=null;
    window.location.hash='#/home';
    press(33);
    assert.deepEqual(events.slice(2),['key:next','key:channelUp']);
});
