// MmaGuessr 真实 socket.io 4.8.1 客户端联调脚本
// 用法: node mp-interop.js <baseURL> <tokenA> <tokenB>
// 流程: 两个客户端 join -> queued -> matched -> 5 轮 round/answer/roundEnd -> finished
const { io } = require('socket.io-client');

const baseURL = process.argv[2];
const tokenA = process.argv[3];
const tokenB = process.argv[4];

if (!baseURL || !tokenA || !tokenB) {
  console.error('usage: node mp-interop.js <baseURL> <tokenA> <tokenB>');
  process.exit(2);
}

function makePlayer(name, token) {
  const socket = io(baseURL, { auth: { token }, transports: ['polling'], upgrade: false, reconnection: false, timeout: 5000 });
  const p = { name, socket, queue: [], matched: false, rounds: 0, finished: null, errors: [] };
  socket.on('connect', () => console.log(`[${name}] connect sid=${socket.id}`));
  socket.on('connect_error', (e) => { p.errors.push('connect_error:' + e.message); console.log(`[${name}] connect_error ${e.message}`); });
  socket.on('mp:queued', (d) => { p.queue.push(d); console.log(`[${name}] queued pos=${JSON.stringify(d)}`); });
  socket.on('mp:leftQueue', () => console.log(`[${name}] leftQueue`));
  socket.on('mp:matched', (d) => {
    p.matched = d;
    console.log(`[${name}] matched room=${d.roomId} mode=${d.mode} opponent=${d.opponentUsername}`);
  });
  socket.on('mp:round', (d) => {
    p.rounds++;
    console.log(`[${name}] round#${d.roundIndex} total=${d.totalRounds} t=${d.timeLimitMs}ms loc=${d.location && d.location.mapillaryId}`);
    // 模拟玩家猜测：以题目自身附近坐标作答
    const ans = { guessLat: 30 + (p.rounds - 1), guessLng: 100 + (p.rounds - 1), roundIndex: d.roundIndex };
    setTimeout(() => socket.emit('mp:answer', ans), 50);
  });
  socket.on('mp:roundEnd', (d) => console.log(`[${name}] roundEnd#${d.roundIndex} results=${JSON.stringify(d.results)} answerRevealed=${!!d.answer && !!d.answer.lat}`));
  socket.on('mp:finished', (d) => { p.finished = d; console.log(`[${name}] finished rankings=${JSON.stringify(d.rankings)}`); });
  socket.on('mp:opponentLeft', (d) => console.log(`[${name}] opponentLeft ${JSON.stringify(d)}`));
  socket.on('mp:error', (d) => { p.errors.push('mp:error:' + JSON.stringify(d)); console.log(`[${name}] error ${JSON.stringify(d)}`); });
  socket.on('disconnect', (reason) => console.log(`[${name}] disconnect ${reason}`));
  return p;
}

function waitFor(fn, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (fn()) { clearInterval(t); resolve(true); }
      else if (Date.now() - start > timeoutMs) { clearInterval(t); reject(new Error('timeout waiting for ' + label)); }
    }, 100);
  });
}

(async () => {
  const A = makePlayer('A', tokenA);
  const B = makePlayer('B', tokenB);

  await waitFor(() => A.socket.connected && B.socket.connected, 8000, 'both connected');

  A.socket.emit('mp:join', { mode: 'duel' });
  B.socket.emit('mp:join', { mode: 'duel' });

  await waitFor(() => A.matched && B.matched, 10000, 'matchmaking');

  // 等待 5 轮结束 + finished 事件
  const deadline = Date.now() + 30000;
  while ((!A.finished || !B.finished) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
  }

  const ok =
    A.queue.length === 1 && B.queue.length === 1 &&
    A.matched && B.matched &&
    A.matched.roomId === B.matched.roomId &&
    A.rounds === 5 && B.rounds === 5 &&
    A.finished && B.finished &&
    A.finished.rankings.length === 2 && B.finished.rankings.length === 2 &&
    A.errors.length === 0 && B.errors.length === 0;

  console.log('=== INTEROP ' + (ok ? 'PASS' : 'FAIL') + ' ===');
  console.log(JSON.stringify({
    queued: [A.queue.length, B.queue.length],
    sameRoom: A.matched && B.matched ? A.matched.roomId === B.matched.roomId : false,
    roundsA: A.rounds, roundsB: B.rounds,
    finishedA: !!A.finished, finishedB: !!B.finished,
    rankingsA: A.finished && A.finished.rankings.map(r => r.totalScore),
    errors: A.errors.concat(B.errors),
  }, null, 2));

  A.socket.close();
  B.socket.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
