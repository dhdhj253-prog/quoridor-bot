export type Player = 0 | 1;
export type Move = { t: 'm'; to: number; pv?: number } | { t: 'w'; c: number } | { t: 'p' };
export type GameStatus = 'pending' | 'active' | 'finished' | 'resigned' | 'forfeit';
export interface State {
  blocked: number[];
  pos: [number, number];
  walls: [number, number];
  turn: Player;
  over: -1 | 0 | 1;
  ply: number;
  lastMove?: { from?: number; to?: number; wall?: number };
  modeByPlayer?: { [id: string]: 'move' | 'wall' | 'resign_confirm' };
  p1_name?: string;
  p2_name?: string;
}
export interface GameRow {
  id: string; inline_message_id: string | null; chat_type: string;
  p1_id: string; p2_id: string | null; vs_bot: boolean; difficulty: string | null;
  state: State; status: GameStatus; winner: string | null; version: number;
  started_at: string | null; ended_at: string | null; last_move_at: string | null; replay_file_id: string | null;
}
