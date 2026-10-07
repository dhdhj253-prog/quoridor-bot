import { InlineKeyboard, InputFile } from 'grammy';
import type { Bot, Context } from 'grammy';
import { randomUUID } from 'node:crypto';
import {
  createGame,
  getGame,
  setInlineMessage,
  upsertUser,
  getUser,
  isUserRegistered,
  joinGame,
  setFirst,
  getGameByInlineMessage,
  userNames,
  claimPlayer1,
  resign,
  commitMove,
  createPracticeGame,
  executeMove
} from '../db/index.js';
import { gameText, joinKeyboard, boardKeyboard, resultKeyboard, blueRedFor } from './ui.js';
import { Engine, toEngineState, fromEngineState } from '../engine/index.js';
import { enginePool } from '../index.js';
import { THEME } from '../theme.js';
import type { Player, Move, State } from '../types.js';

export function registerInline(bot: Bot) {
  bot.on('inline_query', async ctx => {
    const gameId = randomUUID();
    const botUser = process.env.PUBLIC_BOT_USERNAME || 'quoridorplay_bot';

    await ctx.answerInlineQuery([
      {
        type: 'article',
        id: `open:${gameId}`,
        title: '⚔️ Challenge a Friend to Quoridor 🚀',
        description: 'Send an open 8×8 Quoridor ELO challenge match',
        thumbnail_url: 'https://cdn-icons-png.flaticon.com/512/3074/3074058.png',
        input_message_content: {
          message_text: `🏰 <b>QUORIDOR ARENA CHALLENGE</b>\n\nTap below to join this rated match!\n<i>(Must have started @${botUser} first)</i>\n\n👥 <b>Players: 0/2</b>`,
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
    const botUser = (ctx.me?.username || process.env.PUBLIC_BOT_USERNAME || 'quoridorplay_bot').replace(/^@/, '');

    const registered = await isUserRegistered(ctx.from.id);
    if (!registered) {
      return ctx.answerCallbackQuery({
        url: `https://t.me/${botUser}?start=register`
      });
    }

    await upsertUser({ id: ctx.from.id, name: ctx.from.first_name, username: ctx.from.username, is_registered: true });
    const p1Name = ctx.from.first_name || ctx.from.username || 'Player 1';

    try {
      const g = await claimPlayer1(gameId, ctx.from.id, p1Name);
      await ctx.answerCallbackQuery({ text: '🚀 Joined as Player 1!' });

      const text = `🏰 <b>QUORIDOR ARENA CHALLENGE</b>\n\n🚀 <b>Player 1 (Top):</b> ${g.state.p1_name}\n<i>Waiting for Player 2 to join…</i>\n\n👥 <b>Players: 1/2</b>`;
      const kb = joinKeyboard(g.id, 'p2');

      const inlineId = ctx.inlineMessageId || ctx.callbackQuery?.inline_message_id;
      if (inlineId) {
        await ctx.api.editMessageTextInline(inlineId, text, {
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
        const text = `🏰 <b>QUORIDOR ARENA CHALLENGE</b>\n\n<i>Waiting for Player 2 to join…</i>\n\n👥 <b>Players: 1/2</b>`;
        const kb = joinKeyboard(gameId, 'p2');
        const inlineId = ctx.inlineMessageId || ctx.callbackQuery?.inline_message_id;
        if (inlineId) {
          await ctx.api.editMessageReplyMarkupInline(inlineId, { reply_markup: kb }).catch(() => {});
        }
      } else {
        await ctx.answerCallbackQuery({ text: 'Game already active or expired.', show_alert: true });
      }
    }
  });

  bot.callbackQuery(/^join_p2:(.+)$/, async ctx => {
    if (!ctx.from) return;
    const gameId = ctx.match[1];
    const botUser = (ctx.me?.username || process.env.PUBLIC_BOT_USERNAME || 'quoridorplay_bot').replace(/^@/, '');

    const registered = await isUserRegistered(ctx.from.id);
    if (!registered) {
      return ctx.answerCallbackQuery({
        url: `https://t.me/${botUser}?start=register`
      });
    }

    await upsertUser({ id: ctx.from.id, name: ctx.from.first_name, username: ctx.from.username, is_registered: true });
    const p2Name = ctx.from.first_name || ctx.from.username || 'Player 2';

    try {
      const activeGame = await joinGame(gameId, ctx.from.id, p2Name);
      await ctx.answerCallbackQuery({ text: '👾 Joined as Player 2! Match starting!' });

      const kb = boardKeyboard(activeGame, 'move', Number(activeGame.p1_id));
      const text = gameText(activeGame, 'move');

      const inlineId = ctx.inlineMessageId || ctx.callbackQuery?.inline_message_id;
      if (inlineId) {
        await ctx.api.editMessageTextInline(inlineId, text, {
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
    await upsertUser({ id: ctx.from.id, name: ctx.from.first_name, username: ctx.from.username, is_registered: true });
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
    const id = ctx.match[1];
    const gameId = id.replace(/^(pending|open):/, '');
    const g = await getGame(gameId);
    if (g && Number(g.p1_id) !== ctx.from?.id && !g.p2_id && ctx.from) {
      await upsertUser({ id: ctx.from.id, name: ctx.from.first_name, username: ctx.from.username, is_registered: true });
      const user = await getUser(ctx.from.id);
      const p2Name = `${ctx.from.first_name || ctx.from.username || 'Player 2'} (${user?.elo || 1200} ELO)`;
      try {
        const activeGame = await joinGame(g.id, ctx.from.id, p2Name);
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
    const res = await executeMove(gameId, Number(ctx.from.id), { type: 'move', dir }, (st, who, ms) => enginePool.think(st, who, ms, []));
    if (!res.ok) {
      return ctx.answerCallbackQuery({ text: res.error, show_alert: res.alert });
    }
    await ctx.answerCallbackQuery({ text: res.message });
    await editBoard(ctx, res.game);
  });

  bot.callbackQuery(/^g:([^:]+):(\d+):(move|wall|resign_confirm)$/, async ctx => {
    if (!ctx.from) return;
    const [, id, cellStr, mode] = ctx.match;
    const cell = Number(cellStr);
    const actualMode = mode === 'resign_confirm' ? 'move' : mode;
    const res = await executeMove(id, Number(ctx.from.id), { type: actualMode as any, cell, targetCell: cell }, (st, who, ms) => enginePool.think(st, who, ms, []));
    if (!res.ok) {
      return ctx.answerCallbackQuery({ text: res.error, show_alert: res.alert });
    }
    await ctx.answerCallbackQuery({ text: res.message });
    await editBoard(ctx, res.game);
  });

  bot.callbackQuery(/^do_resign:(.+)$/, async ctx => {
    if (!ctx.from) return;
    const gameId = ctx.match[1];
    try {
      const ng = await resign(gameId, Number(ctx.from.id));
      await ctx.answerCallbackQuery({ text: '🏳 You resigned.' });
      await editBoard(ctx, ng);
    } catch (e: any) {
      if (e.message === 'NOT_PLAYER') {
        await ctx.answerCallbackQuery({ text: '👁 Spectators cannot resign.', show_alert: true });
      } else {
        await ctx.answerCallbackQuery({ text: 'Game is no longer active.' });
      }
    }
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
  const text = gameText(g, mode);
  const kb = boardKeyboard(g, mode, activePlayerId);

  const inlineId = ctx.inlineMessageId || ctx.callbackQuery?.inline_message_id;
  if (inlineId) {
    await ctx.api.editMessageTextInline(inlineId, text, {
      parse_mode: 'HTML',
      reply_markup: kb
    }).catch(() => {});
  } else if (ctx.chat && ctx.msg) {
    await ctx.api.editMessageText(ctx.chat.id, ctx.msg.message_id, text, {
      parse_mode: 'HTML',
      reply_markup: kb
    }).catch(() => {});
  }
}
