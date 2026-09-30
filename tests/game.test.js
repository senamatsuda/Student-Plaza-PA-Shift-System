import test from 'node:test';
import assert from 'node:assert/strict';
import { TetrisGame, COLS, ROWS } from '../game.js';

const gameWith = random => new TetrisGame(() => random);

test('creates an empty 10 × 20 board and starts with a piece', () => {
  const game = gameWith(0); game.start();
  assert.equal(game.board.length, ROWS); assert.ok(game.board.every(row => row.length === COLS)); assert.ok(game.active); assert.equal(game.level, 1);
});

test('prevents pieces from leaving the playfield', () => {
  const game = gameWith(0); game.start();
  while (game.move(-1, 0));
  assert.equal(game.move(-1, 0), false); assert.ok(game.active.x >= 0);
});

test('clears completed lines and applies classic scoring', () => {
  const game = gameWith(0); game.start(); game.board[ROWS - 1].fill('I');
  assert.equal(game.clearLines(), 1); assert.equal(game.lines, 1); assert.equal(game.score, 100); assert.ok(game.board[0].every(cell => cell === null));
});

test('level increases every ten cleared lines', () => {
  const game = gameWith(0); game.start();
  for (let i = 0; i < 10; i++) { game.board[ROWS - 1].fill('T'); game.clearLines(); }
  assert.equal(game.lines, 10); assert.equal(game.level, 2); assert.ok(game.dropInterval() < 850);
});

test('hard drop locks the piece and awards distance points', () => {
  const game = gameWith(0); game.start(); const first = game.active;
  const distance = game.hardDrop();
  assert.ok(distance > 0); assert.notEqual(game.active, first); assert.ok(game.score >= distance * 2); assert.ok(game.board.some(row => row.some(Boolean)));
});

test('pause blocks movement until resumed', () => {
  const game = gameWith(0); game.start(); const x = game.active.x;
  game.togglePause(); assert.equal(game.move(1, 0), false); assert.equal(game.active.x, x); game.togglePause(); assert.equal(game.move(1, 0), true);
});

test('seven-bag provides every tetromino exactly once', () => {
  const game = gameWith(.5); const draws = [game.nextType]; for (let i = 0; i < 6; i++) draws.push(game.takeFromBag());
  assert.deepEqual(new Set(draws), new Set(['I', 'J', 'L', 'O', 'S', 'T', 'Z']));
});
