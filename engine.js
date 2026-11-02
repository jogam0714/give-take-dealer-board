(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GiveTake = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NUMBERS = Object.freeze(Array.from({ length: 10 }, (_, i) => i - 10).concat(Array.from({ length: 10 }, (_, i) => i + 1)));
  const ITEM_VALUES = Object.freeze({ plus: 11, minus: -11, zero: 0 });
  const ITEM_COSTS = Object.freeze({ plus: 3, minus: 3, zero: 1 });
  const IDS = Object.freeze(['p1', 'p2', 'p3', 'p4', 'p5']);
  const ROUNDS = 10;
  const copy = value => JSON.parse(JSON.stringify(value));
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  function requireRule(condition, message) { if (!condition) throw new Error(message); }
  function isId(id) { return IDS.includes(id); }
  function player(state, id) {
    const found = state.players.find(p => p.id === id);
    requireRule(!!found, '올바른 플레이어를 선택해 주세요.');
    return found;
  }
  function current(state) {
    requireRule(state.started && state.predictionsLocked, '순위 예측을 확정하고 게임을 시작해 주세요.');
    requireRule(integer(state.roundIndex, 0, 9), '라운드 정보가 올바르지 않습니다.');
    return state.rounds[state.roundIndex];
  }
  function writableRound(state) {
    const round = current(state);
    requireRule(!round.resolved, '이미 정산한 라운드입니다. 다음 라운드로 이동해 주세요.');
    return round;
  }
  function complete(state) { return state.rounds.length === ROUNDS && state.rounds.every(r => r.resolved); }
  function validPriority(ids) {
    return Array.isArray(ids) && ids.length === 5 && new Set(ids).size === 5 && ids.every(isId);
  }
  function lastResolvedIndex(state) {
    let last = -1;
    state.rounds.forEach((round, index) => { if (round.resolved) last = index; });
    return last;
  }

  function createGame(config, priorityIds) {
    const input = config === undefined ? IDS.map((_, i) => ({ name: '플레이어 ' + (i + 1), garnets: 0 })) : config;
    requireRule(Array.isArray(input) && input.length === 5, '플레이어는 정확히 5명이어야 합니다.');
    const players = input.map((p, i) => {
      requireRule(isObject(p), '플레이어 정보가 올바르지 않습니다.');
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      const garnets = p.garnets === undefined ? p.startingGarnets : p.garnets;
      requireRule(name.length > 0 && name.length <= 40 && !/[\u0000-\u001f]/.test(name), '이름은 1~40자로 입력해 주세요.');
      requireRule(integer(garnets, 0, 1000000), '시작 가넷은 0 이상의 정수로 입력해 주세요.');
      return { id: IDS[i], name, startingGarnets: garnets };
    });
    requireRule(priorityIds === undefined || validPriority(priorityIds), '동점 우선순위에는 모든 플레이어가 한 번씩 있어야 합니다.');
    const priority = priorityIds === undefined ? IDS.slice() : priorityIds.slice();
    return {
      version: 1,
      players,
      priority,
      predictions: Object.fromEntries(IDS.map(id => [id, null])),
      predictionsLocked: false,
      started: false,
      roundIndex: 0,
      rounds: Array.from({ length: ROUNDS }, () => ({ submissions: {}, resolved: false, results: null })),
      purchases: Object.fromEntries(IDS.map(id => [id, { boost: null, zero: false }])),
      meetings: []
    };
  }

  function setPrediction(state, id, rank) {
    player(state, id);
    requireRule(!state.predictionsLocked && !state.started, '게임 시작 후에는 예측을 바꿀 수 없습니다.');
    requireRule(rank === null || integer(rank, 1, 5), '예측 순위는 1~5위 중 선택해 주세요.');
    const next = copy(state);
    next.predictions[id] = rank;
    return next;
  }
  function setPriority(state, ids) {
    requireRule(!state.predictionsLocked && !state.started, '게임 시작 후에는 동점 우선순위를 바꿀 수 없습니다.');
    requireRule(validPriority(ids), '동점 우선순위에는 모든 플레이어가 한 번씩 있어야 합니다.');
    const next = copy(state);
    next.priority = ids.slice();
    return next;
  }
  function lockPredictions(state) {
    requireRule(!state.started && !state.predictionsLocked, '이미 게임을 시작했습니다.');
    requireRule(IDS.every(id => integer(state.predictions[id], 1, 5)), '다섯 명의 예측 순위를 모두 입력해 주세요.');
    const next = copy(state);
    next.predictionsLocked = true;
    next.started = true;
    return next;
  }

  function remainingGarnets(state, id) {
    const p = player(state, id);
    const purchase = state.purchases[id];
    const itemCost = (purchase.boost ? 3 : 0) + (purchase.zero ? 1 : 0);
    const meetingCost = state.meetings.reduce((sum, meeting) => sum + (meeting.participants.includes(id) ? 1 : 0), 0);
    return p.startingGarnets - itemCost - meetingCost;
  }
  function buyItem(state, id, kind) {
    player(state, id);
    requireRule(own(ITEM_VALUES, kind), '구매할 아이템을 선택해 주세요.');
    requireRule(!complete(state), '종료된 게임에서는 아이템을 구매할 수 없습니다.');
    const purchase = state.purchases[id];
    if (kind === 'zero') requireRule(!purchase.zero, '0 아이템은 한 번만 구매할 수 있습니다.');
    else requireRule(purchase.boost === null, '+11과 −11 중 하나만 한 번 구매할 수 있습니다.');
    requireRule(remainingGarnets(state, id) >= ITEM_COSTS[kind], '아이템을 구매할 가넷이 부족합니다.');
    const next = copy(state);
    if (kind === 'zero') next.purchases[id].zero = true;
    else next.purchases[id].boost = kind;
    return next;
  }

  function availableCards(state, id, roundIndex) {
    player(state, id);
    const through = roundIndex === undefined ? state.roundIndex : roundIndex;
    requireRule(integer(through, 0, 9), '라운드 정보가 올바르지 않습니다.');
    const used = new Set();
    for (let r = 0; r < through; r += 1) {
      const round = state.rounds[r];
      if (round.resolved && round.submissions[id]) {
        used.add(round.submissions[id].self);
        used.add(round.submissions[id].other);
      }
    }
    return NUMBERS.filter(value => !used.has(value));
  }
  function availableItems(state, id, roundIndex) {
    player(state, id);
    const through = roundIndex === undefined ? state.roundIndex : roundIndex;
    requireRule(integer(through, 0, 9), '라운드 정보가 올바르지 않습니다.');
    const purchase = state.purchases[id];
    const kinds = [].concat(purchase.boost || [], purchase.zero ? ['zero'] : []);
    const used = new Set();
    for (let r = 0; r < through; r += 1) {
      const round = state.rounds[r];
      if (round.resolved && round.submissions[id]) round.submissions[id].items.forEach(item => used.add(item.kind));
    }
    return kinds.filter(kind => !used.has(kind));
  }
  function checkSubmission(state, id, submission, roundIndex) {
    player(state, id);
    requireRule(isObject(submission), '카드 제출 정보를 확인해 주세요.');
    const cards = availableCards(state, id, roundIndex);
    requireRule(cards.includes(submission.self) && cards.includes(submission.other), '자신이 보유한 사용하지 않은 숫자 카드를 선택해 주세요.');
    requireRule(submission.self !== submission.other, '서로 다른 숫자 카드 두 장을 선택해 주세요.');
    requireRule(isId(submission.target) && submission.target !== id, '다른 카드를 받을 상대 플레이어를 선택해 주세요.');
    requireRule(Array.isArray(submission.items) && submission.items.length <= 2, '추가 아이템은 최대 두 장입니다.');
    const available = availableItems(state, id, roundIndex);
    const used = new Set();
    submission.items.forEach(item => {
      requireRule(isObject(item) && own(ITEM_VALUES, item.kind), '아이템 정보가 올바르지 않습니다.');
      requireRule(available.includes(item.kind) && !used.has(item.kind), '구매하여 보유한 미사용 아이템만 한 번 제출할 수 있습니다.');
      requireRule(isId(item.target), '아이템을 받을 플레이어를 선택해 주세요.');
      used.add(item.kind);
    });
  }
  function submit(state, id, submission) {
    writableRound(state);
    const clean = { self: submission && submission.self, other: submission && submission.other, target: submission && submission.target, items: submission && submission.items !== undefined ? submission.items : [] };
    checkSubmission(state, id, clean, state.roundIndex);
    const next = copy(state);
    next.rounds[next.roundIndex].submissions[id] = copy(clean);
    return next;
  }
  function unsubmit(state, id) {
    writableRound(state);
    player(state, id);
    const next = copy(state);
    delete next.rounds[next.roundIndex].submissions[id];
    return next;
  }
  function calculateResults(state, roundIndex) {
    const round = state.rounds[roundIndex];
    const results = IDS.map(id => ({ id, score: 0, count: 0, received: [] }));
    const byId = Object.fromEntries(results.map(result => [result.id, result]));
    function receive(target, from, value, kind) {
      byId[target].received.push({ from, value, kind });
      byId[target].score += value;
      byId[target].count += 1;
    }
    IDS.forEach(id => {
      const submission = round.submissions[id];
      receive(id, id, submission.self, 'number');
      receive(submission.target, id, submission.other, 'number');
      submission.items.forEach(item => receive(item.target, id, ITEM_VALUES[item.kind], item.kind));
    });
    return results;
  }
  function resolveRound(state) {
    const round = writableRound(state);
    requireRule(IDS.every(id => own(round.submissions, id)), '다섯 명의 카드 제출을 모두 완료해 주세요.');
    IDS.forEach(id => checkSubmission(state, id, round.submissions[id], state.roundIndex));
    const next = copy(state);
    next.rounds[next.roundIndex].results = calculateResults(next, next.roundIndex);
    next.rounds[next.roundIndex].resolved = true;
    return next;
  }
  function nextRound(state) {
    const round = current(state);
    requireRule(round.resolved, '현재 라운드를 먼저 정산해 주세요.');
    requireRule(state.roundIndex < ROUNDS - 1, '10라운드가 모두 종료되었습니다.');
    const next = copy(state);
    next.roundIndex += 1;
    return next;
  }
  function rankings(state, through) {
    const last = through === undefined ? lastResolvedIndex(state) : through;
    requireRule(integer(last, -1, 9), '순위를 계산할 라운드가 올바르지 않습니다.');
    for (let r = 0; r <= last; r += 1) requireRule(state.rounds[r].resolved, '정산이 완료된 라운드까지만 순위를 계산할 수 있습니다.');
    const rows = IDS.map(id => {
      const roundScores = state.rounds.slice(0, last + 1).map(round => round.results.find(result => result.id === id).score);
      return { id, total: roundScores.reduce((sum, value) => sum + value, 0), roundScores };
    });
    function compareScores(a, b) {
      if (a.total !== b.total) return b.total - a.total;
      for (let r = last; r >= 0; r -= 1) if (a.roundScores[r] !== b.roundScores[r]) return b.roundScores[r] - a.roundScores[r];
      return 0;
    }
    // Player IDs stabilize display order only. They never break a score tie.
    // The legacy priority field remains readable but has no ranking effect.
    rows.sort((a, b) => compareScores(a, b) || IDS.indexOf(a.id) - IDS.indexOf(b.id));
    let rank = 1;
    return rows.map((row, i) => {
      if (i > 0 && compareScores(rows[i - 1], row) !== 0) rank = i + 1;
      return { ...row, rank };
    });
  }
  function needsRematch(state) {
    if (!complete(state)) return false;
    const rows = rankings(state, 9);
    return new Set(rows.map(row => row.rank)).size < rows.length;
  }
  function finalStandings(state) {
    requireRule(complete(state), '10라운드를 모두 정산한 뒤 최종 순위를 확인할 수 있습니다.');
    requireRule(!needsRematch(state), '모든 라운드의 득점이 같은 플레이어가 있어 재경기가 필요합니다.');
    const rows = rankings(state, 9).map(row => ({ id: row.id, total: row.total, scoreRank: row.rank, prediction: state.predictions[row.id], success: state.predictions[row.id] === row.rank }));
    rows.sort((a, b) => Number(b.success) - Number(a.success) || a.scoreRank - b.scoreRank);
    return rows.map((row, i) => ({ ...row, finalRank: i + 1 }));
  }
  function addMeeting(state, participantIds) {
    writableRound(state);
    requireRule(Array.isArray(participantIds) && participantIds.length >= 2 && participantIds.length <= 5 && participantIds.every(isId) && new Set(participantIds).size === participantIds.length, '독대에 참여할 서로 다른 플레이어를 두 명 이상 선택해 주세요.');
    requireRule(participantIds.every(id => remainingGarnets(state, id) >= 1), '참여자 모두에게 가넷이 한 개 이상 필요합니다.');
    const next = copy(state);
    next.meetings.push({ roundIndex: next.roundIndex, participants: participantIds.slice() });
    return next;
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => deepEqual(value, b[i]));
    if (!isObject(a) || !isObject(b)) return false;
    const keys = Object.keys(a).sort();
    return deepEqual(keys, Object.keys(b).sort()) && keys.every(key => deepEqual(a[key], b[key]));
  }
  function validateState(raw) {
    requireRule(isObject(raw), '저장 파일에 게임 상태가 없습니다.');
    let serialized;
    try { serialized = JSON.stringify(raw); } catch (_) { throw new Error('읽을 수 없는 저장 파일입니다.'); }
    requireRule(typeof serialized === 'string' && serialized.length <= 500000, '저장 파일의 크기 또는 형식이 올바르지 않습니다.');
    const state = JSON.parse(serialized);
    requireRule(state.version === 1, '지원하지 않는 저장 파일 버전입니다.');
    requireRule(Array.isArray(state.players) && state.players.length === 5, '플레이어 정보가 올바르지 않습니다.');
    state.players.forEach((p, i) => {
      requireRule(isObject(p) && p.id === IDS[i] && typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 40 && !/[\u0000-\u001f]/.test(p.name) && integer(p.startingGarnets, 0, 1000000), '플레이어 이름 또는 시작 가넷이 올바르지 않습니다.');
    });
    requireRule(validPriority(state.priority), '저장된 동점 우선순위가 올바르지 않습니다.');
    requireRule(isObject(state.predictions) && Object.keys(state.predictions).length === 5 && IDS.every(id => state.predictions[id] === null || integer(state.predictions[id], 1, 5)), '저장된 예측 순위가 올바르지 않습니다.');
    requireRule(typeof state.started === 'boolean' && typeof state.predictionsLocked === 'boolean' && state.started === state.predictionsLocked, '게임 시작 상태가 올바르지 않습니다.');
    if (state.started) requireRule(IDS.every(id => integer(state.predictions[id], 1, 5)), '확정된 예측 순위가 누락되어 있습니다.');
    requireRule(integer(state.roundIndex, 0, 9) && Array.isArray(state.rounds) && state.rounds.length === 10, '저장된 라운드 정보가 올바르지 않습니다.');
    requireRule(isObject(state.purchases) && Object.keys(state.purchases).length === 5, '아이템 구매 기록이 올바르지 않습니다.');
    IDS.forEach(id => {
      const purchase = state.purchases[id];
      requireRule(isObject(purchase) && [null, 'plus', 'minus'].includes(purchase.boost) && typeof purchase.zero === 'boolean', '아이템 구매 기록이 올바르지 않습니다.');
    });
    requireRule(Array.isArray(state.meetings), '독대 기록이 올바르지 않습니다.');
    state.meetings.forEach(meeting => {
      requireRule(isObject(meeting) && integer(meeting.roundIndex, 0, state.roundIndex) && Array.isArray(meeting.participants) && meeting.participants.length >= 2 && meeting.participants.length <= 5 && meeting.participants.every(isId) && new Set(meeting.participants).size === meeting.participants.length, '독대 참여자 또는 라운드가 올바르지 않습니다.');
    });
    requireRule(IDS.every(id => remainingGarnets(state, id) >= 0), '보유 가넷보다 많은 가넷을 사용한 기록입니다.');
    let resolvedCount = 0;
    let seenUnresolved = false;
    state.rounds.forEach((round, r) => {
      requireRule(isObject(round) && isObject(round.submissions) && typeof round.resolved === 'boolean', '카드 제출 기록이 올바르지 않습니다.');
      requireRule(Object.keys(round.submissions).every(isId), '알 수 없는 플레이어의 제출 기록입니다.');
      if (round.resolved) {
        requireRule(!seenUnresolved && state.started, '라운드 정산 순서가 올바르지 않습니다.');
        resolvedCount += 1;
        requireRule(IDS.every(id => own(round.submissions, id)), '정산된 라운드의 제출 카드가 누락되었습니다.');
      } else {
        seenUnresolved = true;
        requireRule(round.results === null, '미정산 라운드에 결과가 저장되어 있습니다.');
      }
      if (r > state.roundIndex || !state.started) requireRule(Object.keys(round.submissions).length === 0 && !round.resolved, '진행하지 않은 라운드에 제출 기록이 있습니다.');
      Object.keys(round.submissions).forEach(id => checkSubmission(state, id, round.submissions[id], r));
      if (round.resolved) requireRule(deepEqual(round.results, calculateResults(state, r)), '저장된 득점 또는 받은 카드 기록이 실제 제출과 일치하지 않습니다.');
    });
    requireRule(state.roundIndex === resolvedCount || (resolvedCount > 0 && state.roundIndex === resolvedCount - 1), '현재 라운드와 정산 기록이 일치하지 않습니다.');
    if (!state.started) requireRule(state.roundIndex === 0 && resolvedCount === 0 && state.meetings.length === 0, '시작 전 게임 상태가 올바르지 않습니다.');
    return state;
  }

  return Object.freeze({ NUMBERS, ITEM_VALUES, ITEM_COSTS, createGame, setPrediction, setPriority, lockPredictions, buyItem, availableCards, availableItems, submit, unsubmit, resolveRound, nextRound, rankings, needsRematch, finalStandings, remainingGarnets, addMeeting, validateState });
});
