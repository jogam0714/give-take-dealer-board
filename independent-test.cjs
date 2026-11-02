/* Independent functional checks; no implementation-derived score helper is used. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('./engine.js');
const ids = ['p1','p2','p3','p4','p5'];
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
function rejects(fn, message) { assert.throws(fn, undefined, message); checks++; }
function fresh(garnets=20, priority=ids) {
  return G.createGame(ids.map((id,i)=>({name:'테스터 '+(i+1),garnets})), priority);
}
function start(state=fresh(), predictions={}) {
  for(let i=0;i<5;i++) state=G.setPrediction(state,ids[i],predictions[ids[i]]||i+1);
  return G.lockPredictions(state);
}
function immutable(state, fn) { const prior=JSON.stringify(state); const next=fn(); eq(JSON.stringify(state),prior,'mutator must not edit old state'); return next; }
function referenceResults(submissions) {
  const results=ids.map(id=>({id,score:0,count:0}));
  function give(id,value) { const result=results[ids.indexOf(id)]; result.score+=value; result.count++; }
  for(const from of ids) {
    const s=submissions[from]; give(from,s.self); give(s.target,s.other);
    for(const item of s.items||[]) give(item.target,{plus:11,minus:-11,zero:0}[item.kind]);
  }
  return results;
}
function referenceRank(history, priority, through=history.length-1) {
  const list=ids.map(id=>({id,total:history.slice(0,through+1).reduce((n,r)=>n+r.find(x=>x.id===id).score,0)}));
  list.sort((a,b)=>{
    if(a.total!==b.total) return b.total-a.total;
    for(let r=through;r>=0;r--) {const delta=history[r].find(x=>x.id===b.id).score-history[r].find(x=>x.id===a.id).score; if(delta) return delta;}
    return 0;
  });
  let rank=0;
  return list.map((p,i)=>{
    const previous=list[i-1];
    const same=previous&&previous.total===p.total&&history.slice(0,through+1).every(r=>r.find(x=>x.id===p.id).score===r.find(x=>x.id===previous.id).score);
    if(!same)rank=i+1;
    return {...p,rank};
  });
}
function rankFields(value) { return value.map(({id,total,rank})=>({id,total,rank})); }
function resolveSubmissionSet(state, submissions) {
  for(const id of ids) state=G.submit(state,id,submissions[id]);
  return G.resolveRound(state);
}
function ringSubmissions(round, targets=ids.map((_,i)=>ids[(i+1)%5])) {
  return Object.fromEntries(ids.map((id,i)=>[id,{self:round+1,other:-(round+1),target:targets[i],items:[]}]));
}

// Validation and immutable state transitions.
let state=fresh();
eq(G.NUMBERS.length,20,'20 regular cards'); eq(G.NUMBERS.reduce((a,b)=>a+b,0),0,'each hand sums to zero');
rejects(()=>G.lockPredictions(state),'all predictions required');
rejects(()=>G.setPriority(state,['p1','p1','p3','p4','p5']),'priority unique');
rejects(()=>G.setPrediction(state,'p1',0),'rank lower bound');
rejects(()=>G.setPrediction(state,'p1',6),'rank upper bound');
state=immutable(state,()=>G.setPrediction(state,'p1',1));
state=start(state,{p1:1,p2:1,p3:1,p4:1,p5:1});
ok(state.started,'prediction locking starts game');
rejects(()=>G.setPrediction(state,'p1',2),'locked prediction cannot change');
rejects(()=>G.setPriority(state,ids.slice().reverse()),'locked priority cannot change');
rejects(()=>G.resolveRound(state),'missing submissions rejected');
rejects(()=>G.submit(state,'p1',{self:1,other:1,target:'p2',items:[]}),'same physical card twice rejected');
rejects(()=>G.submit(state,'p1',{self:0,other:1,target:'p2',items:[]}),'regular zero is invalid');
rejects(()=>G.submit(state,'p1',{self:1,other:2,target:'p1',items:[]}),'other card must target another player');
rejects(()=>G.submit(state,'p1',{self:1,other:2,target:'missing',items:[]}),'unknown player rejected');
state=immutable(state,()=>G.submit(state,'p1',{self:1,other:-1,target:'p2',items:[]}));
state=G.unsubmit(state,'p1'); ok(!state.rounds[0].submissions.p1,'unsubmit removes locked choice');
state=resolveSubmissionSet(state,ringSubmissions(0));
eq(state.rounds[0].results.map(x=>x.score),[0,0,0,0,0],'ring cancels all scores');
eq(state.rounds[0].results.map(x=>x.count),[2,2,2,2,2],'self and incoming card count');
rejects(()=>G.unsubmit(state,'p1'),'resolved choice immutable');
state=G.nextRound(state);
rejects(()=>G.submit(state,'p1',{self:1,other:2,target:'p2',items:[]}),'spent card rejected');
ok(!G.availableCards(state,'p1').includes(1),'spent positive removed');
ok(!G.availableCards(state,'p1').includes(-1),'spent negative removed');

// Items are additional cards, mutually-exclusive +/-11, each once, real costs.
let items=start(fresh(4));
items=G.buyItem(items,'p1','plus'); items=G.buyItem(items,'p1','zero');
eq(G.remainingGarnets(items,'p1'),0,'item purchase cost');
rejects(()=>G.buyItem(items,'p1','plus'),'cannot buy plus twice');
rejects(()=>G.buyItem(items,'p1','minus'),'cannot buy opposite boost');
rejects(()=>G.buyItem(items,'p1','zero'),'cannot buy zero twice');
rejects(()=>G.submit(items,'p2',{self:1,other:-1,target:'p3',items:[{kind:'plus',target:'p2'}]}),'cannot use unowned item');
rejects(()=>G.submit(items,'p1',{self:1,other:-1,target:'p2',items:[{kind:'zero',target:'p1'},{kind:'zero',target:'p2'}]}),'cannot duplicate item in one submission');
let submissions=ringSubmissions(0);
submissions.p1.items=[{kind:'plus',target:'p2'},{kind:'zero',target:'p3'}];
items=resolveSubmissionSet(items,submissions);
eq(items.rounds[0].results.map(({score,count})=>({score,count})),[{score:0,count:2},{score:11,count:3},{score:0,count:3},{score:0,count:2},{score:0,count:2}],'plus and zero enter score/count correctly');
items=G.nextRound(items);
rejects(()=>G.submit(items,'p1',{self:2,other:-2,target:'p2',items:[{kind:'plus',target:'p2'}]}),'spent boost cannot recur');
rejects(()=>G.submit(items,'p1',{self:2,other:-2,target:'p2',items:[{kind:'zero',target:'p2'}]}),'spent zero cannot recur');
let noFunds=start(fresh(0)); rejects(()=>G.buyItem(noFunds,'p1','zero'),'cannot buy without garnets');

// Meetings spend one garnet per participant and have a three-per-round limit.
let meeting=start();
for(let i=0;i<3;i++) meeting=G.addMeeting(meeting,['p1','p2','p3']);
eq(G.remainingGarnets(meeting,'p1'),17,'meeting cost per participant');
eq(G.remainingGarnets(meeting,'p4'),20,'nonparticipant unchanged');
meeting=G.addMeeting(meeting,['p4','p5']);
eq(meeting.meetings.length,4,'fourth meeting remains available');
eq(G.validateState(meeting),meeting,'four meetings remain importable');
eq(G.remainingGarnets(meeting,'p4'),19,'new participants pay normally');
let longMeetingHistory=start();
for(let i=0;i<31;i++)longMeetingHistory=G.addMeeting(longMeetingHistory,[ids[i%5],ids[(i+1)%5]]);
eq(G.validateState(longMeetingHistory),longMeetingHistory,'long meeting history remains importable');

// Legacy priorities no longer break full score-vector ties.
const reverse=ids.slice().reverse(); let allTie=start(fresh(20,reverse));
for(let r=0;r<10;r++) {allTie=resolveSubmissionSet(allTie,ringSubmissions(r)); if(r<9)allTie=G.nextRound(allTie);}
eq(G.rankings(allTie).map(x=>x.id),ids,'tied rows retain display ID order only');
eq(G.rankings(allTie).map(x=>x.rank),[1,1,1,1,1],'all-round tie shares one rank');
ok(G.needsRematch(allTie),'identical full histories require rematch');
rejects(()=>G.finalStandings(allTie),'rematch prevents arbitrary prediction adjudication');
for(const id of ids) eq(new Set(allTie.rounds.flatMap(r=>[r.submissions[id].self,r.submissions[id].other])).size,20,'all 20 cards spent');

// Later scores break cumulative ties; older history remains decisive after later zero rounds.
const predictions={p1:4,p2:1,p3:3,p4:3,p5:5};
let tie=start(fresh(),predictions); const tieHistory=[];
const firstTargets=['p2','p3','p4','p5','p2'];
const thirdTargets=['p3','p1','p4','p5','p1'];
for(let r=0;r<10;r++) {
  const sent=ringSubmissions(r,r<2?firstTargets:r===2?thirdTargets:undefined);
  tieHistory.push(referenceResults(sent)); tie=resolveSubmissionSet(tie,sent);
  eq(rankFields(G.rankings(tie)),referenceRank(tieHistory,ids),'rank reference round '+r);
  if(r===4)eq(G.rankings(tie).map(x=>x.id),['p2','p3','p4','p5','p1'],'midpoint reverse history tiebreak');
  if(r<9)tie=G.nextRound(tie);
}
ok(G.needsRematch(tie),'three identical middle histories require rematch');
rejects(()=>G.finalStandings(tie),'no final rank if any full-history tie remains');
eq(rankFields(G.rankings(tie,4)),referenceRank(tieHistory,ids,4),'fifth-round snapshot independent of later history');
rejects(()=>G.nextRound(tie),'game has only ten rounds');

// Seeded independent simulation: full state trajectories, items and arbitrary targets.
let seed=0x91af23; function rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
for(let game=0;game<100;game++) {
  const priority=shuffle(ids); const predictions=Object.fromEntries(ids.map(id=>[id,1+Math.floor(rand()*5)]));
  let s=start(fresh(20,priority),predictions); const hands=Object.fromEntries(ids.map(id=>[id,shuffle(G.NUMBERS)]));
  const planned={}; let expectedItemTotal=0; let totalCardCount=100;
  for(const id of ids) {
    planned[id]=[];
    if(rand()<0.65){const kind=rand()<0.5?'plus':'minus';s=G.buyItem(s,id,kind);planned[id].push({kind,round:Math.floor(rand()*10)});expectedItemTotal+=kind==='plus'?11:-11;totalCardCount++;}
    if(rand()<0.65){s=G.buyItem(s,id,'zero');planned[id].push({kind:'zero',round:Math.floor(rand()*10)});totalCardCount++;}
  }
  const history=[];
  for(let r=0;r<10;r++) {
    const sub={};
    for(const id of ids) {
      const others=ids.filter(x=>x!==id);
      sub[id]={self:hands[id][r*2],other:hands[id][r*2+1],target:others[Math.floor(rand()*4)],items:planned[id].filter(x=>x.round===r).map(x=>({kind:x.kind,target:ids[Math.floor(rand()*5)]}))};
    }
    history.push(referenceResults(sub)); s=resolveSubmissionSet(s,sub);
    eq(s.rounds[r].results.map(({id,score,count})=>({id,score,count})),history[r],'independent scoring game '+game+' round '+r);
    eq(rankFields(G.rankings(s)),referenceRank(history,priority),'independent ranking game '+game+' round '+r);
    ok(G.validateState(JSON.parse(JSON.stringify(s))),'resolved state imports');
    if(r<9)s=G.nextRound(s);
  }
  const reference=referenceRank(history,priority);
  eq(reference.reduce((sum,x)=>sum+x.total,0),expectedItemTotal,'base 100-card zero-sum with item adjustment');
  eq(history.flat().reduce((sum,x)=>sum+x.count,0),totalCardCount,'all cards counted exactly once');
  const final=reference.slice().sort((a,b)=>Number(b.rank===predictions[b.id])-Number(a.rank===predictions[a.id])||a.rank-b.rank);
  const shared=new Set(reference.map(x=>x.rank)).size<5;
  eq(G.needsRematch(s),shared,'independent rematch detection');
  if(shared)rejects(()=>G.finalStandings(s),'shared full histories block final result');
  else eq(G.finalStandings(s).map(x=>x.id),final.map(x=>x.id),'independent final group sort');
  for(const id of ids)eq(new Set(s.rounds.flatMap(r=>[r.submissions[id].self,r.submissions[id].other])).size,20,'random game hand exhausted');
}

// Malformed / tampered saved-state rejection protects resume correctness.
ok(G.validateState(JSON.parse(JSON.stringify(tie))),'valid finished game imports');
rejects(()=>G.validateState({}),'empty import rejected');
let bad=JSON.parse(JSON.stringify(tie)); bad.rounds[0].results[0].score+=1;
rejects(()=>G.validateState(bad),'tampered score rejected');
bad=JSON.parse(JSON.stringify(tie)); bad.priority=['p1','p1','p3','p4','p5'];
rejects(()=>G.validateState(bad),'tampered priority rejected');
bad=JSON.parse(JSON.stringify(tie)); bad.rounds[1].submissions.p1.self=1;
rejects(()=>G.validateState(bad),'repeated spent card import rejected');
bad=JSON.parse(JSON.stringify(tie)); bad.rounds[0].submissions.p1.target='p1';
rejects(()=>G.validateState(bad),'invalid own-target import rejected');
bad=JSON.parse(JSON.stringify(tie)); bad.players[0].name='<script>alert(1)</script>';
// Names can be literal strings; the DOM audit verifies that names are escaped.
const report={status:'passed',checks,randomGames:100,rounds:1000,seed:'0x91af23',scope:'independent engine scoring/ranking/inventory/import functional checks'};
fs.writeFileSync(path.join(__dirname,'independent-test-results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
