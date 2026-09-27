// Independent route search, followed by replay through the production input
// and movement methods. This catches optimistic solvers that reuse keycards or
// walk through switch-controlled gates.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function section(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing source section: ${start}`);
  return html.slice(a, b);
}
const buildLevel = new Function(`${section('function buildAdvancedCampaignLevel(index,variant=0){', '\nfor(let i=0;i<50;i++)')}; return buildAdvancedCampaignLevel;`)();
const specialModes = new Function(`${section('const SPECIAL_MODES={', '\n\n/*')}; return SPECIAL_MODES;`)();
const dirs = [[0,-1,'w'],[0,1,'s'],[-1,0,'a'],[1,0,'d']];
const popcount = n => { let c=0; for (;n;n&=n-1)c++; return c; };

function solve(level, mode = null) {
  const worlds = [level.gridA,level.gridB].map(grid => {
    const w=grid[0].length, cells=grid.flat(), keys=new Map(), locks=new Map();
    cells.forEach((c,p)=>{if(c===7)keys.set(p,1<<keys.size);if(c===8)locks.set(p,1<<locks.size);});
    return {w,cells,keys,locks,start:cells.indexOf(2),exit:cells.indexOf(3),crate:cells.indexOf(9)};
  });
  // player A/B, collected A/B, unlocked A/B, permanent switch,
  // crate A/B, phantom A/B, active world (rift only).
  const initial=[worlds[0].start,worlds[1].start,0,0,0,0,0,worlds[0].crate,worlds[1].crate,-1,-1,0];
  const queue=[initial], parents=[-1], inputs=[''], seen=new Set([initial.join(',')]);
  const onPlate=(s,i)=>[s[i],s[7+i],s[9+i]].some(p=>p>=0&&worlds[i].cells[p]===4);
  const actions=mode?.id==='rift'?[...dirs,[0,0,'c'],[0,0,'q']]:[...dirs,[0,0,'c']];
  for(let head=0;head<queue.length;head++) {
    const s=queue[head];
    if(s[0]===worlds[0].exit&&s[1]===worlds[1].exit) {
      const route=[];for(let i=head;parents[i]>=0;i=parents[i])route.push(inputs[i]);
      return {route:route.reverse().join(''),states:seen.size};
    }
    const active=!!s[6]||onPlate(s,0)||onPlate(s,1);
    for(const [dx,dy,key] of actions) {
      const n=s.slice();
      if(key==='q')n[11]=1-s[11];
      else if(key==='c') {
        if(!worlds.some((w,i)=>w.cells[s[i]]===4&&s[9+i]!==s[i]))continue;
        n[9]=s[0];n[10]=s[1];
      } else {
        for(let i=0;i<2;i++) {
          const w=worlds[i];
          if(mode?.id==='rift'&&s[11]!==i||s[i]===w.exit)continue;
          const x=s[i]%w.w, y=Math.floor(s[i]/w.w), nx=x+dx,ny=y+dy,p=ny*w.w+nx;
          const cell=w.cells[p];
          if(nx<0||nx>=w.w||ny<0||p>=w.cells.length||cell===1||cell===5&&!active)continue;
          if(cell===8&&!(s[4+i]&w.locks.get(p))) {
            if(popcount(s[2+i])-popcount(s[4+i])<=0)continue;
            n[4+i]|=w.locks.get(p);
          }
          if(p===s[7+i]) {
            const bx=nx+dx,by=ny+dy,bp=by*w.w+bx,bc=w.cells[bp];
            if(bx<0||bx>=w.w||by<0||bp>=w.cells.length||[1,5,8].includes(bc))continue;
            n[7+i]=bp;
          }
          n[i]=p;
        }
      }
      for(let i=0;i<2;i++) {
        const w=worlds[i];
        if(w.cells[n[i]]===7)n[2+i]|=w.keys.get(n[i]);
        if(w.cells[n[i]]===6||n[9+i]>=0&&w.cells[n[9+i]]===6)n[6]=1;
      }
      const id=n.join(',');if(seen.has(id))continue;
      seen.add(id);queue.push(n);parents.push(head);inputs.push(key);
    }
    if(queue.length>1500000)throw new Error('Route search exceeded 1,500,000 states');
  }
  throw new Error(`No solution: ${level.name}`);
}

function createEngine(level, mode = null) {
  let time=1000;
  const audio=new Proxy({}, {get:()=>()=>{}}),storage={setItem(){}};
  const methods=section('  handleInput(e){','\n  handleNetworkCommand(d){')+
    section('  getPlayer(w){','\n  drawWorld(world,ox,oy){')+
    section('  checkSpecialMoveLimit(){','\n  recordSpecialBest(){')+
    section('  syncSpecialClock(now=performance.now()){','\n  loop(ts){');
  const engine=new Function('audio','APP_STORAGE','performance','normalizeKey','document',`return new (class {${methods}})();`)(
    audio,storage,{now:()=>time},k=>k.toLowerCase(),{});
  const types={1:'wall',2:'player',3:'exit',4:'button',5:'door',6:'switch',7:'key',8:'door',9:'crate'};
  function world(grid) {
    const entities=[];
    grid.forEach((row,y)=>row.forEach((code,x)=>{if(types[code])entities.push({type:types[code],x,y,visualX:x,visualY:y,
      ...(code===2?{id:'player',keys:0}:{}),...(code===8?{locked:true,open:false}:{}),
      ...([4,6].includes(code)?{active:false}:{}),...(code===7?{collected:false}:{})});}));
    return {width:grid[0].length,height:grid.length,entities,solidCells:new Set(entities.filter(e=>e.type==='wall').map(e=>`${e.x},${e.y}`))};
  }
  Object.assign(engine,{worldA:world(level.gridA),worldB:world(level.gridB),moves:0,history:[],state:'PLAYING',
    activeSpecial:mode,activeWorld:'A',isMultiplayer:false,currentLevelIdx:0,maxSPLevel:0,lastMoveTime:0,
    specialClockAt:mode?.timeLimit?time:null,specialElapsed:0,specialTimeLeft:mode?.timeLimit||0,
    setState(s){this.syncSpecialClock();this.state=s;this.specialClockAt=s==='PLAYING'&&mode?.timeLimit?time:null;},
    advance(ms){time+=ms;},updateHUD(){},drawFrame(){},recordSpecialBest(){},failSpecial(){this.state='FAIL';},
    input(key){time+=150;this.handleInput({key,code:''});}});
  engine.updateLogic();return engine;
}

function replay(level, route, mode=null) {
  const engine=createEngine(level,mode);
  for(const key of route) {
    assert.equal(engine.state,'PLAYING','Route must end exactly at victory');
    const before=engine.moves;engine.input(key);
    if(key!=='q')assert.equal(engine.moves,before+1,`Blocked input ${key} at move ${before+1}`);
  }
  assert.equal(engine.state,'WIN',`Production engine did not finish ${level.name}`);
  return engine.moves;
}

function audit() {
  const results=[];
  for(let index=0;index<50;index++) {
    const level=buildLevel(index), solution=solve(level),moves=replay(level,solution.route);
    const row={level:index+1,moves,...solution};results.push(row);
    console.log(JSON.stringify(row));
  }
  for(const mode of Object.values(specialModes)) {
    const level=buildLevel(mode.levelIndex,mode.mapVariant),solution=solve(level,mode),moves=replay(level,solution.route,mode);
    results.push({special:mode.id,moves,...solution});console.log(JSON.stringify(results.at(-1)));
  }
  return results;
}
if(require.main===module)audit();
module.exports={buildLevel,specialModes,solve,createEngine,replay,audit};
