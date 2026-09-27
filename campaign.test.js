const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const generatorStart = html.indexOf('function buildAdvancedCampaignLevel(index,variant=0){');
const generatorEnd = html.indexOf('\nfor(let i=0;i<50;i++)', generatorStart);
assert.notEqual(generatorStart, -1, 'campaign generator exists');
assert.notEqual(generatorEnd, -1, 'campaign list initialization exists');
const buildLevel = new Function(`${html.slice(generatorStart, generatorEnd)}; return buildAdvancedCampaignLevel;`)();
const specialStart = html.indexOf('const SPECIAL_MODES={');
const specialEnd = html.indexOf('\n};', specialStart) + 3;
assert.notEqual(specialStart, -1, 'special mode definitions exist');
const specialModes = new Function(`${html.slice(specialStart, specialEnd)}; return SPECIAL_MODES;`)();

const moveStart = html.indexOf('moveEntity(ent,dx,dy,world){');
const moveEnd = html.indexOf('\n  updateLogic(){', moveStart);
assert.notEqual(moveStart, -1, 'movement function exists');
assert.notEqual(moveEnd, -1, 'movement function end exists');
const moveEntity = new Function(`return ({${html.slice(moveStart, moveEnd).trim()}}).moveEntity;`)();

function findCell(grid, code) {
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) if (grid[y][x] === code) return [x, y];
  }
  return null;
}

function canReach(grid, start, goal, blocked) {
  const queue = [start];
  const seen = new Set([start.join(',')]);
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head];
    if (x === goal[0] && y === goal[1]) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (ny < 0 || ny >= grid.length || nx < 0 || nx >= grid[ny].length || seen.has(key) || blocked.has(grid[ny][nx])) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return false;
}

function shortestPath(grid, start, goal) {
  const queue = [start], prev = new Map([[start.join(','), null]]);
  for (let head = 0; head < queue.length && !prev.has(goal.join(',')); head++) {
    const [x, y] = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (ny < 0 || ny >= grid.length || nx < 0 || nx >= grid[ny].length || grid[ny][nx] === 1 || prev.has(key)) continue;
      prev.set(key, `${x},${y}`);
      queue.push([nx, ny]);
    }
  }
  const out = [];
  for (let key = goal.join(','); key; key = prev.get(key)) out.push(key);
  return out.reverse();
}

function attachmentIndex(grid, cell, pathIndices) {
  const queue = [cell], seen = new Set([cell.join(',')]);
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head], key = `${x},${y}`;
    if (pathIndices.has(key)) return pathIndices.get(key);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, next = `${nx},${ny}`;
      if (grid[ny]?.[nx] !== undefined && grid[ny][nx] !== 1 && !seen.has(next)) {
        seen.add(next);
        queue.push([nx, ny]);
      }
    }
  }
  return -1;
}

test('all 50 campaign maps are rectangular, connected, and cannot bypass a closed gate', () => {
  for (let index = 0; index < 50; index++) {
    const level = buildLevel(index);
    for (const grid of [level.gridA, level.gridB]) {
      assert.ok(grid.length >= 9 && grid[0].length >= 11);
      assert.ok(grid.every(row => row.length === grid[0].length), `level ${index + 1} has uneven rows`);
      const start = findCell(grid, 2), exit = findCell(grid, 3);
      assert.ok(start && exit, `level ${index + 1} has a start and exit`);
      assert.equal(canReach(grid, start, exit, new Set([1])), true, `level ${index + 1} is reachable with gates open`);
      assert.equal(canReach(grid, start, exit, new Set([1, 5, 8])), false, `level ${index + 1} has a bypass around closed gates`);
      const mainPath = shortestPath(grid, start, exit), pathIndices = new Map(mainPath.map((key, i) => [key, i]));
      const keys = grid.flatMap((row, y) => row.map((cell, x) => cell === 7 ? [x, y] : null).filter(Boolean))
        .map(cell => attachmentIndex(grid, cell, pathIndices)).sort((a, b) => a - b);
      const locks = grid.flatMap((row, y) => row.map((cell, x) => cell === 8 ? pathIndices.get(`${x},${y}`) : null).filter(Number.isInteger)).sort((a, b) => a - b);
      assert.equal(keys.length, locks.length, `level ${index + 1} has a matching key for every locked gate`);
      for (let i = 0; i < locks.length; i++) {
        assert.ok(keys[i] >= 0 && keys[i] < locks[i], `level ${index + 1} key ${i + 1} is reachable before its lock`);
        if (i) assert.ok(keys[i] > locks[i - 1], `level ${index + 1} later key is not hidden behind a prior lock`);
      }
      let nodes = 0, edges = 0;
      for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x] === 1) continue;
        nodes++;
        if (x + 1 < grid[y].length && grid[y][x + 1] !== 1) edges++;
        if (y + 1 < grid.length && grid[y + 1][x] !== 1) edges++;
      }
      assert.equal(edges, nodes - 1, `level ${index + 1} contains a loop or shortcut`);
    }
  }
});

