import sharp from 'sharp';
import { getEloGradient, getProgressToNextTier } from '../engine/elo.js';

export interface UserProfileData {
  name: string;
  username?: string | null;
  elo: number;
  peakElo: number;
  wins: number;
  losses: number;
  currentStreak: number;
  bestStreak: number;
}

export function generateProfileSvg(user: UserProfileData): string {
  const gradient = getEloGradient(user.elo);
  const progress = getProgressToNextTier(user.elo);
  const totalGames = user.wins + user.losses;
  const winRate = totalGames > 0 ? ((user.wins / totalGames) * 100).toFixed(1) : '0.0';

  const stops = gradient.colors.map((c, i) => {
    const offset = Math.round((i / (gradient.colors.length - 1)) * 100);
    return `<stop offset="${offset}%" stop-color="${c}" />`;
  }).join('\n      ');

  const displayName = (user.name || user.username || 'Player')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const displayHandle = user.username ? `@${user.username}` : 'Quoridor Duelist';

  const streakText = user.currentStreak > 0
    ? `🔥 ${user.currentStreak} Win Streak`
    : user.bestStreak > 0
      ? `Best Streak: ${user.bestStreak}`
      : 'No streak yet';

  const progressBarWidth = 740;
  const fillWidth = Math.max(12, Math.round((progress.percent / 100) * progressBarWidth));

  return `<svg width="860" height="480" viewBox="0 0 860 480" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="tierGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      ${stops}
    </linearGradient>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#12141c" />
      <stop offset="50%" stop-color="#0e1017" />
      <stop offset="100%" stop-color="#08090d" />
    </linearGradient>
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1a1d29" stop-opacity="0.85" />
      <stop offset="100%" stop-color="#12141e" stop-opacity="0.95" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="16" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Background Canvas -->
  <rect width="860" height="480" rx="28" fill="url(#bgGrad)" />
  <rect width="860" height="480" rx="28" fill="none" stroke="#262a3b" stroke-width="2" />

  <!-- Ambient Glow Background Accent -->
  <circle cx="720" cy="110" r="140" fill="${gradient.glow}" opacity="0.14" filter="url(#glow)" />
  <circle cx="100" cy="400" r="120" fill="${gradient.glow}" opacity="0.08" filter="url(#glow)" />

  <!-- Inner Glass Container -->
  <rect x="30" y="30" width="800" height="420" rx="22" fill="url(#cardGrad)" stroke="rgba(255,255,255,0.07)" stroke-width="1.5" />

  <!-- Header: Avatar & Name -->
  <g transform="translate(60, 65)">
    <!-- Avatar circle placeholder -->
    <rect x="0" y="0" width="68" height="68" rx="20" fill="#202436" stroke="url(#tierGrad)" stroke-width="2.5" />
    <text x="34" y="44" font-family="'Segoe UI', Roboto, sans-serif" font-size="28" fill="#ffffff" text-anchor="middle">♟️</text>

    <!-- Player Name & Handle -->
    <text x="86" y="28" font-family="'Segoe UI', Roboto, sans-serif" font-size="26" font-weight="700" fill="#ffffff">${displayName}</text>
    <text x="86" y="54" font-family="'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="500" fill="#8e9bb0">${displayHandle}</text>
  </g>

  <!-- ELO Score Display Box -->
  <g transform="translate(560, 65)">
    <rect x="0" y="0" width="210" height="74" rx="16" fill="${gradient.badgeBg}" stroke="url(#tierGrad)" stroke-width="2" />
    <text x="105" y="46" font-family="'Segoe UI', Roboto, sans-serif" font-size="34" font-weight="800" fill="url(#tierGrad)" text-anchor="middle" filter="drop-shadow(0 2px 8px ${gradient.glow})">${user.elo} <tspan font-size="18" font-weight="600" fill="#a0aec0">ELO</tspan></text>
  </g>

  <!-- Progress Bar to Next 200 ELO Bracket -->
  <g transform="translate(60, 165)">
    <text x="0" y="0" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600" fill="#a0aec0" letter-spacing="0.5">PROGRESS TO ${progress.nextTarget} ELO</text>
    <text x="${progressBarWidth}" y="0" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="700" fill="url(#tierGrad)" text-anchor="end">${progress.currentInTier} / 200 (${progress.percent}%)</text>
    
    <!-- Track -->
    <rect x="0" y="12" width="${progressBarWidth}" height="14" rx="7" fill="#181a24" stroke="#2a2e42" stroke-width="1" />
    <!-- Fill -->
    <rect x="0" y="12" width="${fillWidth}" height="14" rx="7" fill="url(#tierGrad)" />
  </g>

  <!-- Stats Grid (4 Cards) -->
  <g transform="translate(60, 240)">
    <!-- Card 1: Matches -->
    <g transform="translate(0, 0)">
      <rect width="170" height="150" rx="16" fill="#141622" stroke="#222638" stroke-width="1" />
      <text x="20" y="36" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600" fill="#718096">GAMES</text>
      <text x="20" y="78" font-family="'Segoe UI', Roboto, sans-serif" font-size="30" font-weight="700" fill="#ffffff">${totalGames}</text>
      <text x="20" y="112" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600" fill="#48bb78">${user.wins}W <tspan fill="#718096">·</tspan> <tspan fill="#f56565">${user.losses}L</tspan></text>
    </g>

    <!-- Card 2: Winrate -->
    <g transform="translate(190, 0)">
      <rect width="170" height="150" rx="16" fill="#141622" stroke="#222638" stroke-width="1" />
      <text x="20" y="36" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600" fill="#718096">WIN RATE</text>
      <text x="20" y="78" font-family="'Segoe UI', Roboto, sans-serif" font-size="30" font-weight="700" fill="url(#tierGrad)">${winRate}%</text>
      <text x="20" y="112" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="500" fill="#8e9bb0">Competitve</text>
    </g>

    <!-- Card 3: Streak -->
    <g transform="translate(380, 0)">
      <rect width="170" height="150" rx="16" fill="#141622" stroke="#222638" stroke-width="1" />
      <text x="20" y="36" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600" fill="#718096">FORM</text>
      <text x="20" y="78" font-family="'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="700" fill="#ffffff">${streakText}</text>
      <text x="20" y="112" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="500" fill="#ed8936">Peak: ${user.bestStreak} Wins</text>
    </g>

    <!-- Card 4: Peak ELO -->
    <g transform="translate(570, 0)">
      <rect width="170" height="150" rx="16" fill="#141622" stroke="#222638" stroke-width="1" />
      <text x="20" y="36" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600" fill="#718096">PEAK ELO</text>
      <text x="20" y="78" font-family="'Segoe UI', Roboto, sans-serif" font-size="30" font-weight="700" fill="#ffffff">${user.peakElo}</text>
      <text x="20" y="112" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="500" fill="#8e9bb0">All-time high</text>
    </g>
  </g>
</svg>`;
}

export async function renderProfileCard(user: UserProfileData): Promise<Buffer> {
  const svg = generateProfileSvg(user);
  return sharp(Buffer.from(svg)).png().toBuffer();
}
