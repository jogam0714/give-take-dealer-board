/* Offline DOM interaction QA; no browser/network automation. */
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const html=fs.readFileSync(path.join(__dirname,'dist/index.html'),'utf8');
const KEY='give-take-dealer-v1', IDS=['p1','p2','p3','p4','p5'];
let checks=0;
function ok(v,m){assert.ok(v,m);checks++;} function eq(a,b,m){assert.deepEqual(a,b,m);checks++;}
function boot(saved){
  const {window}=parseHTML(html), document=window.document, storage=new Map(saved?[[KEY,JSON.stringify(saved)]]:[]), downloads=[];
  const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
  const sandbox={window,document,localStorage,console,Blob,URL:{createObjectURL:b=>{downloads.push(b);return 'blob:offline-qa';},revokeObjectURL:()=>{}},setInterval:()=>1,setTimeout:()=>1,clearInterval:()=>{},clearTimeout:()=>{},navigator:{clipboard:{writeText:async text=>{sandbox.copied=text;}}},Date,Math,JSON,Uint32Array};
  window.localStorage=localStorage;
  vm.createContext(sandbox);
  const scripts=Array.from(document.querySelectorAll('script')).map(s=>s.textContent);
  vm.runInContext(scripts[0],sandbox);window.GiveTake=sandbox.GiveTake;
  vm.runInContext(scripts[1],sandbox);
  function q(sel){const x=document.querySelector(sel);assert.ok(x,'selector exists '+sel);return x;}
  function click(sel){const x=q(sel);ok(!x.disabled,'click enabled '+sel);x.click();}
  function change(sel,value){const x=q(sel);if(x.tagName==='SELECT'){for(const o of x.options)o.selected=false;Array.from(x.options).find(o=>o.value===String(value)).selected=true;}else x.value=String(value);x.dispatchEvent(new window.Event('change',{bubbles:true}));}
  function box(sel,checked=true){const x=q(sel);x.checked=checked;if(checked)x.setAttribute('checked','');else x.removeAttribute('checked');x.dispatchEvent(new window.Event('change',{bubbles:true}));}
  function session(){return JSON.parse(storage.get(KEY));}
  return {window,document,q,click,change,box,session,storage,downloads,sandbox};
}

