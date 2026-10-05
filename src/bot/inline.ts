import { InlineKeyboard, InputFile } from 'grammy';
import type { Bot, Context } from 'grammy';
import { randomUUID } from 'node:crypto';
import { createGame, getGame, setInlineMessage, upsertUser, joinGame, setFirst, getGameByInlineMessage, userNames } from '../db/index.js';
import { gameText, joinKeyboard, setupKeyboard, boardKeyboard, resultKeyboard, blueRedFor } from './ui.js';
import { Engine, toEngineState, fromEngineState } from '../engine/index.js';
import { enginePool } from '../index.js';
import { botMovePractice } from './practice-runtime.js';
import { THEME } from '../theme.js';
import type { Player, Move, State } from '../types.js';

export function registerInline(bot: Bot) {
  bot.on('inline_query', async ctx => {
    const gameId = randomUUID();
    await ctx.answerInlineQuery([
      {
        type: 'article',
        id: `open:${gameId}`,
        title: '⚔️ Challenge a Friend to Quoridor 🚀',
        description: 'Send an open 8×8 Quoridor challenge (both players join manually)',
        thumbnail_url: 'https://cdn-icons-png.flaticon.com/512/3074/3074058.png',
        input_message_content: {
          message_text: `🏰 <b>QUORIDOR CHALLENGE</b>\n\nTap below to join the match!\n👥 <b>Players: 0/2</b>`,
          parse_mode: 'HTML'
        },
        reply_markup: joinKeyboard(gameId, 'open')
      }
    ], { cache_time: 0, is_personal: true });
  });

  bot.on('chosen_inline_result', async ctx => {
    // Both players join manually via the interactive buttons
  });

  bot.callbackQuery(/^join_open:(.+)$/, async ctx => {
    if (!ctx.from) return;
    const gameId = ctx.match[1];
    await upsertUser({ id: ctx.from.id, name: ctx.from.first_name, username: ctx.from.username });

    const p1Name = ctx.from.first_name || ctx.from.username || 'Player 1';
    const { claimPlayer1 } = await import('../db/index.js');
    try {
      const g = await claimPlayer1(gameId, ctx.from.id, p1Name);
      await ctx.answerCallbackQuery({ text: '🚀 Joined as Player 1 (Top / Moves 1st)!' });

      const text = `🏰 <b>QUORIDOR CHALLENGE</b>\n\n🚀 <b>Player 1 (Top):</b> ${g.state.p1_name}\n<i>Waiting for Player 2 to join…</i>\n\n👥 <b>Players: 1/2</b>`;
      const kb = joinKeyboard(g.id, 'p2');

      if (ctx.inlineMessageId) {
        await ctx.api.editMessageTextInline(ctx.inlineMessageId, text, {
          parse_mode: 'HTML',
          reply_markup: kb
        }).catch(() => {});
      } else if (ctx.chat && ctx.msg) {
        await ctx.api.editMessageText(ctx.chat.id, ctx.msg.message_id, text, {
          parse_mode: 'HTML',
          reply_markup: kb
        }).catch(() => {});
      }
    } catch (e: any) {
      if (e.message === 'P1_ALREADY_CLAIMED') {
        await ctx.answerCallbackQuery({ text: '🚀 Player 1 already joined! Tap "Join as Player 2" to play.', show_alert: true });
        const text = `🏰 <b>QUORIDOR CHALLENGE</b>\n\n<i>Waiting for Player 2 to join…</i>\n\n👥 <b>Players: 1/2</b>`;
        const kb = joinKeyboard(gameId, 'p2');
        if (ctx.inlineMessageId) {
          await ctx.api.editMessageReplyMarkupInline(ctx.inlineMessageId, { reply_markup: kb }).catch(() => {});
        }
      } else {
        await ctx.answerCallbackQuery({ text: 'Game already active or expired.', show_alert: true });
      }
    }
  });

  bot.callbackQuery(/^join_p2:(.+)$/, async ctx => {
    if (!ctx.from) return;
    const gameId = ctx.match[1];
    await upsertUser({ id: ctx.from.id, name: ctx.from.first_name, username: ctx.from.username });

    const p2Name = ctx.from.first_name || ctx.from.username || 'Player 2';
    const { joinGame } = await import('../db/index.js');
    try {
      const activeGame = await joinGame(gameId, ctx.from.id, p2Name);
      await ctx.answerCallbackQuery({ text: '👾 You joined as Player 2 (Bottom)! Match starting!' });

      const kb = boardKeyboard(activeGame, 'move', Number(activeGame.p1_id));
      const text = gameText(activeGame, 'move');

      if (ctx.inlineMessageId) {
        await ctx.api.editMessageTextInline(ctx.inlineMessageId, text, {
          parse_mode: 'HTML',
          reply_markup: kb
        }).catch(() => {});
      } else if (ctx.chat && ctx.msg) {
        await ctx.api.editMessageText(ctx.chat.id, ctx.msg.message_id, text, {
          parse_mode: 'HTML',
          reply_markup: kb
        }).catch(() => {});
      }
    } catch (e: any) {
      if (e.message === 'CREATOR_CANNOT_JOIN') {
        await ctx.answerCallbackQuery({ text: '🚀 You are already Player 1! Waiting for an opponent to join.', show_alert: true });
      } else if (e.message === 'GAME_STARTED' || e.message === 'ALREADY_JOINED') {
        await ctx.answerCallbackQuery({ text: '⚠️ Match already started with 2 players!', show_alert: true });
      } else {
        await ctx.answerCallbackQuery({ text: 'Could not join game: ' + (e.message || 'Error'), show_alert: true });
      }
    }
  });

  bot.callbackQuery(/^practice$/, async ctx => {
    await ctx.answerCallbackQuery({ text: 'Starting practice…' });
    if (!ctx.from) return;
    await upsertUser({ id: ctx.from.id, name: ctx.from.first_name, username: ctx.from.username });
    const { createPracticeGame } = await import('../db/index.js');
    const g = await createPracticeGame(ctx.from.id);
    if (ctx.callbackQuery.message) {
      await ctx.editMessageText(gameText(g), {
        parse_mode: 'HTML',
        reply_markup: boardKeyboard(g, 'move', ctx.from.id)
      }).catch(async () => {
        await ctx.reply(gameText(g), {
          parse_mode: 'HTML',
          reply_markup: boardKeyboard(g, 'move', ctx.from.id)
        });
      });
    } else {
      await ctx.api.sendMessage(ctx.from.id, gameText(g), {
        parse_mode: 'HTML',
        reply_markup: boardKeyboard(g, 'move', ctx.from.id)
      });
    }
  });

  bot.callbackQuery(/^join:(.+)$/, async ctx => {
    // Backward compatibility for old challenge messages
    const id = ctx.match[1];
    const gameId = id.replace(/^(pending|open):/, '');
    const g = await getGame(gameId);
    if (g && Number(g.p1_id) !== ctx.from?.id && !g.p2_id) {
      const p2Name = ctx.from?.first_name || ctx.from?.username || 'Player 2';
      const { joinGame } = await import('../db/index.js');
      try {
        const activeGame = await joinGame(g.id, ctx.from!.id, p2Name);
        await ctx.editMessageText(gameText(activeGame, 'move'), {
          parse_mode: 'HTML',
          reply_markup: boardKeyboard(activeGame, 'move', Number(activeGame.p1_id))
        });
      } catch {}
    }
  });

  bot.callbackQuery(/^mode:(.+):(move|wall|resign_confirm)$/, async ctx => {
    const m = ctx.match[2];
    const text = m === 'move' ? '🚶 Move mode' : m === 'wall' ? '🧱 Wall mode' : '⚠️ Confirm resignation';
    const g = await getGame(ctx.match[1]);
    if (!g) return;
    const s = g.state;
    const { blue, red } = blueRedFor(g);
    if (ctx.from.id !== (s.turn === 0 ? blue : red)) {
      await ctx.answerCallbackQuery({ text: "⏳ You can change mode on your turn!", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text });
    (s.modeByPlayer ??= {})[String(ctx.from.id)] = m as any;
    await saveStateOnly(g.id, s);
    await editBoard(ctx, g);
  });

  bot.callbackQuery('noop', async ctx => {
    await ctx.answerCallbackQuery({ text: '🕹 Tap arrow buttons around to move your pawn!' });
  });

  bot.callbackQuery(/^dir:([^:]+):(up|down|left|right|upleft|upright|downleft|downright)$/, async ctx => {
    if (!ctx.from) return;
    const [, gameId, dir] = ctx.match;
    const g = await getGame(gameId);
    if (!g || g.status !== 'active') {
      return ctx.answerCallbackQuery({ text: 'Game is not active.' });
    }

    const s = g.state;
    const { blue, red } = blueRedFor(g);
    const actor = Number(ctx.from.id);
    const blueId = Number(blue);
    const redId = Number(red);

    if (actor !== blueId && actor !== redId) {
      return ctx.answerCallbackQuery({ text: '👁 You are spectating this match.', show_alert: true });
    }

    const who: Player = actor === blueId ? 0 : 1;
    if (s.turn !== who) {
      const activeName = s.turn === 0 ? (s.p1_name || 'Player 1') : (s.p2_name || (g.vs_bot ? 'Bot' : 'Player 2'));
      return ctx.answerCallbackQuery({
        text: `⏳ It's ${activeName}'s turn! Please wait for them to move.`,
        show_alert: true,
      });
    }

    const e = toEngineState(s);
    const validMoves = Engine.pawnMoves(e, who);
    const pr = s.pos[who] >> 3;
    const pc = s.pos[who] & 7;

    let targetCell: number | null = null;
    for (const c of validMoves) {
      const tr = c >> 3;
      const tc = c & 7;
      if (dir === 'up' && tr > pr && tc === pc) targetCell = c;
      else if (dir === 'down' && tr < pr && tc === pc) targetCell = c;
      else if (dir === 'left' && tr === pr && tc < pc) targetCell = c;
      else if (dir === 'right' && tr === pr && tc > pc) targetCell = c;
      else if (dir === 'upleft' && tr > pr && tc < pc) targetCell = c;
      else if (dir === 'upright' && tr > pr && tc > pc) targetCell = c;
      else if (dir === 'downleft' && tr < pr && tc < pc) targetCell = c;
      else if (dir === 'downright' && tr < pr && tc > pc) targetCell = c;
    }

    if (targetCell === null) {
      return ctx.answerCallbackQuery({ text: '🚫 Blocked! You cannot move in that direction.' });
    }

    await handleCell(ctx, g, targetCell, 'move');
  });

  bot.callbackQuery(/^g:([^:]+):(\d+):(move|wall|resign_confirm)$/, async ctx => {
    const [, id, cell, mode] = ctx.match;
    const g = await getGame(id);
    if (!g || g.status !== 'active') {
      await ctx.answerCallbackQuery({ text: 'Game is not active.' });
      return;
    }
    const actualMode = mode === 'resign_confirm' ? 'move' : mode;
    await handleCell(ctx, g, Number(cell), actualMode as any);
  });

  bot.callbackQuery(/^do_resign:(.+)$/, async ctx => {
    if (!ctx.from) return;
    const g = await getGame(ctx.match[1]);
    if (!g || g.status !== 'active') {
      return ctx.answerCallbackQuery({ text: 'Game is no longer active.' });
    }
    const { blue, red } = blueRedFor(g);
    const actor = Number(ctx.from.id);
    const blueId = Number(blue);
    const redId = Number(red);

    if (actor !== blueId && actor !== redId) {
      return ctx.answerCallbackQuery({ text: '👁 Spectators cannot resign.', show_alert: true });
    }

    const { resign } = await import('../db/index.js');
    try {
      const ng = await resign(g.id, actor);
      const isP1 = actor === blueId;
      const p1Label = `${THEME.blue} ${g.state.p1_name || 'Player 1'}`;
      const p2Label = g.vs_bot ? `${THEME.bot} Bot` : `${THEME.red} ${g.state.p2_name || 'Player 2'}`;
      const resignerLabel = isP1 ? p1Label : p2Label;
      const winnerLabel = isP1 ? p2Label : p1Label;

      const msg = `🏰 <b>Quoridor</b> · Match Concluded\n${p1Label} (${g.state.walls[0]}🧱) · ${p2Label} (${g.state.walls[1]}🧱)\n\n🏳 <b>${resignerLabel} resigned.</b>\n🏆 <b>${winnerLabel} wins!</b>`;
      await ctx.answerCallbackQuery({ text: '🏳 You resigned.' });

      const kb = resultKeyboard(process.env.PUBLIC_BOT_USERNAME || 'quoridorplay_bot', g.id);
      if (ctx.inlineMessageId) {
        await ctx.api.editMessageTextInline(ctx.inlineMessageId, msg, {
          parse_mode: 'HTML',
          reply_markup: kb
        }).catch(() => {});
      } else if (ctx.chat && ctx.msg) {
        await ctx.api.editMessageText(ctx.chat.id, ctx.msg.message_id, msg, {
          parse_mode: 'HTML',
          reply_markup: kb
        }).catch(() => {});
      }
    } catch {}
  });
}

async function saveStateOnly(id: string, state: State) {
  await import('../db/index.js').then(m =>
    m.pool.query('UPDATE games SET state=$2 WHERE id=$1', [id, JSON.stringify(state)])
  );
}

async function editBoard(ctx: Context, g: any) {
  const { blue, red } = blueRedFor(g);
  const activePlayerId = g.state.turn === 0 ? blue : red;
  const mode = (g.state.modeByPlayer?.[String(activePlayerId)] ?? 'move') as any;
  if (ctx.callbackQuery?.inline_message_id) {
    await ctx.api.editMessageTextInline(ctx.callbackQuery.inline_message_id, gameText(g, mode), {
      parse_mode: 'HTML',
      reply_markup: boardKeyboard(g, mode, activePlayerId)
    }).catch(() => {});
  } else if (ctx.chat && ctx.msg) {
    await ctx.api.editMessageText(ctx.chat.id, ctx.msg.message_id, gameText(g, mode), {
      parse_mode: 'HTML',
      reply_markup: boardKeyboard(g, mode, activePlayerId)
    }).catch(() => {});
  }
}

async function handleCell(ctx: Context, g: any, c: number, mode: 'move' | 'wall') {
  if (!ctx.from) return;
  const s = g.state;
  const { blue, red } = blueRedFor(g);
  const actor = Number(ctx.from.id);
  const blueId = Number(blue);
  const redId = Number(red);

  if (actor !== blueId && actor !== redId) {
    return ctx.answerCallbackQuery({ text: '👁 You are spectating this match.', show_alert: true });
  }

  const who: Player = actor === blueId ? 0 : 1;
  if (s.turn !== who) {
    const activeName = s.turn === 0 ? (s.p1_name || 'Player 1') : (s.p2_name || (g.vs_bot ? 'Bot' : 'Player 2'));
    return ctx.answerCallbackQuery({
      text: `⏳ It's ${activeName}'s turn! Please wait for them to move.`,
      show_alert: true,
    });
  }

  const e = toEngineState(s);
  let m: Move | null = null;

  if (mode === 'move') {
    // Only controller (D-Pad) moves pawn:
    const validMoves = Engine.pawnMoves(e, who);
    if (validMoves.includes(c)) {
      m = { t: 'm', to: c, pv: s.pos[who] };
    } else {
      return ctx.answerCallbackQuery({ text: 'Illegal move direction.' });
    }
  } else {
    // Clicking ANY block on the board places a wall:
    if (Engine.wallLegal(e, c, who)) {
      if (s.walls[who] <= 0) {
        return ctx.answerCallbackQuery({ text: '🧱 You have 0 walls remaining!', show_alert: true });
      }
      m = { t: 'w', c };
    } else {
      if (s.blocked[c]) return ctx.answerCallbackQuery({ text: '🧱 A wall is already placed here.' });
      if (c === s.pos[0] || c === s.pos[1]) return ctx.answerCallbackQuery({ text: '⚠️ Cannot place wall on a pawn. Move using the arrow buttons below.' });
      if (s.walls[who] <= 0) return ctx.answerCallbackQuery({ text: '🧱 You have 0 walls remaining!' });
      return ctx.answerCallbackQuery({ text: '⚠️ Cannot place wall here: path would be completely blocked!' });
    }
  }

  // Ack callback immediately in background
  void ctx.answerCallbackQuery({ text: m.t === 'm' ? '🚶 Moved pawn' : '🧱 Placed wall' }).catch(() => {});

  const ns: State = {
    ...s,
    blocked: [...s.blocked],
    pos: [...s.pos] as [number, number],
    walls: [...s.walls] as [number, number],
    ply: s.ply + 1,
    turn: (1 - who) as Player,
    lastMove: m.t === 'm' ? { from: m.pv, to: m.to } : { wall: m.c },
    modeByPlayer: { ...s.modeByPlayer, [String(actor)]: 'move' }
  };
  const eg = toEngineState(ns);
  Engine.apply(eg, who, m as any);
  ns.blocked = Array.from(eg.blocked);
  ns.pos = [eg.pos[0], eg.pos[1]];
  ns.walls = [eg.walls[0], eg.walls[1]];

  if (m.t === 'm' && (m.to >> 3) === (who === 0 ? 0 : 7)) ns.over = who;
  if (ns.over < 0 && Engine.pawnMoves(eg, (1 - who) as Player).length === 0 && ns.walls[1 - who] === 0) ns.turn = who;

  let botMoveObj: Move | null = null;
  // In Practice vs Bot: calculate Bot counter-move directly for instant, seamless, zero-flicker response!
  if (g.vs_bot && ns.over < 0) {
    const thinkMs = Number(process.env.BOT_THINK_MS || 60);
    const result = await enginePool.think(toEngineState(ns), 1, thinkMs, []);
    let bm = result.m;
    if (!bm || bm.t === 'p') {
      const e2 = toEngineState(ns);
      const pm = Engine.pawnMoves(e2, 1);
      if (pm.length) bm = { t: 'm', to: pm[0], pv: ns.pos[1] };
      else {
        for (let cell = 0; cell < 64; cell++) {
          if (Engine.wallLegal(e2, cell, 1)) {
            bm = { t: 'w', c: cell };
            break;
          }
        }
      }
    }

    if (bm) {
      botMoveObj = bm;
      ns.ply += 1;
      ns.turn = 0;
      ns.lastMove = bm.t === 'm' ? { from: bm.pv, to: bm.to } : { wall: bm.c };
      const e2 = toEngineState(ns);
      Engine.apply(e2, 1, bm as any);
      ns.blocked = Array.from(e2.blocked);
      ns.pos = [e2.pos[0], e2.pos[1]];
      ns.walls = [e2.walls[0], e2.walls[1]];
      if (bm.t === 'm' && (bm.to >> 3) === 7) ns.over = 1;
    }
  }

  const status = ns.over >= 0 ? 'finished' : 'active';
  const { commitMove } = await import('../db/index.js');
  try {
    const ng = await commitMove(g.id, actor, g.version, ns, m, status, ns.over >= 0 ? ns.over : null, botMoveObj);
    await editBoard(ctx, ng);
    if (ns.over >= 0 && ctx.callbackQuery?.inline_message_id) {
      await ctx.api.editMessageReplyMarkupInline(ctx.callbackQuery.inline_message_id, {
        reply_markup: resultKeyboard(process.env.PUBLIC_BOT_USERNAME || 'quoridorplay_bot', ng.id)
      }).catch(() => {});
    }
  } catch (e: any) {
    if (e.message === 'STALE') await ctx.answerCallbackQuery({ text: 'That tap was already processed.' });
  }
}

