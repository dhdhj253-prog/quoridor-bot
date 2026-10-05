import { InlineKeyboard } from 'grammy';
import { THEME, type Mode } from '../theme.js';
import type { GameRow, State, Player } from '../types.js';
import { Engine, cellName, toEngineState } from '../engine/index.js';

export function blueId(g: GameRow) {
  return (g.state as any).blue_id ?? Number(g.p1_id);
}

export function blueRedFor(g: GameRow) {
  const b = blueId(g);
  return { blue: b, red: b === Number(g.p1_id) ? Number(g.p2_id) : Number(g.p1_id) };
}

export function gameText(g: GameRow, mode: Mode = 'move') {
  const s = g.state;
  const isVsBot = g.vs_bot;

  const p1Name = s.p1_name || (isVsBot ? 'You' : 'Player 1');
  const p2Name = isVsBot ? 'Bot' : (s.p2_name || 'Player 2');

  const p1 = `${THEME.blue} ${p1Name}`;
  const p2 = isVsBot ? `${THEME.bot} Bot` : `${THEME.red} ${p2Name}`;

  if (s.over >= 0) {
    const winner = s.over === 0 ? p1 : p2;
    return `🏆 <b>${winner} wins!</b>\n<pre>${p1Name} (${s.walls[0]}⬛) · ${p2Name} (${s.walls[1]}⬛)</pre>`;
  }

  const active = s.turn === 0 ? p1 : p2;
  return `▶️ <b>Turn: ${active}</b> · <pre>${p1Name}:${s.walls[0]}⬛ | ${p2Name}:${s.walls[1]}⬛</pre>`;
}

function cellLabel(c: number, s: State, isVsBot = false) {
  if (s.pos[0] === c) return THEME.blue;
  if (s.pos[1] === c) return isVsBot ? THEME.bot : THEME.red;
  if (s.blocked[c]) return THEME.wall;
  return THEME.empty;
}

export function boardKeyboard(g: GameRow, mode: Mode = 'move', viewer?: number) {
  const kb = new InlineKeyboard();
  const s = g.state;
  const isVsBot = g.vs_bot;

  // Directional Mapping for Controller:
  const moveMap = new Map<string, number>();

  if (g.status === 'active' && s.over < 0) {
    if (!isVsBot || s.turn === 0) {
      const e = toEngineState(s);
      const moves = Engine.pawnMoves(e, s.turn);
      const pr = s.pos[s.turn] >> 3;
      const pc = s.pos[s.turn] & 7;

      for (const c of moves) {
        const tr = c >> 3;
        const tc = c & 7;

        if (tr > pr && tc === pc) moveMap.set('up', c);
        else if (tr < pr && tc === pc) moveMap.set('down', c);
        else if (tr === pr && tc < pc) moveMap.set('left', c);
        else if (tr === pr && tc > pc) moveMap.set('right', c);
        else if (tr > pr && tc < pc) moveMap.set('upleft', c);
        else if (tr > pr && tc > pc) moveMap.set('upright', c);
        else if (tr < pr && tc < pc) moveMap.set('downleft', c);
        else if (tr < pr && tc > pc) moveMap.set('downright', c);
      }
    }
  }

  // 8 rows of 8 board buttons (Clean board with zero move hints):
  for (let r = 7; r >= 0; r--) {
    for (let c = 0; c < 8; c++) {
      const x = r * 8 + c;
      kb.text(cellLabel(x, s, isVsBot), `g:${g.id}:${x}:wall`);
    }
    kb.row();
  }

  if (s.over >= 0) {
    return resultKeyboard(process.env.PUBLIC_BOT_USERNAME || 'quoridorplay_bot', g.id);
  }

  // 4 PERMANENT CONTROLLER BUTTONS (Exact original layout):
  // Row 1: Up
  kb.text('⬆️', `dir:${g.id}:up`).row();

  // Row 2: Left & Right
  kb.text('⬅️', `dir:${g.id}:left`)
    .text('➡️', `dir:${g.id}:right`)
    .row();

  // Row 3: Down
  kb.text('⬇️', `dir:${g.id}:down`).row();

  // BYPASS JUMP BUTTONS (Only appear when diagonal bypass jump is needed):
  if (moveMap.has('upleft') || moveMap.has('upright')) {
    if (moveMap.has('upleft')) kb.text('↖️ Jump Left', `dir:${g.id}:upleft`);
    if (moveMap.has('upright')) kb.text('↗️ Jump Right', `dir:${g.id}:upright`);
    kb.row();
  }
  if (moveMap.has('downleft') || moveMap.has('downright')) {
    if (moveMap.has('downleft')) kb.text('↙️ Jump Left', `dir:${g.id}:downleft`);
    if (moveMap.has('downright')) kb.text('↘️ Jump Right', `dir:${g.id}:downright`);
    kb.row();
  }

  // Control action row below D-Pad
  kb.text('🏳 Resign', `do_resign:${g.id}`);

  return kb;
}

export function joinKeyboard(tokenOrId: string, step: 'open' | 'p2' = 'open') {
  const kb = new InlineKeyboard();
  if (step === 'open') {
    kb.text('🤝 Join Game (0/2)', `join_open:${tokenOrId}`);
  } else {
    kb.text('🤝 Join as Player 2 (1/2)', `join_p2:${tokenOrId}`);
  }
  return kb;
}

export function setupKeyboard(id: string) {
  return new InlineKeyboard()
    .text('🔵 Creator', 'blue:' + id + ':creator')
    .text('🔴 Creator', 'red:' + id + ':creator')
    .row()
    .text('▶ Creator first', 'first:' + id + ':0')
    .text('▶ Opponent first', 'first:' + id + ':1')
    .row()
    .text('🎲 Random', 'random:' + id)
    .text('🚀 Start', 'start:' + id);
}

export function resultKeyboard(botUsername: string, id: string) {
  return new InlineKeyboard()
    .text(`${THEME.replay} 720p Replay`, `replay:${id}`)
    .text(`${THEME.review} Review`, `review:${id}`)
    .row()
    .text('🤖 Practice vs Bot', 'practice')
    .switchInline('👥 Play with Friends', '');
}
