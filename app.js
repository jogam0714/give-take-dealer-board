(function(){
  'use strict';
  const E=window.GiveTake, KEY='give-take-dealer-v1', IDS=['p1','p2','p3','p4','p5'];
  const MEETING_MS=10*60*1000;
  const $=id=>document.getElementById(id), clone=x=>JSON.parse(JSON.stringify(x));
  const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const signed=n=>n>0?'+'+n:String(n).replace('-','−');
  const itemName=k=>signed(E.ITEM_VALUES[k]);
  const opts=(players,selected,exclude)=>players.filter(p=>p.id!==exclude).map(p=>'<option value="'+p.id+'"'+(p.id===selected?' selected':'')+'>'+esc(p.name)+'</option>').join('');
  let dealer=false, selected='p1', storePlayer='p1', drafts={}, activeSlot='self', undoStack=[], redoStack=[], saved=true, lastFocus=null;
  let statusText='진행자 보기를 켜면 경기 준비를 시작할 수 있습니다.', statusError=false;
  function fresh(){
    return {version:3,game:E.createGame(IDS.map((id,i)=>({name:'플레이어 '+String.fromCharCode(65+i),garnets:0}))),published:Array(10).fill(false),finalRevealed:false,timer:{active:null,deadline:null,remaining:MEETING_MS,done:[]}};
  }
  function validateSession(raw){
    if(!raw||![1,2,3].includes(raw.version))throw Error('지원하지 않는 경기 파일입니다.');
    const game=E.validateState(raw.game);
    if(!Array.isArray(raw.published)||raw.published.length!==10||raw.published.some((x,i)=>typeof x!=='boolean'||(x&&!game.rounds[i].resolved)))throw Error('결과 공개 기록이 올바르지 않습니다.');
    for(let i=0;i<game.roundIndex;i++)if(!raw.published[i])throw Error('이전 라운드 공개 기록이 누락되었습니다.');
    if(typeof raw.finalRevealed!=='boolean'||(raw.finalRevealed&&!raw.published[9]))throw Error('최종 결과 공개 기록이 올바르지 않습니다.');
    const t=raw.timer?clone(raw.timer):null, timerLimit=raw.version<3?180000:MEETING_MS;
    if(!t||!Array.isArray(t.done)||new Set(t.done).size!==t.done.length||t.done.some(i=>!Number.isInteger(i)||i<0||i>=game.meetings.length))throw Error('독대 완료 기록이 올바르지 않습니다.');
    if(t.active!==null&&(!Number.isInteger(t.active)||t.active<0||t.active>=game.meetings.length||t.done.includes(t.active)||game.meetings[t.active].roundIndex!==game.roundIndex))throw Error('진행 중인 독대 기록을 확인하세요.');
    if(!Number.isFinite(t.remaining)||t.remaining<0||t.remaining>timerLimit||(t.deadline!==null&&(!Number.isFinite(t.deadline)||t.deadline<=0||t.deadline>Date.now()+timerLimit+1000||t.active===null)))throw Error('독대 타이머 기록이 올바르지 않습니다.');
    if(raw.version<3){
      t.remaining=t.active===null?MEETING_MS:t.remaining+MEETING_MS-180000;
      if(t.deadline!==null)t.deadline+=MEETING_MS-180000;
    }
    for(let i=0;i<game.meetings.length;i++)if(game.rounds[game.meetings[i].roundIndex].resolved&&!t.done.includes(i))throw Error('완료되지 않은 독대가 있는 정산 기록입니다.');
    return {version:3,game,published:raw.published.slice(),finalRevealed:raw.finalRevealed&&!E.needsRematch(game),timer:clone(t)};
  }
  let session=fresh();
  try{const raw=localStorage.getItem(KEY);if(raw){session=validateSession(JSON.parse(raw));statusText='저장된 경기를 이어서 진행합니다. 공개 보기로 열었습니다.';}}catch(err){saved=false;statusText='저장 상태를 읽지 못했습니다. 경기 파일을 불러오거나 새로 시작하세요.';statusError=true;}
  function save(){
    try{localStorage.setItem(KEY,JSON.stringify(session));saved=true;}catch(err){saved=false;}
    $('save-status').textContent=saved?'이 브라우저에 자동 저장':'자동 저장 불가 · 경기 파일로 저장하세요';
  }
  function say(text,error){statusText=text;statusError=!!error;$('status').textContent=text;$('status').classList.toggle('error',!!error);}
  function commit(fn,message,resetDraft){
    if(!dealer)return say('진행자 보기를 켜세요.',true);
    try{
      const next=clone(session);fn(next);
      const valid=validateSession(next);
      undoStack.push(clone(session));if(undoStack.length>50)undoStack.shift();redoStack=[];
      session=valid;if(resetDraft)drafts={};save();render();if(message)say(message,false);return true;
    }catch(err){render();say(err.message||String(err),true);return false;}
  }
  function actGame(fn,message,resetDraft){return commit(n=>{n.game=fn(n.game);},message,resetDraft);}
  function name(id){return session.game.players.find(p=>p.id===id).name;}
  function round(){return session.game.rounds[session.game.roundIndex];}
  function lastResolved(){let i=-1;session.game.rounds.forEach((r,k)=>{if(r.resolved)i=k;});return i;}
  function total(id,through){return E.rankings(session.game,through===undefined?lastResolved():through).find(p=>p.id===id).total;}
  function isFinished(){return session.game.rounds[9].resolved;}
  function rematch(){return E.needsRematch(session.game);}
  function rankLabel(row,rows){return (rows.filter(x=>x.rank===row.rank).length>1?'공동 ':'')+row.rank+'위';}
  function pendingMeetings(){return session.game.meetings.map((m,i)=>({m,i})).filter(x=>x.m.roundIndex===session.game.roundIndex&&!session.timer.done.includes(x.i));}
  function ensureMeetingsDone(){if(pendingMeetings().length)throw Error('접수한 독대를 모두 완료한 뒤 진행하세요.');}
  function currentCards(id){const cards=E.availableCards(session.game,id);const s=round().submissions[id];return round().resolved&&s?cards.filter(v=>v!==s.self&&v!==s.other):cards;}
  function currentItems(id){const kinds=E.availableItems(session.game,id);const s=round().submissions[id];return round().resolved&&s?kinds.filter(k=>!s.items.some(x=>x.kind===k)):kinds;}
  function draftFor(id){
    const key=session.game.roundIndex+':'+id;
    if(!drafts[key])drafts[key]=round().submissions[id]?clone(round().submissions[id]):{self:null,other:null,target:IDS.find(x=>x!==id),items:[]};
    return drafts[key];
  }
  function renderSetup(){
    $('setup').hidden=!dealer||session.game.started;if($('setup').hidden){$('setup').innerHTML='';return;}
    const g=session.game;
    $('setup').innerHTML='<div class="panel-title"><h2>경기 준비</h2><span class="tag">5명 · 10라운드</span></div><div class="setup-grid">'+g.players.map((p,i)=>'<div class="setup-person"><div class="setup-badge">'+String.fromCharCode(65+i)+'</div><label class="field">플레이어 이름<input data-setup-name="'+p.id+'" maxlength="40" value="'+esc(p.name)+'"></label><label class="field">보유 가넷<input type="number" data-setup-garnets="'+p.id+'" min="0" max="1000000" step="1" value="'+p.startingGarnets+'"></label><label class="field">비공개 점수 순위 예측<select data-prediction="'+p.id+'"><option value="">선택 전</option>'+IDS.map((x,j)=>'<option value="'+(j+1)+'"'+(g.predictions[p.id]===j+1?' selected':'')+'>'+(j+1)+'위</option>').join('')+'</select></label></div>').join('')+'</div><p class="tiny muted" style="margin-top:13px">실제 보유 가넷과 각자의 비공개 점수 순위 예측을 입력하세요. 같은 등수를 여러 명이 예측할 수 있습니다.</p><div class="setup-controls"><button data-action="start" class="primary"'+(Object.values(g.predictions).some(x=>x===null)?' disabled':'')+'>예측 봉인 · 1라운드 시작</button></div>';
  }
  function renderTable(){
    const g=session.game,r=round(),revealed=session.published[g.roundIndex],ready=Object.keys(r.submissions).length;
    $('metrics').innerHTML='<div class="metric"><span>현재 단계</span><strong>'+(rematch()&&(dealer||revealed)?'재경기 필요':session.finalRevealed?'경기 종료':!g.started?'경기 준비':r.resolved?(revealed?'결과 공개':'공개 대기'):'비공개 제출')+'</strong></div><div class="metric"><span>카드 제출</span><strong class="serif">'+(g.started?ready:0)+' <small>/ 5</small></strong></div><div class="metric"><span>'+(dealer?'정산한 라운드':'진행 라운드')+'</span><strong class="serif">'+(dealer?lastResolved()+1:g.started?g.roundIndex+1:0)+' <small>/ 10</small></strong></div>';
    $('round-number').innerHTML='ROUND '+String(g.roundIndex+1).padStart(2,'0')+' <span>/ 10</span>';
    $('phase-name').textContent=!g.started?'예측 봉인 전':r.resolved?(revealed?'공개된 라운드 결과':'득점 계산 완료 · 공개 대기'):'자신에게 한 장, 상대에게 한 장';
    $('round-track').innerHTML=g.rounds.map((rr,i)=>'<span class="round-dot'+(rr.resolved?' done':'')+(i===g.roundIndex?' current':'')+'" aria-label="'+(i+1)+'라운드'+(rr.resolved?' 정산 완료':'')+'">'+(i+1)+'</span>').join('');
    $('seats').innerHTML=g.players.map((p,i)=>{
      const result=r.results&&r.results.find(x=>x.id===p.id),count=revealed?result.count:null;
      return '<article class="seat"><div class="seat-avatar">'+String.fromCharCode(65+i)+'</div><div class="seat-name">'+esc(p.name)+'</div><div class="envelope'+(revealed?' opened':'')+'" aria-hidden="true"><span class="back" data-count="'+(count===null?'':count)+'"></span><span class="back" data-count="'+(count===null?'':count)+'"></span></div><div class="seat-status'+(r.submissions[p.id]?' sealed':'')+'">'+(!g.started?'참가 준비':r.submissions[p.id]?'제출 봉인 완료':'제출 대기')+'</div><div class="count-label">'+(revealed?'<b>'+count+'</b>장 받음':'받은 장수 비공개')+'</div>'+(dealer?'<div class="seat-private">누적 득점<strong>'+signed(total(p.id))+'</strong>예측 '+(g.predictions[p.id]||'—')+'위 · 남은 카드 '+currentCards(p.id).length+'장</div>':'')+'</article>';
    }).join('');
    $('maximum').textContent=revealed?signed(Math.max.apply(null,r.results.map(x=>x.score))):'—';
    $('minimum').textContent=revealed?signed(Math.min.apply(null,r.results.map(x=>x.score))):'—';
    $('table-message').textContent=session.finalRevealed?'예측 성공자를 먼저, 각 그룹 안에서는 점수 순위대로 배치합니다.':!g.started?'각자의 점수 순위 예측을 비공개로 봉인합니다.':revealed?'받은 카드 장수와 최고·최저 득점만 공개합니다. 개인 득점은 딜러가 별도로 안내합니다.':r.resolved?'딜러가 결과를 확인하고 공개 버튼을 누르면 카드 장수와 최고·최저 득점이 표시됩니다.':'카드와 아이템을 함께 비공개로 제출합니다. 모든 제출이 끝나면 득점을 계산합니다.';
    $('priority-strip').innerHTML='<span class="tiny muted">점수 동점은 가장 최근 라운드 득점부터 역순으로 비교합니다.</span>';
    $('public-guide').hidden=dealer||g.started;
  }
  function renderEditor(){
    $('editor').hidden=!dealer||!session.game.started||round().resolved;
    if($('editor').hidden){$('editor').innerHTML='';return;}
    const g=session.game,d=draftFor(selected),sealed=!!round().submissions[selected],cards=E.availableCards(g,selected),items=E.availableItems(g,selected);
    $('editor').innerHTML='<div class="editor-head"><h2>비공개 카드 제출</h2><span class="tag">진행자 전용</span></div><div class="player-tabs">'+g.players.map(p=>'<button class="player-tab'+(p.id===selected?' selected':'')+'" data-select-player="'+p.id+'">'+esc(p.name)+(round().submissions[p.id]?'<span class="check">✓</span>':'')+'</button>').join('')+'</div><div class="assignment-grid"><div class="assignment'+(activeSlot==='self'?' active':'')+'" data-slot="self" role="button" tabindex="'+(sealed?'-1':'0')+'" aria-label="자신에게 사용할 카드 선택"><div class="assignment-label"><span>자신에게</span><span>'+esc(name(selected))+'</span></div><div class="assignment-value">'+(d.self===null?'—':signed(d.self))+'</div></div><div class="assignment'+(activeSlot==='other'?' active':'')+'" data-slot="other" role="button" tabindex="'+(sealed?'-1':'0')+'" aria-label="상대에게 사용할 카드 선택"><div class="assignment-label"><span>다른 플레이어에게</span><span>대상 선택</span></div><div class="assignment-other"><div class="assignment-value">'+(d.other===null?'—':signed(d.other))+'</div><select id="target-select" aria-label="상대 카드를 받을 플레이어"'+(sealed?' disabled':'')+'>'+opts(g.players,d.target,selected)+'</select></div></div></div><div class="hand-grid">'+E.NUMBERS.map(v=>'<button class="number-card'+(v<0?' minus':'')+(!cards.includes(v)?' used':'')+((d.self===v||d.other===v)?' chosen':'')+'" data-card="'+v+'"'+(!cards.includes(v)||sealed?' disabled':'')+' aria-label="'+signed(v)+(d.self===v?' 자신에게 선택':d.other===v?' 상대에게 선택':!cards.includes(v)?' 사용 완료':' 카드')+'"><span class="corner">'+signed(v)+'</span>'+signed(v)+'<span class="selection-label">'+(d.self===v?'자신':d.other===v?'상대':!cards.includes(v)?'사용 완료':'')+'</span></button>').join('')+'</div><p class="editor-hint">'+(sealed?'제출 내용이 봉인되었습니다. 입력 오류는 아래 정정 버튼으로 수정할 수 있습니다.':'사용할 칸을 선택한 뒤 숫자 카드를 누르세요. 먼저 자신에게 쓸 카드를 선택하면 상대 카드 선택으로 넘어갑니다.')+'</p>'+(items.length?'<div class="item-editor"><div class="divider-label">추가 아이템 · 기본 카드와 함께 제출</div>'+items.map(k=>{const choice=d.items.find(x=>x.kind===k);return '<div class="item-row"><label><input type="checkbox" data-item-check="'+k+'"'+(choice?' checked':'')+(sealed?' disabled':'')+'>'+itemName(k)+'</label><select data-item-target="'+k+'" aria-label="'+itemName(k)+' 아이템 대상"'+(!choice||sealed?' disabled':'')+'>'+opts(g.players,choice?choice.target:selected)+'</select></div>';}).join('')+'</div>':'<p class="tiny muted subtle-line">사용 가능한 추가 아이템이 없습니다.</p>')+'<div class="editor-actions"><span class="editor-lock">'+(sealed?'✓ 제출 봉인 완료':'선택 가능 '+cards.length+'장')+'</span>'+(sealed?'<button data-action="correct" class="btn-sm">제출 입력 정정</button>':'<button data-action="clear-draft" class="btn-sm">선택 지우기</button><button data-action="submit" class="primary">카드 제출 확정</button>')+'</div>';
  }
  function renderPrivateResults(){
    const r=round(),g=session.game;
    $('private-results').hidden=!dealer||!r.resolved;
    if($('private-results').hidden){$('private-results').innerHTML='';return;}
    let html='<div class="panel-title"><h2>개인 득점 안내</h2><span class="tag">진행자 전용</span></div><table class="ranking"><thead><tr><th>플레이어</th><th>받은 장수</th><th>이번 득점</th><th>누적 득점</th><th>개인 안내</th></tr></thead><tbody>'+g.players.map(p=>{const rr=r.results.find(x=>x.id===p.id);return '<tr><td>'+esc(p.name)+'</td><td>'+rr.count+'장</td><td class="'+(rr.score<0?'negative':'positive')+'">'+signed(rr.score)+'</td><td>'+signed(total(p.id))+'</td><td><button class="btn-sm" data-private-message="'+p.id+'"'+(!session.published[g.roundIndex]?' disabled':'')+'>안내문</button></td></tr>';}).join('')+'</tbody></table><p class="tiny muted" style="margin-top:10px">개인 안내는 라운드 결과를 공개한 뒤 사용할 수 있습니다.</p>';
    if(isFinished()&&!session.finalRevealed)html+='<div class="subtle-line"><h3>'+(rematch()?'재경기 필요':'최종 결과 미리보기')+'</h3>'+(rematch()?'<p class="tiny muted">10라운드의 각 득점까지 같은 플레이어가 있습니다. 기록을 저장하고 새 경기를 준비하세요.</p>':finalTable(true))+'</div>';
    $('private-results').innerHTML=html;
  }
  function finalTable(showTotal){
    if(rematch())return '<p class="tiny muted">재경기가 필요하여 최종 순위를 확정하지 않습니다.</p>';
    return '<table class="ranking"><thead><tr><th>최종 순위</th><th>플레이어</th><th>점수 순위</th><th>예측</th><th>판정</th>'+(showTotal?'<th>누적 점수</th>':'')+'</tr></thead><tbody>'+E.finalStandings(session.game).map(p=>'<tr class="'+(p.success?'success':'')+'"><td class="rank-num">'+p.finalRank+'</td><td>'+esc(name(p.id))+'</td><td>'+p.scoreRank+'위</td><td>'+p.prediction+'위</td><td class="'+(p.success?'success-mark':'fail-mark')+'">'+(p.success?'예측 성공':'예측 실패')+'</td>'+(showTotal?'<td>'+signed(p.total)+'</td>':'')+'</tr>').join('')+'</tbody></table>';
  }
  function renderRankPanels(){
    $('checkpoint').hidden=!session.published[4];
    const middle=session.published[4]?E.rankings(session.game,4):[];
    $('checkpoint').innerHTML=session.published[4]?'<div class="panel-title"><h2>5라운드 중간 점수 순위</h2><span class="tag">5라운드 종료 시점</span></div><div class="checkpoint-list">'+middle.map(p=>'<div class="checkpoint-person"><b style="font-size:18px">'+rankLabel(p,middle)+'</b><span>'+esc(name(p.id))+'</span></div>').join('')+'</div><p class="tiny muted" style="margin-top:10px">누적 점수는 비공개입니다. 현재까지의 모든 라운드 득점이 같으면 공동 순위로 표시합니다.</p>':'';
    $('final-panel').hidden=!session.finalRevealed&&!(rematch()&&session.published[9]);
    $('final-panel').innerHTML=rematch()&&session.published[9]?'<div class="panel-title"><h2>재경기 필요</h2><span class="tag">점수 순위 미확정</span></div><p class="tiny muted">10라운드의 각 라운드 득점까지 같은 플레이어가 있어 재경기를 진행합니다. 이번 기록은 경기 파일로 저장할 수 있습니다.</p>':session.finalRevealed?'<div class="panel-title"><h2>최종 순위</h2><span class="eyebrow">THE FINAL ORDER</span></div>'+finalTable(dealer)+'<p class="tiny muted" style="margin-top:12px">예측 성공자 점수 순위순 → 예측 실패자 점수 순위순</p>':'';
  }
  function renderOperations(){
    const g=session.game,r=round(),count=Object.keys(r.submissions).length;
    $('submission-count').textContent=count+' / 5 제출';
    $('submission-progress').innerHTML=g.players.map(p=>'<span class="selection-dot'+(r.submissions[p.id]?' ready':'')+'">'+esc(p.name)+(r.submissions[p.id]?' ✓':'')+'</span>').join('');
    $('resolve').disabled=!g.started||r.resolved||count!==5||pendingMeetings().length>0;
    $('publish').disabled=!r.resolved||session.published[g.roundIndex];
    $('public-message').disabled=!session.published[g.roundIndex];
    $('next').disabled=!r.resolved||!session.published[g.roundIndex]||session.finalRevealed||rematch()||pendingMeetings().length>0;
    $('next').textContent=rematch()?'재경기 필요':g.roundIndex===9?'최종 순위 공개':'다음 라운드';
    $('operation-note').textContent=!g.started?'경기 준비에서 각자의 비공개 예측을 확정하세요.':rematch()?'10라운드의 각 득점까지 같아 재경기가 필요합니다. 기록을 저장한 뒤 새 경기를 준비하세요.':pendingMeetings().length?'접수한 독대를 완료하면 라운드 정산을 진행할 수 있습니다.':!r.resolved?'다섯 명의 제출이 봉인되면 득점을 계산하세요.':!session.published[g.roundIndex]?'득점 계산 완료. 결과 공개 시 카드 장수와 최고·최저 득점이 표시됩니다.':g.roundIndex===4?'중간 점수 순위가 함께 공개되었습니다. 개인 득점을 안내한 뒤 진행하세요.':g.roundIndex===9?'개인 득점을 안내한 뒤 최종 순위와 예측을 공개하세요.':'개인 득점을 안내한 뒤 다음 라운드로 진행하세요.';
  }
  function renderStore(){
    const g=session.game,purchase=g.purchases[storePlayer],available=currentItems(storePlayer),garnets=E.remainingGarnets(g,storePlayer);
    $('store-player').innerHTML=opts(g.players,storePlayer);
    $('store').innerHTML='<div class="player-stat"><span>남은 가넷</span><b>'+garnets+'개</b></div><div class="item-store">'+['plus','minus','zero'].map(k=>'<button data-buy="'+k+'"'+(isFinished()||(k==='zero'?purchase.zero:purchase.boost!==null)||garnets<E.ITEM_COSTS[k]?' disabled':'')+'><strong>'+itemName(k)+'</strong>'+E.ITEM_COSTS[k]+'가넷</button>').join('')+'</div><div class="item-inventory">구매: '+(purchase.boost?itemName(purchase.boost):'±11 없음')+' / '+(purchase.zero?'0 구매':'0 없음')+'<br>미사용: '+(available.length?available.map(itemName).join(', '):'없음')+'</div>';
  }
  function renderHistory(){
    const records=session.game.rounds.map((r,i)=>({r,i})).filter(x=>x.r.resolved&&(dealer||session.published[x.i]));
    $('history-content').innerHTML=records.length?records.map(({r,i})=>'<details><summary><span class="gold-text">'+String(i+1).padStart(2,'0')+' ROUND</span><span>'+(session.published[i]?'공개 완료':'공개 전')+' · 최고 '+signed(Math.max.apply(null,r.results.map(x=>x.score)))+' / 최저 '+signed(Math.min.apply(null,r.results.map(x=>x.score)))+'</span></summary><div class="history-counts">'+r.results.map(x=>esc(name(x.id))+' '+x.count+'장').join(' · ')+'</div>'+(dealer?'<table class="audit"><thead><tr><th>플레이어</th><th>득점</th><th>받은 카드 · 제출자</th></tr></thead><tbody>'+r.results.map(x=>'<tr><td>'+esc(name(x.id))+'</td><td>'+signed(x.score)+'</td><td>'+x.received.map(c=>signed(c.value)+' ('+esc(name(c.from))+(c.kind!=='number'?'·아이템':'')+')').join(', ')+'</td></tr>').join('')+'</tbody></table>':'')+'</details>').join(''):'<div class="empty">정산된 라운드 기록이 여기에 쌓입니다.</div>';
  }
  function renderMeetings(){
    const g=session.game,t=session.timer,list=g.meetings.map((m,i)=>({m,i})).filter(x=>x.m.roundIndex===g.roundIndex);
    $('meeting-count').textContent=list.length+'회 접수';
    $('meeting-choice').innerHTML=g.players.map(p=>'<label><input type="checkbox" data-meeting-player="'+p.id+'"'+(!g.started||round().resolved||E.remainingGarnets(g,p.id)<1?' disabled':'')+'><span>'+esc(p.name)+'</span></label>').join('');
    $('meeting-add').disabled=!g.started||round().resolved;
    const first=pendingMeetings()[0];
    $('meeting-queue').innerHTML=list.map(({m,i},j)=>'<div class="meeting-ticket"><span>'+(j+1)+'. '+m.participants.map(id=>esc(name(id))).join(', ')+'<br>'+(t.done.includes(i)?'완료':t.active===i?'진행 중':'접수 대기')+'</span>'+(!t.done.includes(i)&&t.active===null?'<button data-meeting-start="'+i+'"'+(first&&first.i===i?'':' disabled')+'>시작</button>':'')+'</div>').join('');
    renderClock();
  }
  function renderClock(){
    const t=session.timer,remaining=t.active===null?MEETING_MS:t.deadline===null?t.remaining:Math.max(0,t.deadline-Date.now());
    const seconds=Math.ceil(remaining/1000);
    $('meeting-clock').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
    $('meeting-caption').textContent=t.active===null?'독대 접수 순서대로 진행':t.deadline===null?'일시정지':session.game.meetings[t.active].participants.map(name).join(' · ');
    $('timer-pause').disabled=t.active===null;$('timer-finish').disabled=t.active===null;
    $('timer-pause').textContent=t.deadline===null&&t.active!==null?'다시 시작':'일시정지';
  }
  function render(){
    document.body.classList.toggle('dealer-view',dealer);
    $('view-toggle').setAttribute('aria-checked',String(dealer));$('view-label').textContent='진행자 보기 '+(dealer?'ON':'OFF');
    $('privacy-note').hidden=!dealer;$('sidebar').hidden=!dealer;
    renderSetup();renderTable();renderEditor();renderPrivateResults();renderRankPanels();renderHistory();
    if(dealer){renderOperations();renderStore();renderMeetings();}
    else{$('store').innerHTML='';$('meeting-choice').innerHTML='';$('meeting-queue').innerHTML='';$('submission-progress').innerHTML='';$('operation-note').textContent='';$('meeting-caption').textContent='';}
    ['undo','undo-alt'].forEach(id=>{$(id).disabled=!dealer||!undoStack.length;});
    ['redo','redo-alt'].forEach(id=>{$(id).disabled=!dealer||!redoStack.length;});
    $('save-status').textContent=saved?'이 브라우저에 자동 저장':'자동 저장 불가 · 경기 파일로 저장하세요';
    say(statusText,statusError);
  }
  function openModal(title,body,actions){
    lastFocus=document.activeElement;
    $('modal-root').innerHTML='<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="between"><h2 id="modal-title">'+esc(title)+'</h2><button id="modal-close" class="quiet btn-sm" aria-label="창 닫기">닫기</button></div><div class="modal-body">'+body+'</div><div class="modal-actions">'+actions+'</div></section>';
    $('modal-root').hidden=false;$('modal-close').onclick=closeModal;$('modal-close').focus();
  }
  function closeModal(){ $('modal-root').hidden=true;$('modal-root').innerHTML='';if(lastFocus&&lastFocus.isConnected)lastFocus.focus(); }
  function confirmAction(title,message,fn){
    openModal(title,'<p>'+esc(message)+'</p>','<button id="confirm-cancel">취소</button><button id="confirm-go" class="primary">확인</button>');
    $('confirm-cancel').onclick=closeModal;$('confirm-go').onclick=()=>{closeModal();fn();};
  }
  function showMessage(title,text,explanation){
    openModal(title,'<p>'+esc(explanation)+'</p><textarea id="message-text" readonly aria-label="전달할 안내문">'+esc(text)+'</textarea>','<button id="copy-message" class="primary">안내문 복사</button>');
    $('copy-message').onclick=async()=>{
      try{
        if(navigator.clipboard&&navigator.clipboard.writeText)await navigator.clipboard.writeText(text);
        else{$('message-text').select();if(!document.execCommand('copy'))throw Error('copy');}
        if($('copy-message'))$('copy-message').textContent='복사 완료';
      }catch(err){if($('message-text')){$('message-text').focus();$('message-text').select();$('copy-message').textContent='선택된 안내문을 복사하세요';}}
    };
  }
  const actions={
    'start':()=>confirmAction('예측 봉인 · 경기 시작','다섯 명의 예측을 봉인하고 1라운드를 시작합니다.',()=>actGame(g=>E.lockPredictions(g),'1라운드가 시작되었습니다. 카드와 추가 아이템을 함께 입력하세요.',true)),
    'clear-draft':()=>{delete drafts[session.game.roundIndex+':'+selected];activeSlot='self';renderEditor();},
    'submit':()=>actGame(g=>E.submit(g,selected,draftFor(selected)),name(selected)+'의 제출을 봉인했습니다.'),
    'correct':()=>confirmAction('제출 입력 정정','진행자가 입력 오류를 정정하기 위해 이 플레이어의 봉인을 해제합니다.',()=>actGame(g=>E.unsubmit(g,selected),'봉인을 해제했습니다. 입력을 정정하고 다시 제출하세요.'))
  };
  document.addEventListener('click',event=>{
    const button=event.target.closest('button'),slot=event.target.closest('[data-slot]');
    if(slot&&!event.target.closest('select')&&dealer&&!round().submissions[selected]){activeSlot=slot.dataset.slot;renderEditor();}
    if(!button||button.disabled||!dealer)return;
    try{
      if(button.dataset.action&&actions[button.dataset.action])actions[button.dataset.action]();
      if(button.dataset.selectPlayer){selected=button.dataset.selectPlayer;activeSlot='self';renderEditor();}
      if(button.dataset.card!==undefined){
        const d=draftFor(selected),v=Number(button.dataset.card),other=activeSlot==='self'?'other':'self';
        if(d[other]===v)throw Error('서로 다른 두 장을 선택하세요.');
        d[activeSlot]=d[activeSlot]===v?null:v;
        if(activeSlot==='self'&&d.self!==null)activeSlot='other';
        renderEditor();
      }
      if(button.dataset.buy)actGame(g=>E.buyItem(g,storePlayer,button.dataset.buy),name(storePlayer)+' · '+itemName(button.dataset.buy)+' 아이템 구매 완료');
      if(button.dataset.privateMessage){
        const id=button.dataset.privateMessage,rr=round().results.find(x=>x.id===id);
        const text='[기브 & 테이크 · '+(session.game.roundIndex+1)+'라운드]\n'+name(id)+'님의 이번 득점: '+signed(rr.score)+'점\n누적 득점: '+signed(total(id))+'점\n받은 카드: '+rr.count+'장';
        showMessage(name(id)+' · 개인 안내',text,'이 안내문은 해당 플레이어에게만 전달하세요.');
      }
      if(button.dataset.meetingStart!==undefined){
        const i=Number(button.dataset.meetingStart),first=pendingMeetings()[0];
        if(!first||first.i!==i)throw Error('접수 순서대로 독대를 시작하세요.');
        commit(n=>{if(n.timer.active!==null)throw Error('진행 중인 독대를 먼저 완료하세요.');n.timer.active=i;n.timer.remaining=MEETING_MS;n.timer.deadline=Date.now()+MEETING_MS;},'독대 타이머를 시작했습니다.');
      }
    }catch(err){say(err.message,true);}
  });
  document.addEventListener('change',event=>{
    const t=event.target;if(!dealer)return;
    if(t.dataset.setupName)commit(n=>{const p=n.game.players.find(x=>x.id===t.dataset.setupName);p.name=t.value.trim();},'플레이어 이름을 저장했습니다.');
    if(t.dataset.setupGarnets)commit(n=>{n.game.players.find(x=>x.id===t.dataset.setupGarnets).startingGarnets=Number(t.value);},'보유 가넷을 저장했습니다.');
    if(t.dataset.prediction)actGame(g=>E.setPrediction(g,t.dataset.prediction,t.value?Number(t.value):null),'비공개 예측을 입력했습니다.');
    if(t.id==='target-select'){draftFor(selected).target=t.value;}
    if(t.dataset.itemCheck){
      const d=draftFor(selected),kind=t.dataset.itemCheck;d.items=d.items.filter(x=>x.kind!==kind);if(t.checked)d.items.push({kind,target:selected});renderEditor();
    }
    if(t.dataset.itemTarget){const x=draftFor(selected).items.find(x=>x.kind===t.dataset.itemTarget);if(x)x.target=t.value;}
    if(t.id==='store-player'){storePlayer=t.value;renderStore();}
  });
  $('view-toggle').onclick=()=>{dealer=!dealer;closeModal();render();say(dealer?'진행자 보기 ON · 비공개 정보가 표시됩니다.':'공개 보기로 전환했습니다.',false);};
  function undo(){
    if(!dealer||!undoStack.length)return;redoStack.push(clone(session));session=undoStack.pop();drafts={};save();closeModal();render();say('직전 작업을 되돌렸습니다.',false);
  }
  function redo(){
    if(!dealer||!redoStack.length)return;undoStack.push(clone(session));session=redoStack.pop();drafts={};save();render();say('되돌린 작업을 다시 적용했습니다.',false);
  }
  $('undo').onclick=undo;$('undo-alt').onclick=undo;$('redo').onclick=redo;$('redo-alt').onclick=redo;
  $('resolve').onclick=()=>{ensureOperation(()=>{ensureMeetingsDone();actGame(g=>E.resolveRound(g),'득점을 계산했습니다. 확인 후 라운드 결과를 공개하세요.');});};
  function ensureOperation(fn){if(!dealer)return;try{fn();}catch(err){say(err.message,true);}}
  $('publish').onclick=()=>commit(n=>{
    if(!n.game.rounds[n.game.roundIndex].resolved)throw Error('먼저 득점을 계산하세요.');
    n.published[n.game.roundIndex]=true;
  },session.game.roundIndex===4?'라운드 결과와 5라운드 중간 점수 순위를 공개했습니다.':'라운드 결과를 공개했습니다. 각 플레이어에게 개인 득점을 안내하세요.');
  $('public-message').onclick=()=>{
    if(!dealer||!session.published[session.game.roundIndex])return;
    const r=round();
    let text='[기브 & 테이크 · '+(session.game.roundIndex+1)+'라운드 공개 결과]\n받은 카드: '+r.results.map(x=>name(x.id)+' '+x.count+'장').join(' / ')+'\n최고 득점: '+signed(Math.max.apply(null,r.results.map(x=>x.score)))+'점\n최저 득점: '+signed(Math.min.apply(null,r.results.map(x=>x.score)))+'점';
    if(session.game.roundIndex===4)text+='\n\n[5라운드 중간 점수 순위]\n'+E.rankings(session.game,4).map((x,i,rows)=>rankLabel(x,rows)+': '+name(x.id)).join('\n');
    if(rematch())text+='\n\n10라운드의 각 라운드 득점까지 같은 플레이어가 있어 재경기가 필요합니다.';
    if(session.finalRevealed)text+='\n\n[최종 순위]\n'+E.finalStandings(session.game).map(x=>x.finalRank+'위: '+name(x.id)+' (점수 순위 '+x.scoreRank+'위 / 예측 '+x.prediction+'위 / '+(x.success?'예측 성공':'예측 실패')+')').join('\n');
    showMessage('공개 안내문',text,'공개된 정보만 포함된 안내문입니다.');
  };
  $('next').onclick=()=>ensureOperation(()=>{
    ensureMeetingsDone();
    if(rematch())throw Error('10라운드의 각 득점까지 같아 재경기가 필요합니다.');
    if(!session.published[session.game.roundIndex])throw Error('현재 라운드 결과를 먼저 공개하세요.');
    if(session.game.roundIndex===9)confirmAction('최종 순위 공개','모든 예측과 예측 성공 여부, 최종 순위를 공개합니다.',()=>commit(n=>{n.finalRevealed=true;},'최종 순위를 공개했습니다.'));
    else actGame(g=>E.nextRound(g),(session.game.roundIndex+2)+'라운드가 시작되었습니다.',true);
  });
  $('meeting-add').onclick=()=>{
    const participants=Array.from(document.querySelectorAll('[data-meeting-player]:checked')).map(x=>x.dataset.meetingPlayer);
    actGame(g=>E.addMeeting(g,participants),'독대를 접수하고 참여자마다 가넷 1개를 차감했습니다.');
  };
  $('timer-pause').onclick=()=>commit(n=>{
    if(n.timer.active===null)throw Error('진행 중인 독대가 없습니다.');
    if(n.timer.deadline!==null){n.timer.remaining=Math.max(0,n.timer.deadline-Date.now());n.timer.deadline=null;}
    else n.timer.deadline=Date.now()+n.timer.remaining;
  },session.timer.deadline===null?'독대 타이머를 다시 시작했습니다.':'독대 타이머를 일시정지했습니다.');
  function finishTimer(automatic){
    if(session.timer.active===null)return;
    const next=clone(session);next.timer.done.push(next.timer.active);next.timer.active=null;next.timer.deadline=null;next.timer.remaining=MEETING_MS;
    if(!automatic){undoStack.push(clone(session));redoStack=[];}
    session=next;save();render();say(automatic?'10분이 종료되어 독대를 완료했습니다.':'독대를 완료했습니다.',false);
  }
  $('timer-finish').onclick=()=>finishTimer(false);
  setInterval(()=>{if(session.timer.active!==null&&session.timer.deadline!==null&&Date.now()>=session.timer.deadline)finishTimer(true);else if(dealer)renderClock();},400);
  function download(name,text,type){
    const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('export').onclick=()=>{if(!dealer)return;download('give-take-round-'+(session.game.roundIndex+1)+'.json',JSON.stringify(session,null,2),'application/json');say('현재 경기 파일을 저장했습니다.',false);};
  $('import').onclick=()=>{if(dealer)$('file-input').click();};
  $('file-input').onchange=async event=>{
    const file=event.target.files&&event.target.files[0];event.target.value='';if(!file)return;
    try{
      if(file.size>1000000)throw Error('경기 파일은 1MB 이하로 선택하세요.');
      const incoming=validateSession(JSON.parse(await file.text()));
      confirmAction('경기 불러오기','현재 경기를 선택한 저장 파일로 교체합니다. 현재 경기로 돌아가려면 되돌리기를 사용할 수 있습니다.',()=>{
        undoStack.push(clone(session));redoStack=[];session=incoming;drafts={};dealer=false;save();render();say('경기를 불러왔습니다. 공개 보기로 전환했습니다.',false);
      });
    }catch(err){say('불러오기 실패: '+err.message,true);}
  };
  $('new-game').onclick=()=>{if(!dealer)return;confirmAction('새 경기','현재 경기를 초기화합니다. 필요한 경우 먼저 경기 파일을 저장하세요.',()=>{
    undoStack.push(clone(session));redoStack=[];session=fresh();drafts={};selected='p1';storePlayer='p1';save();render();say('새 경기를 준비합니다.',false);
  });};
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){if(!$('modal-root').hidden)closeModal();else if(dealer){dealer=false;render();say('공개 보기로 전환했습니다.',false);}return;}
    if(!$('modal-root').hidden&&event.key==='Tab'){
      const targets=Array.from($('modal-root').querySelectorAll('button:not([disabled]),textarea,input,select')).filter(x=>!x.hidden);
      if(!targets.length)return;const first=targets[0],last=targets[targets.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
    if(event.target.dataset&&event.target.dataset.slot&&(event.key==='Enter'||event.key===' ')){event.preventDefault();activeSlot=event.target.dataset.slot;renderEditor();}
  });
  window.addEventListener('storage',event=>{if(event.key===KEY&&event.newValue!==JSON.stringify(session))say('다른 창에서 저장 내용이 변경되었습니다. 이 창의 경기 파일을 저장한 뒤 사용할 창 하나만 유지하세요.',true);});
  render();
  if(saved)save();
})();
