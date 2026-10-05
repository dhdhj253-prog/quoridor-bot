import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { GameRow, State, Player, Move } from '../types.js';

let PoolClass = pg.Pool;
if (!process.env.DATABASE_URL) {
  try {
    const { newDb } = await import('pg-mem');
    const memDb = newDb();
    PoolClass = memDb.adapters.createPg().Pool as any;
  } catch {}
}

export const pool = new PoolClass(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});

export async function migrate() {
  const fs = await import('node:fs/promises');
  const sql = await fs.readFile(new URL('../../migrations/001_init.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

export async function upsertUser(u: { id: number; name: string; username?: string }) {
  await pool.query(`INSERT INTO users(tg_id,name,username) VALUES($1,$2,$3)
    ON CONFLICT(tg_id) DO UPDATE SET name=EXCLUDED.name, username=EXCLUDED.username`, [u.id, u.name, u.username ?? null]);
}

export function initialState(first: Player = 0): State {
  return { blocked: Array(64).fill(0), pos: [60, 3], walls: [8, 8], turn: first, over: -1, ply: 0 };
}

export async function createGame(p1: number, opts: { chatType: string; inlineMessageId?: string | null; vsBot?: boolean; difficulty?: string; first?: Player }) {
  await upsertUser({ id: p1, name: 'Player' });
  const id = randomUUID();
  const state = initialState(opts.first ?? 0);
  const q = await pool.query<GameRow>(`INSERT INTO games(id,inline_message_id,chat_type,p1_id,vs_bot,difficulty,state,status,started_at,last_move_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,'pending',NULL,NULL) RETURNING *`,
    [id, opts.inlineMessageId ?? null, opts.chatType, p1, opts.vsBot ?? false, opts.difficulty ?? null, JSON.stringify(state)]);
  return q.rows[0];
}

export async function userNames(ids:number[]){ const q=await pool.query('SELECT tg_id,name,username FROM users WHERE tg_id=ANY($1::bigint[])',[ids]); return new Map(q.rows.map(r=>[String(r.tg_id),r.name || r.username || 'Player'])); }

export async function createPracticeGame(p1:number, p1Name: string = 'You'){ const botId=-1; await upsertUser({id:botId,name:'Quoridor Bot'}); await upsertUser({id:p1,name:p1Name}); return createGame(p1,{chatType:'private',vsBot:true,difficulty:'mid',first:0}).then(async g=>{ const c=await pool.query<GameRow>(`UPDATE games SET p2_id=$2,status='active',started_at=now(),last_move_at=now(),state=$3 WHERE id=$1 RETURNING *`,[g.id,botId,JSON.stringify({...g.state,blue_id:p1,first:0,p1_name:p1Name,p2_name:'Bot'})]); return c.rows[0]; }); }

export async function getGame(id: string) {
  const q = await pool.query<GameRow>('SELECT * FROM games WHERE id=$1', [id]);
  return q.rows[0] ?? null;
}
export async function getGameByInlineMessage(inlineId: string) {
  const q = await pool.query<GameRow>('SELECT * FROM games WHERE inline_message_id=$1', [inlineId]);
  return q.rows[0] ?? null;
}
export async function setInlineMessage(id: string, inlineId: string) {
  await pool.query('UPDATE games SET inline_message_id=$2 WHERE id=$1', [id, inlineId]);
}

export async function claimPlayer1(id: string, player1Id: number, player1Name: string) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const q = await c.query<GameRow>('SELECT * FROM games WHERE id=$1 FOR UPDATE', [id]);
    let g = q.rows[0];
    if (!g) {
      // If record not created yet, create it atomically
      const state = { ...initialState(0), p1_name: player1Name };
      const q2 = await c.query<GameRow>(
        `INSERT INTO games(id, chat_type, status, vs_bot, p1_id, state)
         VALUES($1, 'inline', 'pending', false, $2, $3)
         RETURNING *`,
        [id, player1Id, JSON.stringify(state)]
      );
      await c.query('COMMIT');
      return q2.rows[0];
    }
    if (g.status !== 'pending') throw new Error('GAME_STARTED');
    if (g.p1_id && Number(g.p1_id) === player1Id) {
      // Already claimed by this same user
      await c.query('COMMIT');
      return g;
    }
    if (g.p1_id && Number(g.p1_id) !== player1Id) {
      throw new Error('P1_ALREADY_CLAIMED');
    }
    const state = { ...(g.state || initialState(0)), p1_name: player1Name };
    const r = await c.query<GameRow>(
      `UPDATE games SET p1_id=$2, state=$3 WHERE id=$1 RETURNING *`,
      [id, player1Id, JSON.stringify(state)]
    );
    await c.query('COMMIT');
    return r.rows[0];
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

export async function joinGame(id: string, opponent: number, opponentName: string = 'Player 2') {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const q = await c.query<GameRow>('SELECT * FROM games WHERE id=$1 FOR UPDATE', [id]);
    const g = q.rows[0];
    if (!g) throw new Error('GAME_NOT_FOUND');
    if (g.status !== 'pending' || g.p2_id) throw new Error('GAME_STARTED');
    if (Number(g.p1_id) === opponent) throw new Error('CREATOR_CANNOT_JOIN');
    const state = { ...(g.state || initialState(0)), p2_name: opponentName };
    const r = await c.query<GameRow>(
      `UPDATE games SET p2_id=$2, status='active', started_at=now(), last_move_at=now(), state=$3, version=version+1 WHERE id=$1 AND p2_id IS NULL RETURNING *`,
      [id, opponent, JSON.stringify(state)]
    );
    if (!r.rows[0]) throw new Error('ALREADY_JOINED');
    await c.query('COMMIT');
    return r.rows[0];
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

export async function setFirst(id: string, requester: number, blueId: number, first: Player) {
  const c=await pool.connect();
  try{ await c.query('BEGIN'); const q=await c.query<GameRow>('SELECT * FROM games WHERE id=$1 FOR UPDATE',[id]); const g=q.rows[0];
    if(!g||Number(g.p1_id)!==requester||!g.p2_id) throw new Error('NOT_CREATOR');
    if(g.status!=='active') throw new Error('NOT_ACTIVE');
    const redId=Number(g.p1_id)===blueId?Number(g.p2_id):Number(g.p1_id);
    const st={...g.state,pos:[60, 3] as [number,number],turn:first,over:-1,ply:0,blocked:Array(64).fill(0),walls:[8,8] as [number,number]};
    const r=await c.query<GameRow>(`UPDATE games SET state=$2,version=version+1,last_move_at=now() WHERE id=$1 RETURNING *`,[id,JSON.stringify(st)]); await c.query('COMMIT'); return r.rows[0];
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}

export async function commitMove(id: string, actor: number, expectedVersion: number, state: State, move: Move, status: string, winner: number|null, botMove?: Move|null) {
  const c=await pool.connect();
  try{await c.query('BEGIN');
    const q=await c.query<GameRow>('SELECT * FROM games WHERE id=$1 FOR UPDATE',[id]); const g=q.rows[0];
    if(!g||g.version!==expectedVersion) throw new Error('STALE');
    if(Number(g.p1_id)!==actor && Number(g.p2_id)!==actor) throw new Error('NOT_PLAYER');

    // Human move:
    const from=move.t==='m'?(move.pv ?? null):null, to=move.t==='m'?move.to:null, wall=move.t==='w'?move.c:null;
    const humanPly = botMove ? state.ply - 1 : state.ply;
    await c.query(`INSERT INTO moves(game_id,ply,who,type,from_cell,to_cell,wall_cell) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,humanPly,actor,move.t,from,to,wall]);

    // Bot move (if any):
    if (botMove) {
      const bFrom = botMove.t === 'm' ? (botMove.pv ?? null) : null;
      const bTo = botMove.t === 'm' ? botMove.to : null;
      const bWall = botMove.t === 'w' ? botMove.c : null;
      const botId = Number(g.p2_id || -1);
      await c.query(`INSERT INTO moves(game_id,ply,who,type,from_cell,to_cell,wall_cell) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,state.ply,botId,botMove.t,bFrom,bTo,bWall]);
    }

    const winnerDb=winner===null?null:(winner===0?Number(g.p1_id):Number(g.p2_id));
    const r=await c.query<GameRow>(`UPDATE games SET state=$2,status=$3,winner=$4,version=version+1,last_move_at=now(),ended_at=CASE WHEN $3 IN ('finished','resigned','forfeit') THEN now() ELSE ended_at END WHERE id=$1 AND version=$5 RETURNING *`,[id,JSON.stringify(state),status,winnerDb,expectedVersion]);
    if(!r.rows[0]) throw new Error('STALE'); await c.query('COMMIT'); return r.rows[0];
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}

export async function resign(id:string, actor:number){
 const c=await pool.connect(); try{await c.query('BEGIN');const q=await c.query<GameRow>('SELECT * FROM games WHERE id=$1 FOR UPDATE',[id]);const g=q.rows[0];if(!g)throw new Error('GAME_NOT_FOUND');if(Number(g.p1_id)!==actor&&Number(g.p2_id)!==actor)throw new Error('NOT_PLAYER');if(g.status!=='active')throw new Error('NOT_ACTIVE');const winner=Number(g.p1_id)===actor?Number(g.p2_id):Number(g.p1_id);const r=await c.query<GameRow>(`UPDATE games SET status='resigned',winner=$2,ended_at=now(),version=version+1 WHERE id=$1 RETURNING *`,[id,winner]);await c.query('COMMIT');return r.rows[0]}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}

export async function forfeitExpiredGames(){
 const q=await pool.query<GameRow>(`SELECT * FROM games WHERE status='active' AND last_move_at < now()-interval '24 hours'`);
 for(const g of q.rows){if(!g.p2_id)continue;const winner=Number(g.p1_id)===Number(g.state.turn===0?g.p1_id:g.p2_id)?(g.state.turn===0?Number(g.p2_id):Number(g.p1_id)):(g.state.turn===0?Number(g.p2_id):Number(g.p1_id));await pool.query(`UPDATE games SET status='forfeit',winner=$2,ended_at=now(),version=version+1 WHERE id=$1 AND status='active'`,[g.id,winner])}
}

export async function recentGames(userId:number){const q=await pool.query<GameRow>(`SELECT * FROM games WHERE p1_id=$1 OR p2_id=$1 ORDER BY started_at DESC NULLS LAST LIMIT 10`,[userId]);return q.rows}
export async function gameMoves(id:string){const q=await pool.query(`SELECT * FROM moves WHERE game_id=$1 ORDER BY ply`,[id]);return q.rows}
export async function cacheReplay(id:string,fileId:string){await pool.query('UPDATE games SET replay_file_id=$2 WHERE id=$1',[id,fileId])}
