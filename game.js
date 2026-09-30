export const COLS = 10;
export const ROWS = 20;

export const PIECES = {
  I: { color: '#26e5e5', shape: [[1, 1, 1, 1]] },
  J: { color: '#6477ff', shape: [[1, 0, 0], [1, 1, 1]] },
  L: { color: '#ff9f43', shape: [[0, 0, 1], [1, 1, 1]] },
  O: { color: '#ffe45e', shape: [[1, 1], [1, 1]] },
  S: { color: '#50e38a', shape: [[0, 1, 1], [1, 1, 0]] },
  T: { color: '#b967ff', shape: [[0, 1, 0], [1, 1, 1]] },
  Z: { color: '#ff4f70', shape: [[1, 1, 0], [0, 1, 1]] },
};

const copy = matrix => matrix.map(row => [...row]);

export class TetrisGame {
  constructor(random = Math.random) { this.random = random; this.reset(); }
  reset() {
    this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.score = 0; this.lines = 0; this.level = 1; this.over = false; this.paused = false;
    this.bag = []; this.nextType = this.takeFromBag(); this.active = null;
  }
  takeFromBag() {
    if (!this.bag.length) {
      this.bag = Object.keys(PIECES);
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop();
  }
  start() { this.reset(); this.spawn(); }
  spawn() {
    const type = this.nextType;
    this.nextType = this.takeFromBag();
    const shape = copy(PIECES[type].shape);
    this.active = { type, shape, x: Math.floor((COLS - shape[0].length) / 2), y: 0 };
    if (this.collides(this.active)) this.over = true;
    return !this.over;
  }
  collides(piece, dx = 0, dy = 0, shape = piece.shape) {
    return shape.some((row, y) => row.some((cell, x) => cell && (
      piece.x + x + dx < 0 || piece.x + x + dx >= COLS || piece.y + y + dy >= ROWS ||
      (piece.y + y + dy >= 0 && this.board[piece.y + y + dy][piece.x + x + dx])
    )));
  }
  move(dx, dy) {
    if (!this.active || this.over || this.paused || this.collides(this.active, dx, dy)) return false;
    this.active.x += dx; this.active.y += dy; return true;
  }
  rotate() {
    if (!this.active || this.over || this.paused || this.active.type === 'O') return false;
    const rotated = this.active.shape[0].map((_, i) => this.active.shape.map(row => row[i]).reverse());
    for (const kick of [0, -1, 1, -2, 2]) {
      if (!this.collides(this.active, kick, 0, rotated)) { this.active.shape = rotated; this.active.x += kick; return true; }
    }
    return false;
  }
  tick() { if (!this.move(0, 1) && !this.paused && !this.over) this.lock(); }
  hardDrop() {
    if (!this.active || this.paused || this.over) return 0;
    let distance = 0; while (this.move(0, 1)) distance++;
    this.score += distance * 2; this.lock(); return distance;
  }
  softDrop() { if (this.move(0, 1)) { this.score++; return true; } this.tick(); return false; }
  lock() {
    this.active.shape.forEach((row, y) => row.forEach((cell, x) => { if (cell && this.active.y + y >= 0) this.board[this.active.y + y][this.active.x + x] = this.active.type; }));
    this.clearLines(); this.spawn();
  }
  clearLines() {
    let cleared = 0;
    this.board = this.board.filter(row => { if (row.every(Boolean)) { cleared++; return false; } return true; });
    while (this.board.length < ROWS) this.board.unshift(Array(COLS).fill(null));
    if (cleared) { this.score += [0, 100, 300, 500, 800][cleared] * this.level; this.lines += cleared; this.level = Math.floor(this.lines / 10) + 1; }
    return cleared;
  }
  ghostY() { if (!this.active) return 0; let dy = 0; while (!this.collides(this.active, 0, dy + 1)) dy++; return this.active.y + dy; }
  togglePause() { if (!this.over && this.active) this.paused = !this.paused; return this.paused; }
  dropInterval() { return Math.max(90, 850 - (this.level - 1) * 65); }
}