async function main(){
  let ui=boot();
  eq(ui.q('#view-toggle').getAttribute('aria-checked'),'false','opens in public view');
  eq(ui.q('#setup').innerHTML,'','private setup absent from public DOM');
  eq(ui.q('#editor').innerHTML,'','private hand absent from public DOM');
  ui.click('#view-toggle');
  ok(!ui.q('#setup').hidden,'dealer setup visible');
  ok(!ui.q('[data-prediction="p1"]').disabled,'predictions immediately available without draw');
  eq(ui.document.querySelectorAll('[data-priority],[data-action="shuffle-priority"]').length,0,'no priority controls');
  ok(!ui.q('#setup').textContent.includes('추첨'),'no lottery in setup');
  ui.change('[data-setup-name="p1"]','<img src=x onerror=alert(1)>');
  eq(ui.document.querySelectorAll('img,[onerror]').length,0,'literal player names escaped');
  for(const id of IDS)ui.change('[data-setup-garnets="'+id+'"]',4);
  for(let i=0;i<5;i++)ui.change('[data-prediction="'+IDS[i]+'"]',[3,1,5,4,2][i]);
  ui.click('[data-action="start"]');
  ok(!ui.session().game.started,'start waits for confirmation');
  ui.click('#confirm-go');ok(ui.session().game.started,'starts after confirmation');
  ok(!ui.q('#editor').hidden,'submission editor visible');
  ui.click('[data-buy="plus"]');ui.click('[data-buy="zero"]');
  eq(ui.session().game.purchases.p1,{boost:'plus',zero:true},'purchases saved');
  ok(ui.q('[data-buy="minus"]').disabled,'opposite boost disabled');
  ok(ui.q('[data-buy="zero"]').disabled,'repeat zero disabled');
  let checkpointHTML='';
  for(let r=0;r<10;r++){
    for(let i=0;i<5;i++){
      const id=IDS[i];ui.click('[data-select-player="'+id+'"]');
      ok(!Array.from(ui.q('#target-select').options).some(o=>o.value===id),'other recipient excludes own player');
      if(r>0)ok(ui.q('[data-card="1"]').disabled,'spent card disabled');
      ui.click('[data-card="'+(r+1)+'"]');ui.click('[data-card="'+(-(r+1))+'"]');
      const changes={1:['p2','p3','p4','p5','p2'],2:['p2','p3','p4','p5','p3'],3:['p2','p3','p4','p5','p4'],4:['p2','p3','p4','p1','p1']};
      const target=changes[r]?changes[r][i]:IDS[(i+1)%5];
      ui.change('#target-select',target);
      if(r===0&&i===0){
        ui.box('[data-item-check="plus"]');ui.change('[data-item-target="plus"]','p2');
        ui.box('[data-item-check="zero"]');ui.change('[data-item-target="zero"]','p3');
      }
      ui.click('[data-action="submit"]');
      ok(!!ui.session().game.rounds[r].submissions[id],'submission persisted');
      ok(ui.q('#target-select').disabled,'submitted target sealed');
      ok(Array.from(ui.document.querySelectorAll('[data-card]')).every(b=>b.disabled),'submitted cards sealed');
      if(r===0&&i===0){
        ui.click('[data-action="correct"]');ui.click('#confirm-go');
        ok(!ui.session().game.rounds[0].submissions.p1,'correction removes seal');
        ui.click('[data-action="submit"]');
      }
    }
    ui.click('#resolve');ok(ui.session().game.rounds[r].resolved,'round resolved '+r);
    eq(ui.q('#maximum').textContent,'—','max stays unpublished after calculation');
    eq(ui.q('#minimum').textContent,'—','min stays unpublished after calculation');
    ui.click('#view-toggle');
    eq(ui.q('#private-results').innerHTML,'','private results removed in public view');
    eq(ui.q('#store').innerHTML,'','item purchase inventory absent in public view');
    eq(ui.document.querySelectorAll('[data-buy]').length,0,'purchase controls absent in public DOM');
    eq(ui.q('#editor').innerHTML,'','hand removed in public view');
    eq(ui.document.querySelectorAll('.seat-private').length,0,'private seat score removed');
    ok(!ui.q('#history-content').textContent.includes(String(r+1).padStart(2,'0')+' ROUND'),'unpublished archive absent');
    ok(Array.from(ui.document.querySelectorAll('.count-label')).every(x=>x.textContent==='받은 장수 비공개'),'counts stay hidden until publish');
    ui.click('#view-toggle');ui.click('#publish');
    ok(ui.session().published[r],'publish flag stored');
    if(r===0){
      eq(ui.q('#maximum').textContent,'+11','max includes extra item');
      eq(ui.q('#minimum').textContent,'0','minimum correct');
      ui.click('#undo');ok(!ui.session().published[0],'undo disclosure');
      eq(ui.q('#maximum').textContent,'—','undo masks results');
      ui.click('#redo');ok(ui.session().published[0],'redo disclosure');
      ui.click('[data-private-message="p2"]');
      ok(ui.q('#message-text').value.includes('+11'),'private 안내 correct');
      ui.click('#view-toggle');
      eq(ui.q('#modal-root').innerHTML,'','public switch clears private modal DOM');
      ok(!ui.q('#history-content').innerHTML.includes('class="audit"'),'public archive contains no cards or senders');
      ui.click('#view-toggle');ui.click('#public-message');
      const message=ui.q('#message-text').value;
      ok(message.includes('최고')&&message.includes('최저'),'public announcement has extrema');
      ok(!message.includes('누적 득점')&&!message.includes('예측'),'public announcement excludes personal score/prediction');
      ui.click('#modal-close');
    }
    if(r===4){
      ok(!ui.q('#checkpoint').hidden,'fifth-round ranking disclosed');
      checkpointHTML=ui.q('#checkpoint').innerHTML;
      ok(!checkpointHTML.includes('누적 득점'),'checkpoint has no cumulative values');
    }
    if(r>4)eq(ui.q('#checkpoint').innerHTML,checkpointHTML,'checkpoint remains fifth-round snapshot');
    if(r<9){ui.click('#next');eq(ui.session().game.roundIndex,r+1,'next round advances once');}
  }
  ok(ui.q('#final-panel').hidden,'final ranks wait for deliberate reveal');
  ui.click('#view-toggle');ok(ui.q('#final-panel').hidden,'public cannot see preview');
  eq(ui.q('#private-results').innerHTML,'','final private preview absent');
  ui.click('#view-toggle');ui.click('#next');
  ok(!ui.session().finalRevealed,'final reveal requires confirmation');
  ui.click('#confirm-go');ok(ui.session().finalRevealed,'final reveal saved');
  ok(!ui.q('#final-panel').hidden,'final result visible');
  ui.click('#view-toggle');
  ok(!ui.q('#final-panel').innerHTML.includes('누적 점수'),'public final table hides numeric totals');
  ok(ui.q('#final-panel').textContent.includes('예측 성공'),'public final success result');
  eq(ui.document.querySelectorAll('img,[onerror]').length,0,'player name remains escaped after full game');
  const completed=ui.session();
  ui=boot(completed);eq(ui.q('#view-toggle').getAttribute('aria-checked'),'false','resume always public');
  ok(!ui.q('#final-panel').hidden,'resume preserves revealed final standings');
  ui.click('#view-toggle');ui.click('#export');
  eq(ui.downloads.length,1,'export creates one backup');
  eq(JSON.parse(await ui.downloads[0].text()).game.rounds.filter(r=>r.resolved).length,10,'backup includes completed state');
  const G=require('./engine.js');
  let meetingGame=G.createGame(IDS.map((_,i)=>({name:'회의 '+(i+1),garnets:4})));
  for(let i=0;i<5;i++)meetingGame=G.setPrediction(meetingGame,IDS[i],i+1);
  meetingGame=G.lockPredictions(meetingGame);
  const ready={version:1,game:meetingGame,priorityDrawn:true,published:Array(10).fill(false),finalRevealed:false,timer:{active:null,deadline:null,remaining:180000,done:[]}};
  await ui.q('#file-input').onchange({target:{files:[{size:JSON.stringify(ready).length,text:async()=>JSON.stringify(ready)}],value:'test.json'}});
  ui.click('#confirm-go');eq(ui.session().game.roundIndex,0,'import resumes requested round');
  eq(ui.q('#view-toggle').getAttribute('aria-checked'),'false','import switches to public');
  eq(ui.q('#editor').innerHTML,'','import public mode has no private hand');
  ui.click('#view-toggle');ui.click('#undo');ok(ui.session().finalRevealed,'undo import restores previous match');
  const beforeBadImport=JSON.stringify(ui.session());
  const bad=JSON.parse(JSON.stringify(completed));bad.game.rounds[0].results[0].score++;
  await ui.q('#file-input').onchange({target:{files:[{size:JSON.stringify(bad).length,text:async()=>JSON.stringify(bad)}],value:'bad.json'}});
  ok(ui.q('#status').textContent.includes('불러오기 실패'),'invalid file rejected with explanation');
  eq(JSON.stringify(ui.session()),beforeBadImport,'bad import does not replace match');
  ui.click('#new-game');ok(ui.session().finalRevealed,'reset requires confirmation');ui.click('#confirm-go');
  ok(!ui.session().game.started,'confirmed reset creates new match');ui.click('#undo');ok(ui.session().finalRevealed,'reset can be undone');
  const corrupt=boot(bad);ok(corrupt.q('#status').textContent.includes('읽지 못했습니다'),'corrupted auto-save handled');
  eq(corrupt.q('#editor').innerHTML,'','corrupt save does not leak secrets');

  // Meeting reception, first-come order, garnet accounting and timer controls.
  const meetings=boot(ready);meetings.click('#view-toggle');
  for(const participants of [['p1','p2'],['p3','p4'],['p1','p5']]){
    for(const id of participants)meetings.box('[data-meeting-player="'+id+'"]');
    meetings.click('#meeting-add');
  }
  eq(meetings.session().game.meetings.length,3,'three meetings accepted');
  eq(G.remainingGarnets(meetings.session().game,'p1'),2,'repeat participant pays each meeting');
  ok(!meetings.q('#meeting-add').disabled,'additional meeting available');
  meetings.box('[data-meeting-player="p4"]');meetings.box('[data-meeting-player="p5"]');
  meetings.click('#meeting-add');
  eq(meetings.session().game.meetings.length,4,'four meetings accepted');
  eq(meetings.q('#meeting-count').textContent,'4회 접수','meeting count shows accepted requests');
  ok(meetings.q('[data-meeting-start="1"]').disabled,'later queue entry cannot jump line');
  for(let i=0;i<5;i++){
    meetings.click('[data-select-player="'+IDS[i]+'"]');
    meetings.click('[data-card="1"]');meetings.click('[data-card="-1"]');
    meetings.change('#target-select',IDS[(i+1)%5]);meetings.click('[data-action="submit"]');
  }
  ok(meetings.q('#resolve').disabled,'pending meetings block resolution even after all submissions');
  meetings.click('[data-meeting-start="0"]');
  eq(meetings.session().timer.active,0,'first meeting starts');
  ok(meetings.session().timer.deadline>Date.now(),'meeting clock deadline saved');
  ok(meetings.session().timer.deadline-Date.now()>599000,'new meeting has ten-minute duration');
  eq(meetings.q('#meeting-clock').textContent,'10:00','ten-minute clock starts correctly');
  const activeMeeting=meetings.session(), restoredMeeting=boot(activeMeeting);
  eq(restoredMeeting.q('#view-toggle').getAttribute('aria-checked'),'false','active meeting resume opens public');
  restoredMeeting.click('#view-toggle');
  eq(restoredMeeting.session().timer.active,0,'active meeting survives save/resume');
  eq(restoredMeeting.session().timer.deadline,activeMeeting.timer.deadline,'restored timer retains real deadline');
  const futureMeeting=JSON.parse(JSON.stringify(activeMeeting));futureMeeting.timer.deadline=Date.now()+24*60*60*1000;
  const invalidTimer=boot(futureMeeting);
  ok(invalidTimer.q('#status').textContent.includes('읽지 못했습니다'),'distant-future timer deadline rejected');
  meetings.click('#timer-pause');eq(meetings.session().timer.deadline,null,'timer pause saved');
  meetings.click('#timer-pause');ok(meetings.session().timer.deadline>Date.now(),'timer resume saved');
  meetings.click('#timer-finish');eq(meetings.session().timer.done,[0],'meeting completes');
  meetings.click('[data-meeting-start="1"]');meetings.click('#timer-finish');
  meetings.click('[data-meeting-start="2"]');meetings.click('#timer-finish');
  meetings.click('[data-meeting-start="3"]');meetings.click('#timer-finish');
  eq(meetings.session().timer.done,[0,1,2,3],'all meetings finish in order');
  ok(!meetings.q('#resolve').disabled,'resolution unlocks after all meetings finish');
  meetings.click('#resolve');ok(meetings.session().game.rounds[0].resolved,'completed meeting round resolves');

  // Full-vector ties require a rematch and migrate legacy saved ranks safely.
  let zeroGame=G.createGame(IDS.map(id=>({name:id,garnets:4})),IDS.slice().reverse());
  for(let i=0;i<5;i++)zeroGame=G.setPrediction(zeroGame,IDS[i],i+1);
  zeroGame=G.lockPredictions(zeroGame);
  let atFive=null;
  for(let r=0;r<10;r++){
    for(let i=0;i<5;i++)zeroGame=G.submit(zeroGame,IDS[i],{self:r+1,other:-(r+1),target:IDS[(i+1)%5],items:[]});
    zeroGame=G.resolveRound(zeroGame);
    if(r===4)atFive=JSON.parse(JSON.stringify(zeroGame));
    if(r<9)zeroGame=G.nextRound(zeroGame);
  }
  const wrap=game=>({version:1,priorityDrawn:true,game,published:Array.from({length:10},(_,i)=>game.rounds[i].resolved),finalRevealed:false,timer:{active:null,deadline:null,remaining:180000,done:[]}});
  const middle=boot(wrap(atFive));
  ok(!middle.q('#checkpoint').hidden,'legacy fifth round snapshot remains readable');
  eq(Array.from(middle.document.querySelectorAll('#checkpoint b')).map(x=>x.textContent),Array(5).fill('공동 1위'),'all equal intermediate histories share rank');
  ok(middle.q('#final-panel').hidden,'intermediate shared rank does not trigger early rematch');
  const oldFinished=wrap(zeroGame);oldFinished.finalRevealed=true;
  const replay=boot(oldFinished);
  eq(replay.session().version,3,'legacy wrapper migrates to latest version');
  ok(!replay.session().finalRevealed,'old lottery result no longer treated as final');
  eq(replay.session().game.rounds,zeroGame.rounds,'migration preserves every card and score record');
  ok(replay.q('#final-panel').textContent.includes('재경기 필요'),'complete tied histories require replay');
  ok(!replay.q('#final-panel').textContent.includes('예측 성공'),'no arbitrary prediction verdict on replay');
  eq(replay.q('#private-results').innerHTML,'','rematch opens without private information');
  replay.click('#view-toggle');
  ok(replay.q('#next').disabled,'no final adjudication button for unresolved final score ranks');
  replay.click('#public-message');
  ok(replay.q('#message-text').value.includes('재경기'),'public replay message');
  ok(!replay.q('#message-text').value.includes('[최종 순위]'),'no arbitrary final ranking in copied message');

  const legacyPaused=JSON.parse(JSON.stringify(ready));
  legacyPaused.version=2;legacyPaused.game=G.addMeeting(legacyPaused.game,['p1','p2']);
  legacyPaused.timer={active:0,deadline:null,remaining:120000,done:[]};
  const migratedPaused=boot(legacyPaused);migratedPaused.click('#view-toggle');
  eq(migratedPaused.session().version,3,'paused legacy meeting migrated');
  eq(migratedPaused.session().timer.remaining,540000,'elapsed legacy meeting time preserved');
  eq(migratedPaused.q('#meeting-clock').textContent,'09:00','paused migrated clock shows remaining nine minutes');
  eq(migratedPaused.session().game.rounds,legacyPaused.game.rounds,'timer migration preserves all game records');
  const legacyActive=JSON.parse(JSON.stringify(legacyPaused));legacyActive.timer.deadline=Date.now()+120000;
  const migratedActive=boot(legacyActive);
  eq(migratedActive.session().timer.deadline,legacyActive.timer.deadline+420000,'running legacy timer gets new duration without restarting elapsed time');
  eq(migratedActive.q('#view-toggle').getAttribute('aria-checked'),'false','migrated timer opens public');
  const report={status:'passed',checks,fullGames:1,rounds:10,submissions:50,scope:'offline linkedom UI clicks, privacy DOM, publication gates, items, midpoint, undo/redo, final reveal, save/reload/export/import/reset, meetings/timer and legacy migration'};
  fs.writeFileSync(path.join(__dirname,'dom-test-results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
main().catch(err=>{console.error(err.stack);process.exitCode=1;});
