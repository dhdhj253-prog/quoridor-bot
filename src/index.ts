import 'dotenv/config';
import { Bot, webhookCallback } from 'grammy';
import pino from 'pino';
import { migrate, pool, forfeitExpiredGames } from './db/index.js';
import { registerCommands } from './bot/commands.js';
import { registerInline } from './bot/inline.js';
import { EnginePool } from './workers/pool.js';

export const logger=pino({level:process.env.LOG_LEVEL||'info'});
export const enginePool=new EnginePool(Number(process.env.WORKER_POOL_SIZE||3));
const token=process.env.BOT_TOKEN; if(!token)throw new Error('BOT_TOKEN is required');
const bot=new Bot(token);
registerCommands(bot);registerInline(bot);
bot.catch(err=>logger.error({err},'bot error'));

await migrate();
await bot.api.setMyCommands([{command:'start',description:'Start Quoridor'},{command:'rules',description:'Game rules'},{command:'help',description:'How to play'},{command:'games',description:'Recent games'}]);
setInterval(()=>void forfeitExpiredGames().catch(e=>logger.error({err:e},'forfeit sweep')),60_000);

const port = Number(process.env.PORT || 3000);
if (process.env.WEBHOOK_URL) {
  const server = await import('node:http');
  const handler = webhookCallback(bot, 'http');
  const s = server.createServer((req, res) => handler(req, res));
  s.listen(port, () => logger.info({ port }, 'webhook server listening'));
  await bot.api.setWebhook(process.env.WEBHOOK_URL, { secret_token: process.env.WEBHOOK_SECRET });
} else {
  // Lightweight HTTP health check listener for Render / cloud platforms:
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Quoridor Bot is Running 24/7');
  });
  server.listen(port, () => logger.info({ port }, 'health check server listening'));
  await bot.start({ onStart: () => logger.info('long polling started') });
}

const shutdown=async()=>{logger.info('shutting down');await enginePool.close();await bot.stop();await pool.end();process.exit(0)};
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
