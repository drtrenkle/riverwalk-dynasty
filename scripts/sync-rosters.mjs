// Pulls all rosters for the Riverwalk Dynasty league from ESPN's private
// fantasy football API and writes them to data/rosters.json.
//
// Requires two environment variables, set as GitHub Actions secrets:
//   ESPN_S2   — the espn_s2 cookie value
//   ESPN_SWID — the SWID cookie value, including the {curly braces}
//
// Run with: node scripts/sync-rosters.mjs

import { writeFile, mkdir } from 'node:fs/promises';

const LEAGUE_ID = '702216609';
const SEASON = 2026;

const { ESPN_S2, ESPN_SWID } = process.env;
if (!ESPN_S2 || !ESPN_SWID) {
  console.error('Missing ESPN_S2 or ESPN_SWID environment variables.');
  process.exit(1);
}

// ESPN's lineup-slot IDs (which slot a roster entry currently occupies).
// This table is the standard mapping used across the fantasy-football
// developer community — double check labels against real output after
// the first run, in case this league customized anything unusual.
const LINEUP_SLOT_MAP = {
  0:'QB', 2:'RB', 3:'RB/WR', 4:'WR', 5:'WR/TE', 6:'TE', 7:'OP',
  16:'D/ST', 17:'K', 20:'Bench', 21:'IR', 23:'FLEX',
};

// A player's natural position (used for bench/IR rows, which don't have
// a meaningful "slot" beyond Bench/IR itself).
const POSITION_MAP = { 1:'QB', 2:'RB', 3:'WR', 4:'TE', 5:'K', 16:'D/ST' };

const PRO_TEAM_MAP = {
  0:'FA', 1:'ATL', 2:'BUF', 3:'CHI', 4:'CIN', 5:'CLE', 6:'DAL', 7:'DEN',
  8:'DET', 9:'GB', 10:'TEN', 11:'IND', 12:'KC', 13:'LV', 14:'LAR', 15:'MIA',
  16:'MIN', 17:'NE', 18:'NO', 19:'NYG', 20:'NYJ', 21:'PHI', 22:'ARI',
  23:'PIT', 24:'LAC', 25:'SF', 26:'SEA', 27:'TB', 28:'WSH', 29:'CAR',
  30:'JAX', 33:'BAL', 34:'HOU',
};

async function fetchLeague(){
  const url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}?view=mRoster&view=mTeam`;
  const res = await fetch(url, {
    headers: {
      Cookie: `espn_s2=${ESPN_S2}; SWID=${ESPN_SWID}`,
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`ESPN request failed: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
  }
  if (!text) {
    throw new Error('ESPN returned an empty response body. Usually means the espn_s2/SWID cookies are invalid, expired, or belong to an account without access to this league.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`ESPN's response wasn't valid JSON (status ${res.status}). First 300 chars: ${text.slice(0, 300)}`);
  }
}

function ownerName(league, memberIds){
  if (!memberIds || !memberIds.length) return 'Unknown';
  const id = memberIds[0];
  const member = (league.members || []).find(m => m.id === id);
  return member ? `${member.firstName} ${member.lastName}` : 'Unknown';
}

function buildTeam(league, team){
  const starters = [], bench = [], ir = [];

  (team.roster?.entries || []).forEach(entry => {
    const player = entry.playerPoolEntry?.player;
    if (!player) return;
    const nfl = PRO_TEAM_MAP[player.proTeamId] || '—';
    const slotLabel = LINEUP_SLOT_MAP[entry.lineupSlotId] || `Slot ${entry.lineupSlotId}`;
    const posLabel = POSITION_MAP[player.defaultPositionId] || slotLabel;

    if (entry.lineupSlotId === 20) {
      bench.push({ slot: posLabel, player: player.fullName, nfl });
    } else if (entry.lineupSlotId === 21) {
      ir.push({ slot: posLabel, player: player.fullName, nfl });
    } else {
      starters.push({ slot: slotLabel, player: player.fullName, nfl });
    }
  });

  const name = team.name || `${team.location || ''} ${team.nickname || ''}`.trim();

  return {
    espnTeamId: team.id,
    name,
    owner: ownerName(league, team.owners),
    starters, bench, ir,
  };
}

async function main(){
  const league = await fetchLeague();
  const teams = (league.teams || [])
    .map(t => buildTeam(league, t))
    .sort((a, b) => a.espnTeamId - b.espnTeamId);

  const output = {
    generatedAt: new Date().toISOString(),
    leagueId: LEAGUE_ID,
    season: SEASON,
    teams,
  };

  await mkdir('data', { recursive: true });
  await writeFile('data/rosters.json', JSON.stringify(output, null, 2));
  console.log(`Wrote data/rosters.json with ${teams.length} teams.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
