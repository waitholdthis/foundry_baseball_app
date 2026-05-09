# Foundry — Product Design Blueprint & Feature Roadmap

> Version 1.0 | Generated 2026-05-08

---

## 1. App Name & Brand Identity

### Name: **Foundry**

**Tagline:** *Where Championships Are Built*

**Brand Vibe:**
Foundry is a dark, precision-engineered command center. The name evokes a place where raw material is forged into something superior — the dugout as a forge, data as the fire, the coach as the craftsman. Every screen communicates control, confidence, and competence.

The aesthetic is deliberately **anti-consumer**. No pastels. No rounded toy buttons. Foundry looks like the cockpit of a performance vehicle: dark surfaces, surgical typography, amber and electric-green accent hits that glow against deep navy. It should feel powerful the moment you unlock the screen.

**Brand Pillars:**
- **Command** — Every decision is one tap away. No buried menus.
- **Clarity** — Outdoor readability is non-negotiable. High contrast everywhere.
- **Continuity** — Lineup, score, and audio share one brain. Change one, the others respond.

### Design Tokens

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#020617` | App background (near-black navy) |
| `--bg-surface` | `#0E1223` | Cards, panels, scorecard cells |
| `--bg-elevated` | `#1B2336` | Modals, drawers, active states |
| `--border` | `#334155` | Dividers, cell borders |
| `--text-primary` | `#F8FAFC` | All primary labels |
| `--text-secondary` | `#94A3B8` | Metadata, helper text |
| `--accent-amber` | `#F59E0B` | At Bat indicator, active tab, CTA buttons |
| `--accent-green` | `#22C55E` | Hits, OBP, on-base events |
| `--accent-red` | `#EF4444` | Outs, errors, ERA warnings |
| `--accent-blue` | `#3B82F6` | On Deck indicator, links |
| `--accent-purple` | `#A855F7` | DJ / Audio module accent |
| `--shadow-glow-amber` | `0 0 12px rgba(245,158,11,0.4)` | At Bat player card glow |

**Typography:**
- **All text:** Inter (variable, 300–700 weight)
- **Scorecard numerals:** Inter Tabular (`font-variant-numeric: tabular-nums`) — prevents column-width jitter as counts change
- **Minimum body size:** 16px
- **At-Bat player name:** 28px / 700 weight — legible from arm's length

**Icon System:** Lucide React Native — 2px stroke weight, consistent across all modules. No emoji as icons, ever.