test('level 3 requires both the switch route and a hidden key before the locked exit gate', () => {
  const level = buildLevel(2);
  assert.ok(level.gridA.flat().includes(6) || level.gridB.flat().includes(6), 'permanent switch exists in one reality');
  for (const grid of [level.gridA, level.gridB]) {
    assert.ok(grid.flat().includes(5), 'switch-controlled door exists');
    assert.ok(grid.flat().includes(7), 'keycard exists');
    assert.ok(grid.flat().includes(8), 'locked door exists');
    const key = findCell(grid, 7);
    const exits = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => grid[key[1] + dy]?.[key[0] + dx] !== undefined && grid[key[1] + dy][key[0] + dx] !== 1);
    assert.equal(exits.length, 1, 'keycard sits in a real dead-end branch');
  }
});

test('cargo levels have an accessible straight crate push and an open route to exit', () => {
  for (let index = 8; index < 12; index++) {
    const level = buildLevel(index), grids = [level.gridA, level.gridB];
    const totalCrates = grids.reduce((sum, grid) => sum + grid.flat().filter(cell => cell === 9).length, 0);
    const totalPlates = grids.reduce((sum, grid) => sum + grid.flat().filter(cell => cell === 4).length, 0);
    assert.equal(totalCrates, 1, `level ${index + 1} has one pushable crate`);
    assert.equal(totalPlates, 1, `level ${index + 1} has its matching pressure plate`);
    const world = grids.find(grid => grid.flat().includes(9));
    const crate = findCell(world, 9), plate = findCell(world, 4), start = findCell(world, 2), exit = findCell(world, 3);
    const dx = plate[0] - crate[0], dy = plate[1] - crate[1];
    const stand = [crate[0] - dx, crate[1] - dy];
    assert.equal(Math.abs(dx) + Math.abs(dy), 1, `level ${index + 1} puts plate adjacent to crate`);
    assert.notEqual(world[stand[1]]?.[stand[0]], undefined, `level ${index + 1} has a standing tile behind crate`);
    assert.notEqual(world[stand[1]][stand[0]], 1, `level ${index + 1} standing tile is not a wall`);
    assert.equal(canReach(world, start, stand, new Set([1, 5, 9])), true,
      `level ${index + 1} player can reach the tile needed to push the crate`);
    const afterPush = world.map(row => row.slice());
    afterPush[crate[1]][crate[0]] = 0;
    afterPush[plate[1]][plate[0]] = 9; // the crate now rests on and holds the plate
    assert.equal(canReach(afterPush, start, exit, new Set([1, 8, 9])), true,
      `level ${index + 1} lets the player retreat from the plate-held crate and reach the exit`);
  }
});

test('movement rejects a stale-open gate and walls even if wall entities are absent', () => {
  const player = { type: 'player', x: 0, y: 0 };
  const door = { type: 'door', x: 1, y: 0, open: true };
  const world = { width: 3, height: 1, solidCells: new Set(), entities: [player, door, { type: 'switch', x: 2, y: 0, active: false }] };
  const game = { worldA: world, worldB: { entities: [] } };
  assert.equal(moveEntity.call(game, player, 1, 0, world), false);
  assert.equal(player.x, 0);

  world.solidCells.add('1,0');
  world.entities = [player];
  assert.equal(moveEntity.call(game, player, 1, 0, world), false);
});

