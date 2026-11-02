'use strict';
const assert = require('node:assert/strict');
const G = require('./engine.js');
const IDS = ['p1', 'p2', 'p3', 'p4', 'p5'];
let assertions = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions += 1; };
function start(predictions = [1, 2, 3, 4, 5]) {
  let state = G.createGame(IDS.map(id => ({ name: id, garnets: 4 })), IDS.slice().reverse());
  IDS.forEach((id, i) => { state = G.setPrediction(state, id, predictions[i]); });
  return G.lockPredictions(state);
}
function play(numberAt, targets, predictions) {
  let state = start(predictions);
  const snapshots = [];
  for (let r = 0; r < 10; r += 1) {
    IDS.forEach((id, i) => {
      const number = numberAt(r, i);
      state = G.submit(state, id, { self: number, other: -number, target: targets[i], items: [] });
    });
    state = G.resolveRound(state);
    check(G.validateState(state), state, 'Legal game must remain importable.');
    snapshots.push(state);
    if (r < 9) state = G.nextRound(state);
  }
  return { state, snapshots };
}

// A reversed legacy priority is never a score tiebreaker.
const zero = play(r => r + 1, ['p2', 'p3', 'p4', 'p5', 'p1']);
check(G.rankings(zero.state).map(row => row.rank), [1, 1, 1, 1, 1]);
check(G.rankings(zero.state).map(row => row.id), IDS, 'ID order is display order, not five distinct ranks.');
check(G.rankings(zero.state, 4).map(row => row.rank), [1, 1, 1, 1, 1]);
check(G.needsRematch(zero.snapshots[4]), false, 'An intermediate tie cannot end the game.');
check(G.needsRematch(zero.state), true);
assert.throws(() => G.finalStandings(zero.state), { message: '모든 라운드의 득점이 같은 플레이어가 있어 재경기가 필요합니다.' }); assertions += 1;
check(G.rankings(G.setPriority(G.createGame(), IDS.slice().reverse())).map(row => row.rank), [1, 1, 1, 1, 1]);
const legacy = JSON.parse(JSON.stringify(zero.state));
legacy.priority = IDS.slice().reverse();
check(G.needsRematch(G.validateState(legacy)), true, 'Legacy imports are reevaluated, not reset or arbitrarily ranked.');

// Only p1 and p2 have the same full score vector. Their shared first place
// produces competition ranks 1, 1, 3, 4, 5, including for final rematch detection.
const targets = ['p5', 'p5', 'p4', 'p5', 'p4'];
const pair = play((r, i) => i === 2 ? 10 - r : r + 1, targets);
check(G.rankings(pair.state).map(row => row.rank), [1, 1, 3, 4, 5]);
check(G.needsRematch(pair.state), true);
assert.throws(() => G.finalStandings(pair.state), /재경기가 필요합니다/); assertions += 1;

// Same cumulative scores alone do not require a rematch; latest round scores
// distinguish the top three despite a contrary legacy priority order.
const unique = play((r, i) => 1 + ((r + i) % 10), targets, [2, 3, 1, 4, 1]);
check(G.rankings(unique.state).map(row => row.id), ['p1', 'p3', 'p2', 'p4', 'p5']);
check(G.rankings(unique.state).map(row => row.rank), [1, 2, 3, 4, 5]);
check(G.needsRematch(unique.state), false);
check(G.finalStandings(unique.state).map(row => row.id), ['p2', 'p4', 'p1', 'p3', 'p5']);
check(G.finalStandings(unique.state).map(row => row.finalRank), [1, 2, 3, 4, 5]);

// If the latest score also ties, the previous round still breaks the tie.
const swapped = [2, 1, 3, 4, 5, 6, 7, 9, 8, 10];
const backwards = play((r, i) => i === 1 ? swapped[r] : r + 1, targets);
const rows = G.rankings(backwards.state);
check(rows.find(row => row.id === 'p1').total, rows.find(row => row.id === 'p2').total);
check(rows.find(row => row.id === 'p1').roundScores[9], rows.find(row => row.id === 'p2').roundScores[9]);
check(rows.find(row => row.id === 'p1').rank < rows.find(row => row.id === 'p2').rank, true);

console.log(JSON.stringify({ passed: true, assertions, fullGames: 4, fullRounds: 40, policy: 'No random or priority tiebreak; complete identical score vectors require rematch.' }, null, 2));