**Touch Targets:** All interactive elements minimum **56×56pt** (exceeds Apple's 44pt standard to account for gloved hands and dugout vibration). 12pt minimum gap between adjacent targets.

---

## 2. User Journey Map

### Phase 0: First Launch / Roster Setup (One-Time)
```
Download App
    └─> Create Team Profile (Name, Sport: Baseball / Softball, Level)
            └─> Import Roster
                    ├─> Manual entry (Name, Number, Position, Bats/Throws)
                    └─> Import from CSV
                            └─> Assign Walk-Up Songs per Player
                                    ├─> Link Spotify / Apple Music track
                                    ├─> Upload local MP3
                                    └─> Record custom voice intro
                                            └─> [ROSTER COMPLETE — Home Screen]
```

---

### Phase 1: Pre-Game (Lineup Builder)

```
Home Screen
    └─> [+ New Game] button
            └─> Game Setup Modal
                    ├─> Opponent name
                    ├─> Date / Location
                    ├─> Home or Away (determines batting order slot)
                    └─> Ruleset: OBR / High School / Softball ASA / USA Softball
                            └─> LINEUP BUILDER SCREEN
                                    ├─> Drag-and-drop batting order (1–9, or 10 with DP/Flex)
                                    ├─> Tap player → assign starting position (defensive map overlay)
                                    ├─> Auto-validation warns: duplicate positions, missing spots
                                    └─> [Lock Lineup & Start Game] ──────────────────────────────┐
```

---

### Phase 2: In-Game (The Command Center — primary screen)

```
GAME DAY SCREEN (3-panel layout)
│
├─── LEFT RAIL: Live Lineup Strip
│       Current batter highlighted (amber glow)
│       Next batter shown (blue)
│       Tap any player → quick substitution sheet
│
├─── CENTER: Scorebook / Play Recorder
│       Current half-inning cell is active
│       Diamond graphic → tap bases to advance runners
│       Bottom action strip: BB | K | 1B | 2B | 3B | HR | OUT | FC | E
│       Running score header always visible
│
└─── RIGHT RAIL: DJ Console
        Now Playing: [Player Name walk-up song]
        ├─> Plays automatically when batter steps to plate
        ├─> [Skip] [Fade Out] [Replay]
        ├─> On Deck queued (faded, 15s preview autoplay option)
        ├─> Quick-fire pad: [Crowd Roar] [Organ] [Airhorn] [Walk-Off]
        └─> [Between Innings] playlist auto-starts on 3rd out
```

---

### Phase 3: Substitution Events
```
Tap player in lineup rail
    └─> Substitution Sheet slides up
            ├─> Available bench players listed
            ├─> Softball: DP/Flex swap, Re-entry eligibility shown
            ├─> New player's walk-up song auto-assigned from roster
            └─> Scorebook records substitution with inning/out state
```

---

### Phase 4: Post-Game

```
3rd Out / Final Out → End Game Prompt
    └─> GAME SUMMARY SCREEN
            ├─> Box Score (auto-generated)
            ├─> Individual Hitting Lines (AB/R/H/RBI/BB/K)
            ├─> Pitching Lines (if tracked)
            ├─> Spray Chart per batter
            ├─> Season Stats updated automatically
            ├─> Share Box Score (PNG export / iMessage / AirDrop)
            └─> Export to CSV / PDF Scorebook
```

---

## 3. Core Feature Breakdown

### Module 1: The Digital Command Center (Lineups & Rosters)

**Roster Management**
- Unlimited roster size; active/inactive toggle per game
- Player profile: name, number, position(s), bats/throws, photo
- Bulk import via CSV with column-mapping wizard
- Season-to-season roster continuity; graduated/transferred flags

**Lineup Builder**
- Drag-and-drop batting order with haptic snap feedback (150ms)
- Position assignment via interactive defensive field diagram
- Softball-specific: DP/Flex dual-slot with swap logic that enforces ASA/USA rules
- Re-entry tracking: highlights players eligible per ruleset
- Auto-warns: illegal batting orders, duplicate defensive positions, illegal substitutions
- Save lineup as template ("Default Lineup", "Power Lineup") for reuse
- Printable lineup card export (PDF, formatted for dugout clipboard)

**In-Game Roster Management**
- One-tap substitution — shows eligibility status before confirming
- Pinch runner designation with original batter tracking
- Pitcher pitch count gate: configurable limit with automatic warning at 75% threshold
- Defensive shifts: record non-standard positioning per batter (notes field)

---

### Module 2: The Pro-Grade Scorebook

**Play Recording Interface**
- Active batter's diamond cell is the full-screen focal point
- One-tap plate appearance outcomes: `BB` `K` `K_looking` `HBP` `1B` `2B` `3B` `HR` `E` `FC` `SAC` `DP`
- Tap base runners on diamond to advance/tag/score them
- Long-press any outcome for sub-type (K swinging vs. looking, error on which fielder)
- Undo last action with shake gesture or dedicated button (always visible)

**Pitch Tracking (Optional Mode)**
- Toggle per-game; adds pitch-by-pitch recording layer
- Ball/Strike/Foul with location zone (3×3 strike zone grid)
- Auto-calculates: pitch count, first-pitch strikes %, strikeout rate

**Live Stats (always calculating in background)**
- Hitting: AVG, OBP, SLG, OPS, RBI, K%, BB%
- Pitching: IP, ERA, WHIP, K/9, BB/9, pitch count
- Team: Runs per inning, LOB, E total
- Stats update instantly after each tap — no manual refresh

**Scorebook View**
- Traditional grid view: rows = players, columns = innings, cells = diamond symbols
- Pinch-to-zoom on scorebook grid for detailed review
- Color-coded cells: green (on-base result), red (out), gold (RBI), gray (not yet batted)

**Automated Outputs**
- Box score: generated after every half-inning, shareable immediately
- Spray chart: batted ball locations plotted on field diagram (tap to mark location after each hit)
- Season aggregate stats: app aggregates across all saved games

**Offline Reliability**
- All play data written to local SQLite database first; sync is secondary
- Full scorebook functionality with zero internet connection
- Background sync when connectivity returns (no manual trigger required)

---

### Module 3: The Ballpark DJ (Audio Integration)

**Walk-Up Song Engine**
- Walk-up song auto-triggers when a player's cell becomes "At Bat" in the scorebook
- Crossfade logic: previous ambient track fades out over 1.5 seconds as walk-up fades in
- Song plays from configurable start point (user sets the "drop" — default 0:00)
- Auto-fade after configurable duration (default: 30 seconds) or manual override
- "On Deck" preview: 15 seconds of next batter's song plays softly during current at-bat (togglable)

**Audio Source Options**
- **Spotify Integration:** OAuth login, search any track, save to player profile. Playback requires Spotify Premium (app surfaces upgrade prompt if not Premium). Uses Spotify SDK for background audio continuity.
- **Apple Music Integration:** MusicKit framework, same search/save flow. Requires Apple Music subscription.
- **Local MP3/M4A Upload:** iCloud Drive / Files app picker. Stored on-device for 100% offline use.
- **Recorded Voice Intros:** In-app microphone recording (max 60 seconds). Plays before or after the song. Stored locally.

**Licensing Compliance**
- The app does not host or cache licensed music. Spotify/Apple Music tracks stream via their licensed SDKs.
- Local file upload is user's responsibility; app presents one-time acknowledgment on first upload.
- Public performance licensing (ASCAP/BMI/SESAC) is the venue's responsibility — app links to guidance on first launch.

**SuperVoice / Announcer Mode**
- Text-to-speech announcement engine using on-device TTS (AVSpeechSynthesizer / Android TTS)
- Customizable announcement template: *"Now batting, number [#], [First Name] [Last Name]"*
- User can record their own announcer voice per player instead of TTS
- Voice plays through connected speaker/PA system via Bluetooth or aux

**DJ Console Controls**
- **Between Innings Playlist:** configure 2–5 songs per playlist slot; shuffles automatically on 3rd out
- **Situational Soundboard:** large-format buttons (80×80pt minimum) for instant triggers
  - Crowd Roar, Air Horn, Walk-Off Music, Rally, Organ Charge, Strike 'Em Out Riff, Victory Song
- **Master Volume:** prominent slider always visible in DJ rail, independent of device volume
- **Bluetooth Speaker Management:** remembers last 3 connected devices; one-tap reconnect

---

## 4. UI/UX Wireframe Concept

### The Game Day Screen — Layout Anatomy

The primary in-game screen is a **three-column layout** designed for a tablet (iPad, Samsung Galaxy Tab) but gracefully degrades to a bottom-tab architecture on phone screens.

```
┌─────────────────────────────────────────────────────────────────────┐
│  FOUNDRY          ◀  TOP 3  ▶         VISITORS 4   HOME 2    ••••  │  ← Status Bar
│                                                                      │    (Score always visible)
├────────────┬──────────────────────────────────┬─────────────────────┤
│            │                                  │                     │
│  LINEUP    │         SCOREBOOK                │    DJ CONSOLE       │
│  RAIL      │         CENTER                   │    RAIL             │
│            │                                  │                     │
│ ┌────────┐ │  ┌────────────────────────────┐  │  ┌───────────────┐  │
│ │ 7  ▶▶  │ │  │  JOHNSON — At Bat  🔶     │  │  │ NOW PLAYING   │  │
│ │JOHNSON │ │  │  Count: 1-2                │  │  │ "Eye of Tiger"│  │
│ │  CF    │ │  │                            │  │  │ ████████░░░░  │  │
│ │ [AMBER]│ │  │     ⬡ (diamond)           │  │  │ ⏮  ‖  ⏭      │  │
│ └────────┘ │  │    ○──────○               │  │  └───────────────┘  │
│            │  │    │      │               │  │                     │
│ ┌────────┐ │  │    ○      ○               │  │  ┌───────────────┐  │
│ │ 3      │ │  └────────────────────────────┘  │  │  ON DECK      │  │
│ │RAMIREZ │ │                                  │  │  RAMIREZ      │  │
│ │  2B    │ │  ┌────────────────────────────┐  │  │  "Welcome..."  │  │
│ │ [BLUE] │ │  │  BB │ K │ 1B │ 2B │ 3B │HR│  │  └───────────────┘  │
│ └────────┘ │  │ OUT │ FC │ E  │SAC │ DP │  │  │                     │
│            │  └────────────────────────────┘  │  SOUNDBOARD         │
│ ┌────────┐ │                                  │  ┌────┐ ┌────┐      │
│ │ 5      │ │  ← Big action buttons            │  │ 📢 │ │ 📯 │      │
│ │CHEN    │ │    Minimum 72×72pt               │  │Roar│ │Horn│      │
│ │  SS    │ │    High contrast labels          │  └────┘ └────┘      │
│ └────────┘ │    Amber glow on active          │  ┌────┐ ┌────┐      │
│            │                                  │  │ 🎵 │ │ ⚡ │      │
│  ────────  │  ┌────────────────────────────┐  │  │Org.│ │Ral.│      │
│            │  │  INNING GRID (scrollable)   │  │  └────┘ └────┘      │
│ [SUB]      │  │  Player rows × inning cols  │  │                     │
│ [LINEUP]   │  │  Pinch to zoom              │  │  ┌──────────────┐  │
│            │  └────────────────────────────┘  │  │BTW INNINGS ▶ │  │
│            │                                  │  └──────────────┘  │
└────────────┴──────────────────────────────────┴─────────────────────┘
```

### Screen-by-Screen Walkthrough

#### Top Status Bar (Persistent)
- Always shows: inning indicator (arrows for top/bottom), visitor score, home score, signal strength indicator (green dot = online, orange = offline mode)
- Tap score → expands to full box score overlay without leaving current screen

#### Left Rail — Lineup Strip
- All 9 batters listed vertically as cards (or 10 for DP/Flex)
- **Active batter:** amber background card, name in 22px/700, amber pulsing glow ring — unmistakable
- **On Deck:** steel-blue card, name in 18px/600
- **Already batted this inning:** faded opacity (0.4), name in 16px/400
- **Substituted:** strikethrough name, replacement shown below with small badge
- Swipe left on any player card → quick substitution drawer (slides from left edge)
- Long press → player stats modal (season AVG, last 5 AB result, pitch count)
- Rail scrolls independently if roster exceeds visible space

#### Center — Play Recorder (The Heart)
- **At Bat card:** player name huge (28px), jersey number, current count displayed as two colored dots (Balls=green, Strikes=amber)
- **Diamond graphic:** fully interactive; tap each base corner to advance a runner; runner silhouettes appear as runners occupy bases; tap occupied base → "out" or "advance" action sheet
- **Outcome Strip (bottom):** 10 outcome buttons arranged in two rows of 5
  - Row 1 (most common): `BB` `K` `1B` `2B` `HR`
  - Row 2: `3B` `OUT` `E` `SAC` `FC`
  - Each button: 72×72pt minimum, rounded rectangle (8pt radius), 12pt gaps between
  - Colors: BB/1B/2B/3B/HR = green tint background; K/OUT/E = red tint; SAC/FC = amber tint
  - Tapping any outcome immediately advances the scorebook state
- **Undo button:** always in top-right of center panel, red border, labeled `↩ UNDO` — 56×56pt

#### Right Rail — DJ Console
- **Now Playing card:** song title (16px/600), artist (13px/400 muted), progress bar (amber)
- Transport controls: large skip-back, play/pause, skip-forward (60×60pt each)
- **On Deck preview card:** next batter's song shown below, smaller
- **Soundboard grid:** 2×3 grid of square buttons with icon + label
  - Labels are mandatory (icon alone not sufficient for accessibility)
  - Active/playing state: amber ring + subtle scale animation (1.05×, 200ms spring)
- **Between Innings button:** full-width, prominent; triggers immediately on 3rd out if "Auto" toggle is ON
- **Volume slider:** thumb is 44pt, track is 4pt tall, full-width — easy one-thumb operation

#### Phone Layout (Bottom Tab Navigation)
On screens narrower than 768pt, the three-column layout collapses:
- **Bottom tab bar (4 tabs):** Lineup | Scorebook | DJ | Stats
- Scorebook becomes the default landing tab mid-game
- DJ controls collapse to a "mini player" persistent strip above the tab bar (like Spotify)
- Swipe up on mini player → full DJ drawer

---

## 5. Technical Integration Strategy

### Architecture Overview

```
FOUNDRY APP
├── Local First Architecture
│     ├── SQLite (via expo-sqlite or react-native-sqlite-storage)
│     │     ├── games table
│     │     ├── players table
│     │     ├── plate_appearances table
│     │     ├── pitches table (optional mode)
│     │     └── audio_assignments table
│     └── FileSystem (Expo FileSystem / RNFS)
│           └── local_audio/ (uploaded MP3s, voice recordings)
│
├── State Management
│     ├── Zustand store (gameState, lineupState, audioState)
│     └── Unified event bus: "AT_BAT_CHANGED" event fires → all subscribers update
│
├── Audio Integration Layer
│     ├── Spotify Remote SDK (iOS + Android)
│     ├── Apple MusicKit (iOS)
│     └── react-native-track-player (local files + crossfade logic)
│
└── Cloud Sync (Optional, requires account)
      └── Supabase (Postgres + Realtime)
            ├── Row-level security (team-scoped data)
            └── Conflict resolution: last-write-wins per plate_appearance_id
```

---

### The Unified State Event Bus (Core Integration Logic)

This is the most critical technical concept in Foundry. All three modules subscribe to a shared `GameEvent` stream.

```typescript
// Core event types
type GameEvent =
  | { type: 'BATTER_UP';     playerId: string; battingOrderSlot: number }
  | { type: 'ON_DECK';       playerId: string }
  | { type: 'PLAY_RECORDED'; result: PlayResult; runnersAdvanced: Runner[] }
  | { type: 'INNING_OVER';   inning: number; half: 'top' | 'bottom' }
  | { type: 'SUBSTITUTION';  outPlayerId: string; inPlayerId: string }

// When scorebook advances to next batter:
dispatch({ type: 'BATTER_UP', playerId: 'johnson_7', battingOrderSlot: 1 })

// AudioEngine subscriber fires immediately:
onBatterUp(playerId) => {
  const song = roster.find(p => p.id === playerId).walkUpSong
  if (song.source === 'spotify') SpotifyRemote.playUri(song.uri, { startMs: song.startMs })
  if (song.source === 'local')   TrackPlayer.load(song.localPath)
  if (announcer.enabled)         speak(`Now batting, number ${player.number}, ${player.name}`)
  fadeInOverMs(1500)
}
```

This ensures **zero manual coordination** between modules. The coach taps an outcome — the score updates, the next batter's highlight moves, and their song starts. One tap, three reactions.

---

### Music Licensing & Audio Sources

| Source | Implementation | Offline? | License Handled By |
|---|---|---|---|
| Spotify | Spotify iOS/Android Remote SDK + OAuth | No (requires stream) | Spotify / Venue (PRO) |
| Apple Music | MusicKit + MediaPlayer framework | No (requires stream) | Apple Music / Venue (PRO) |
| Local MP3/AAC | react-native-track-player, stored in app Documents/ | Yes | User (acknowledged on upload) |
| Voice Recording | expo-av / AVAudioRecorder, stored locally | Yes | N/A (original content) |
| TTS Announcements | AVSpeechSynthesizer (iOS) / TextToSpeech (Android) | Yes | N/A |

**Offline Mode Audio:** If the game location has no internet, the app automatically detects missing stream connectivity and:
1. Falls back to local MP3s if assigned
2. Falls back to TTS-only announcements if no local file
3. Surfaces a non-blocking banner: "Stream unavailable — using local audio"

---

### Data Sync Strategy

**Local First — Always:**
Every plate appearance, lineup change, and audio event writes to SQLite synchronously before any UI update confirms. The app never waits for a network round-trip.

**Cloud Backup (when signed in):**
- Changes queue in an outbox table
- Background sync worker flushes outbox every 30 seconds when online
- Conflict resolution: `plate_appearance` rows have a `device_id + sequence_number` composite key; server takes the highest sequence per at-bat slot
- Full game can be viewed and edited on a second device (assistant coach) in read-only mode with ~5 second lag

**Export Formats:**
- Box Score: PNG image (shareable to team chat) and PDF
- Full Scorebook: PDF mimicking traditional paper scorebook layout
- Stats: CSV export compatible with GameChanger import format

---

### Offline Reliability Checklist

- [ ] Zero network calls required to open a game
- [ ] Zero network calls required to record any play
- [ ] Audio: local file fallback for every player who has uploaded an MP3
- [ ] Sync-on-reconnect: no data loss if device loses connectivity mid-game
- [ ] App cold-start in Airplane Mode: all in-progress game data restores from SQLite
- [ ] Bluetooth speaker disconnect: audio stops gracefully, banner prompt to reconnect

---

## Roadmap Phasing

| Phase | Features | Target |
|---|---|---|
| **MVP (v1.0)** | Roster builder, drag-drop lineup, basic scorebook (outcomes, box score), local MP3 walk-ups, TTS announcements, offline SQLite | Month 1–3 |
| **v1.5** | Spray charts, Spotify integration, soundboard, between-innings playlists, lineup templates | Month 4–5 |
| **v2.0** | Apple Music, pitch tracking mode, Softball DP/Flex full ruleset, cloud sync, multi-device (assistant coach view) | Month 6–8 |
| **v2.5** | Season stats dashboard, CSV/PDF exports, GameChanger import, SuperVoice custom recordings | Month 9–10 |
| **v3.0** | Live score sharing (public game link), scout reports, video clip tagging per plate appearance | Month 11–12 |