test('a locked gate spends one key once, while a crate cannot be pushed through a wall', () => {
  const player = { type: 'player', x: 0, y: 0, keys: 1 };
  const gate = { type: 'door', x: 1, y: 0, open: false, locked: true };
  const world = { width: 3, height: 1, solidCells: new Set(), entities: [player, gate] };
  const game = { worldA: world, worldB: { entities: [] } };
  assert.equal(moveEntity.call(game, player, 1, 0, world), true);
  assert.equal(player.keys, 0);
  assert.equal(gate.open, true);
  player.x = 0;
  assert.equal(moveEntity.call(game, player, 1, 0, world), true);

  const cratePlayer = { type: 'player', x: 0, y: 0 };
  const crate = { type: 'crate', x: 1, y: 0 };
  const crateWorld = { width: 3, height: 1, solidCells: new Set(['2,0']), entities: [cratePlayer, crate] };
  assert.equal(moveEntity.call(game, cratePlayer, 1, 0, crateWorld), false);
  assert.equal(crate.x, 1);
});

test('three special modes use distinct mechanics and do not promise an impossible move limit', () => {
  assert.deepEqual(Object.keys(specialModes).sort(), ['precision', 'rift', 'sprint']);
  assert.equal(specialModes.sprint.timeLimit, 120);
  assert.equal(specialModes.precision.moveLimit, 36);
  const rift = buildLevel(specialModes.rift.levelIndex, specialModes.rift.mapVariant);
  assert.ok([rift.gridA, rift.gridB].some(g => g.flat().includes(4)), 'rift has a pressure plate');
  const sprint = buildLevel(specialModes.sprint.levelIndex, specialModes.sprint.mapVariant);
  assert.ok([sprint.gridA, sprint.gridB].every(g => g.flat().includes(7) && g.flat().includes(8)), 'sprint requires keys and locked gates');
  const precision = buildLevel(specialModes.precision.levelIndex, specialModes.precision.mapVariant);
  for (const mode of Object.values(specialModes)) {
    const dedicated = buildLevel(mode.levelIndex, mode.mapVariant);
    assert.notDeepEqual(dedicated.gridA, buildLevel(mode.levelIndex).gridA, `${mode.id} map is independent from its campaign level`);
  }

  const grids = [precision.gridA, precision.gridB];
  const exits = grids.map(g => findCell(g, 3));
  const starts = grids.map(g => findCell(g, 2));
  const first = [...starts[0], ...starts[1], false, 0];
  const queue = [first], seen = new Set([first.slice(0, 5).join(',')]);
  let minimum = Infinity;
  for (let head = 0; head < queue.length; head++) {
    const state = queue[head];
    if (state[0] === exits[0][0] && state[1] === exits[0][1] && state[2] === exits[1][0] && state[3] === exits[1][1]) {
      minimum = state[5]; break;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = state.slice();
      for (let world = 0; world < 2; world++) {
        const slot = world * 2, [x, y] = [state[slot], state[slot + 1]];
        if (x === exits[world][0] && y === exits[world][1]) continue;
        const nx = x + dx, ny = y + dy, cell = grids[world][ny]?.[nx];
        if (cell === undefined || cell === 1 || cell === 5 && !state[4]) continue;
        next[slot] = nx; next[slot + 1] = ny;
      }
      if (next.slice(0, 4).every((position, i) => position === state[i])) continue;
      next[4] = state[4] || grids[0][next[1]][next[0]] === 6 || grids[1][next[3]][next[2]] === 6;
      next[5] = state[5] + 1;
      const key = next.slice(0, 5).join(',');
      if (!seen.has(key)) { seen.add(key); queue.push(next); }
    }
  }
  assert.ok(Number.isFinite(minimum), 'precision challenge can be finished');
  assert.ok(minimum <= specialModes.precision.moveLimit, `minimum ${minimum} exceeds the move limit`);
});
