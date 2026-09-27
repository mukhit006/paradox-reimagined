const test = require('node:test');
const assert = require('node:assert/strict');
const {buildLevel,specialModes,solve,createEngine,replay} = require('./campaign-audit');

for(let index=0;index<50;index++) {
  test(`campaign ${index+1}: both heroes reach their exits using production input`,()=>{
    const level=buildLevel(index),{route}=solve(level);
    assert.ok(replay(level,route)>0);
  });
}
for(const mode of Object.values(specialModes)) {
  test(`special ${mode.id}: victory within its real rules`,()=>{
    const level=buildLevel(mode.levelIndex,mode.mapVariant),{route}=solve(level,mode);
    const moves=replay(level,route,mode);
    if(mode.moveLimit)assert.ok(moves<=mode.moveLimit);
  });
}

test('regression: old level 18 route cannot walk through a closed switch gate',()=>{
  const route='ssssssssddwwwwwwwwddddddddssaassaawwasadaaassddssaaaassddddddwwddssdd';
  assert.throws(()=>replay(buildLevel(17),route),/Blocked input/);
});

test('keycards are single use and undo restores the key, gate and counter',()=>{
  const grid=[[1,1,1,1,1,1,1],[1,2,7,8,0,3,1],[1,1,1,1,1,1,1]];
  const e=createEngine({gridA:grid,gridB:grid});
  e.input('d');e.input('a');e.input('d');
  assert.equal(e.getPlayer(e.worldA).keys,1,'walking over a collected key must not duplicate it');
  e.input('d');
  assert.equal(e.getPlayer(e.worldA).keys,0);
  assert.equal(e.worldA.entities.find(x=>x.locked).open,true);
  e.input('z');
  assert.equal(e.getPlayer(e.worldA).keys,1);
  assert.equal(e.worldA.entities.find(x=>x.locked).open,false);
  assert.equal(e.moves,3);
  e.input('w');
  assert.equal(e.moves,3,'walking into a wall costs no move');
});

test('undo removes a new phantom and closes its plate-controlled gate after departure',()=>{
  const grid=[[1,1,1,1,1,1],[1,2,4,5,3,1],[1,1,1,1,1,1]];
  const e=createEngine({gridA:grid,gridB:grid});
  e.input('d');e.input('c');e.input('z');e.input('a');
  assert.equal(e.worldA.entities.some(x=>x.type==='phantom'),false);
  assert.equal(e.worldA.entities.find(x=>x.type==='door').open,false);
});

test('sprint accounts for elapsed time on input even when Safari suspends animation frames',()=>{
  const mode=specialModes.sprint,level=buildLevel(mode.levelIndex,mode.mapVariant);
  const e=createEngine(level,mode);
  e.advance(5000);e.input('s');
  assert.ok(e.specialElapsed>=5);
  assert.ok(e.specialTimeLeft<=115);
  e.setState('PAUSE');const remaining=e.specialTimeLeft;
  e.advance(30000);e.syncSpecialClock();
  assert.equal(e.specialTimeLeft,remaining,'pause excludes wall time');
  e.setState('PLAYING');e.advance(121000);
  const before=e.moves;e.input('s');
  assert.equal(e.state,'FAIL');
  assert.equal(e.moves,before,'expired challenge rejects movement before a possible win');
});
