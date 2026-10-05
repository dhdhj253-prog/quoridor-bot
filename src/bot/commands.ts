import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { recentGames, createPracticeGame, userNames, upsertUser } from '../db/index.js';
import { boardKeyboard, gameText, resultKeyboard } from './ui.js';
import { botMovePractice } from './practice-runtime.js';
import { registerReplayHandlers, handleReplay, handleReview } from './replay-handlers.js';

export function registerCommands(bot: Bot) {
  bot.command('start', async ctx => {
    if (ctx.from) {
      await upsertUser({ id: ctx.from.id, name: ctx.from.first_name, username: ctx.from.username });
    }

    const rawPayload = (ctx.match || ctx.msg?.text?.split(/\s+/)[1] || '').trim();
    if (rawPayload.startsWith('replay_') || rawPayload.startsWith('replay-')) {
      const id = rawPayload.replace(/^replay[_-]/, '');
      await handleReplay(ctx, id, bot);
      return;
    }
    if (rawPayload.startsWith('review_') || rawPayload.startsWith('review-')) {
      const id = rawPayload.replace(/^review[_-]/, '');
      await handleReview(ctx, id, bot);
      return;
    }

    const kb = new InlineKeyboard()
      .switchInline('👥 Play with friends', '')
      .row()
      .text('🤖 Practice vs Bot', 'practice');

    await ctx.reply('♟ <b>Quoridor</b>\n\nPlay with friends inline or practice against the bot.', {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
  });

  bot.command('play', async ctx => {
    if (ctx.chat.type !== 'private') return ctx.reply('Open the bot in a DM and use /play.');
    if (!ctx.from) return;
    await upsertUser({ id: ctx.from.id, name: ctx.from.first_name, username: ctx.from.username });
    const g = await createPracticeGame(ctx.from.id);
    await ctx.reply(gameText(g), {
      parse_mode: 'HTML',
      reply_markup: boardKeyboard(g, 'move', ctx.from.id),
    });
  });

  bot.command(
    'rules',
    ctx =>
      ctx.reply(
        `♟ <b>Quoridor Rules</b>\n\n` +
        `• 8×8 Grid: 🚀 starts at row 1 (bottom), 🤖 starts at row 8 (top).\n` +
        `• Each player has <b>8 walls</b>.\n\n` +
        `🚶 <b>Move:</b> 1 step orthogonally (⬆️ ⬇️ ⬅️ ➡️).\n` +
        `🦘 <b>Straight Jump:</b> Jump over opponent if space behind is free.\n` +
        `↔️ <b>Bypass:</b> If a wall blocks the straight jump, jump diagonally to their sides.\n` +
        `🧱 <b>Wall:</b> Blocks paths. You can never completely seal off any player from reaching their goal.\n` +
        `🏁 <b>Win:</b> First pawn to reach the opposite row wins!`,
        { parse_mode: 'HTML' }
      )
  );

  bot.command(
    'help',
    ctx =>
      ctx.reply(
        `📖 <b>How to Play</b>\n\n` +
        `1. <b>Practice:</b> Send /play or tap "🤖 Practice vs Bot".\n` +
        `2. <b>Challenge Friends:</b> Type @${process.env.PUBLIC_BOT_USERNAME || 'quoridorplay_bot'} in any chat and tap the card.\n` +
        `3. <b>During Play:</b> Tap 🚶 Move for highlighted yellow dots 🟡, or tap 🧱 Wall and tap any empty tile to place a wall.\n` +
        `4. <b>Replays:</b> When a match finishes, tap 🎞 720p Replay to generate an MP4 video of the match!`,
        { parse_mode: 'HTML' }
      )
  );

  registerReplayHandlers(bot);

  bot.command('games', async ctx => {
    if (!ctx.from) return;
    const gs = await recentGames(ctx.from.id);
    if (!gs.length) return ctx.reply('No games found yet. Use /play to start one!');
    for (const g of gs) {
      const result = g.winner ? `🏆 Winner ${g.winner}` : g.status;
      await ctx.reply(`♟ Match <code>#${g.id.slice(0, 8)}</code> · ${result}`, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text('🎞 720p Replay', `replay:${g.id}`)
          .text('📖 Review', `review:${g.id}`),
      });
    }
  });
}
