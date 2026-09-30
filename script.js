import { TetrisGame, PIECES, COLS, ROWS } from './game.js';

const $ = id => document.getElementById(id);
const boardCanvas = $('board'); const ctx = boardCanvas.getContext('2d');
const nextCanvas = $('next'); const nextCtx = nextCanvas.getContext('2d');
const game = new TetrisGame();
let playing = false; let lastDrop = 0; let animationId;

function drawCell(context, x, y, size, color, ghost = false) {
  context.save(); context.globalAlpha = ghost ? .18 : 1;
  context.fillStyle = color; context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  if (!ghost) { context.fillStyle = 'rgba(255,255,255,.24)'; context.fillRect(x * size + 3, y * size + 3, size - 6, 2); context.fillStyle = 'rgba(0,0,0,.18)'; context.fillRect((x + 1) * size - 4, y * size + 3, 2, size - 6); }
  else { context.strokeStyle = color; context.lineWidth = 1.5; context.strokeRect(x * size + 2, y * size + 2, size - 4, size - 4); }
  context.restore();
}
function drawGrid() {
  const size = boardCanvas.width / COLS; ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height); ctx.fillStyle = '#090b17'; ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) { ctx.beginPath(); ctx.moveTo(x * size, 0); ctx.lineTo(x * size, boardCanvas.height); ctx.stroke(); }
  for (let y = 1; y < ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * size); ctx.lineTo(boardCanvas.width, y * size); ctx.stroke(); }
  game.board.forEach((row, y) => row.forEach((type, x) => type && drawCell(ctx, x, y, size, PIECES[type].color)));
  if (game.active) {
    const ghostY = game.ghostY(); game.active.shape.forEach((row, y) => row.forEach((cell, x) => cell && drawCell(ctx, game.active.x + x, ghostY + y, size, PIECES[game.active.type].color, true)));
    game.active.shape.forEach((row, y) => row.forEach((cell, x) => cell && drawCell(ctx, game.active.x + x, game.active.y + y, size, PIECES[game.active.type].color)));
  }
}
function drawNext() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height); const piece = PIECES[game.nextType]; const size = 23; const ox = (nextCanvas.width - piece.shape[0].length * size) / 2; const oy = (nextCanvas.height - piece.shape.length * size) / 2;
  piece.shape.forEach((row, y) => row.forEach((cell, x) => { if (cell) { nextCtx.save(); nextCtx.translate(ox, oy); drawCell(nextCtx, x, y, size, piece.color); nextCtx.restore(); } }));
}
function updateUI() {
  $('score').textContent = String(game.score).padStart(6, '0'); $('level').textContent = String(game.level).padStart(2, '0'); $('lines').textContent = String(game.lines).padStart(2, '0');
  const remainder = game.lines % 10; $('levelMeter').style.width = `${remainder * 10}%`; $('linesToLevel').textContent = `${10 - remainder} LINES`;
  $('pauseButton').innerHTML = game.paused ? '<span>▶</span> RESUME' : '<span>Ⅱ</span> PAUSE';
  $('statusText').textContent = game.over ? 'GAME OVER' : game.paused ? 'PAUSED' : playing ? 'GAME IN PROGRESS' : 'READY TO PLAY'; drawGrid(); drawNext();
}
function showOverlay(title, message, button, kicker = 'NEON BLOCKS') { $('overlayTitle').textContent = title; $('overlayMessage').textContent = message; $('startButton').innerHTML = `${button} <span>↵</span>`; $('overlayKicker').textContent = kicker; $('overlay').classList.remove('hidden'); }
function startGame() { game.start(); playing = true; lastDrop = performance.now(); $('overlay').classList.add('hidden'); $('pauseButton').disabled = false; cancelAnimationFrame(animationId); animationId = requestAnimationFrame(loop); updateUI(); }
function togglePause() { if (!playing || game.over) return; game.togglePause(); game.paused ? showOverlay('PAUSED', '準備ができたらゲームに戻ろう', 'RESUME', 'TAKE A BREATH') : $('overlay').classList.add('hidden'); lastDrop = performance.now(); updateUI(); }
function loop(time) {
  if (!playing) return;
  if (!game.paused && time - lastDrop >= game.dropInterval()) { game.tick(); lastDrop = time; }
  if (game.over) { playing = false; $('pauseButton').disabled = true; showOverlay('GAME OVER', `SCORE ${String(game.score).padStart(6, '0')} — もう一度挑戦しよう`, 'PLAY AGAIN', 'RUN COMPLETE'); updateUI(); return; }
  updateUI(); animationId = requestAnimationFrame(loop);
}
function act(action) { if (!playing || game.paused) return; ({ left:()=>game.move(-1,0), right:()=>game.move(1,0), down:()=>game.softDrop(), rotate:()=>game.rotate(), drop:()=>game.hardDrop() })[action]?.(); updateUI(); }
$('startButton').addEventListener('click', () => game.paused ? togglePause() : startGame()); $('pauseButton').addEventListener('click', togglePause);
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('pointerdown', () => act(button.dataset.action)));
document.addEventListener('keydown', event => {
  const controls = { ArrowLeft:'left', ArrowRight:'right', ArrowDown:'down', ArrowUp:'rotate', x:'rotate', X:'rotate', ' ':'drop' };
  if (event.key === 'p' || event.key === 'P' || event.key === 'Escape') { event.preventDefault(); togglePause(); return; }
  if (event.key === 'Enter' && !playing) { startGame(); return; }
  if (controls[event.key]) { event.preventDefault(); act(controls[event.key]); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && playing && !game.paused) togglePause(); });
updateUI();
