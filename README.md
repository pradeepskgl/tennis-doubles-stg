# AO Doubles Tournament Tracker

A standalone Node.js + MongoDB app for tracking the AO Doubles Tournament: 12 fixed teams across
4 groups, round-robin group stage, semifinals, and a final - with full doubles scoring (No-Ad group
play, Ad-scoring final, set/match tiebreaks), realistic serve/receive rotation for both players on
each team, group standings, and a one-time admin passcode.

This is a **separate app** from the singles tournament tracker - run it on its own port with its
own MongoDB database.

## 1. Setup

```bash
cd doubles-app
cp .env.example .env
```

Edit `.env`:
- `MONGODB_URI` — a MongoDB Atlas connection string. **Use a different database than the singles
  app** (e.g. `ao_doubles_tournament` instead of `tennis_tournament`) so the two don't collide.
- `PORT` — defaults to 3001 (different from the singles app's 3000, so both can run side by side)
- `SESSION_SECRET`, `SESSION_HOURS`, `LOCK_TTL_SECONDS` — same purpose as the singles app

Then install (this also auto-seeds the 12 teams and 15 matches via `postinstall`):

```bash
npm install
```

If `.env` wasn't ready yet when you ran `npm install`, seed manually once it is:

```bash
npm run seed
```

## 2. Run the app

```bash
npm start
```

The app is accessed through **two separate URLs**, for two different audiences:

- **`http://localhost:3001`** (or your deployed domain) — the public pages: Matches, Standings,
  Teams. Anyone can view live scores, standings, and team info here. No login is shown or needed
  on these pages.
- **`http://localhost:3001/admin`** — the dedicated admin login page. This is where the
  tournament organizer sets the passcode the very first time (one-time only - it can never be
  changed again for this deployment), and logs in on subsequent visits. Once logged in here, the
  same browser session carries admin access back over to the Matches/Standings/Teams pages
  automatically (via a session cookie) - a small "Admin session active" indicator with a Logout
  button appears in their header instead of a login form.

In practice: share the plain root URL with spectators/players, and keep the `/admin` URL private
to whoever is running the scoring table.

## 3. Teams & schedule (from the rulebook)

**Groups** (3 teams each, round robin - each team plays the other two once):

| Group A | Group B | Group C | Group D |
|---|---|---|---|
| A1: Mahesh & Nagaraju | B1: Swamy & Girish LC | C1: Ganesh S & Kiran Surya | D1: Hemant & Vasista Sandeep |
| A2: Chetan & Manjunath P | B2: Girish S & TBD | C2: Prajwal & Manjunath T | D2: Chandramouli & Sudheendra |
| A3: Pramod & Pradeep | B3: Lokendra & Alok | C3: Raveendra & Priyanshu | D3: Vijay Raghavan & Sathish |

12 group matches are seeded with the exact times from the source schedule. **Note:** the source
document labels the last Group B match "B1 vs B3", but the listed players are actually B1 vs B2 -
this was corrected in the seed data so each of the 3 possible Group B pairings (1v2, 1v3, 2v3)
appears exactly once, matching every other group.

**Semifinals**: the source document doesn't specify the SF pairing beyond "group winners advance."
Seeded as SF1 = Winner Group A vs Winner Group B, SF2 = Winner Group C vs Winner Group D — edit
freely from the Matches page if you intended a different pairing (e.g. A vs D, B vs C).

**Final**: Winner SF1 vs Winner SF2, format/times editable.

## 4. Menus

- **Matches** (home page) — all 15 matches, tabbed Group Stage / Semifinals & Final. Click into
  any match for the scoring console.
- **Standings** — live group tables (match points, wins/losses, games won/lost, game diff), plus
  admin controls to confirm each group's qualifier and propagate them into the Semifinal bracket.
- **Teams** — all 12 teams by group; admin can edit player names (e.g. filling in Group B2's TBD
  player once confirmed) — updates cascade to how that team's name displays on match pages.

## 5. Match workflow (per match)

1. **Coin toss** (admin): winner chooses to serve/receive, or which end to start on, or defers to
   the opponent — same three-way choice structure as the singles app, adapted for teams.
2. **Set 1 serve & receive order** (admin): pick which team serves Game 1, then for each team pick
   their first server (the partner serves the team's next service turn) and which player receives
   in the Deuce court (the partner receives in the Ad court) — this fully determines that set's
   rotation. Submitting this starts the match.
3. **Scoring**: tap "Point: [Team]" per point. The live scoreboard shows the **server, receiver,
   and serving court (Deuce/Ad)** for every point, computed from the team orders and continuing
   rotation — no manual tracking needed.
4. **Between sets**: whenever a new set (or a 3rd deciding set in Final "full set" mode) begins,
   admin submits a fresh serve/receive order for it — teams are allowed to change their order each
   set per the rulebook. Scoring is blocked until this is submitted.
5. **Match/set tiebreaks**: handled automatically by the rules below; the rotation continues
   seamlessly from the set's established order, exactly per the rulebook's serving-order rules.
6. **Finish**: winner is set automatically when the match completes normally, or an admin can
   manually mark a match finished (retirement/walkover), picking the winner if the score doesn't
   already have one.

## 6. Scoring rules implemented

**Group Stage + Semifinals** (No-Ad):
- No-Ad game scoring (sudden deciding point at 40-40)
- Sets: first to 6 games, win by 2
- At 6-6: 7-point tiebreak, **no win-by-2 required** — first to 7 wins outright
- Sets split 1-1: 10-point match tiebreak (win by 2) decides the match — there is never a real 3rd set

**Final** (Ad scoring):
- Traditional advantage scoring
- Sets: first to 6 games, win by 2
- At 6-6: 7-point tiebreak, **win by 2 required**
- Sets split 1-1: admin's choice (editable per match, in the schedule editor) —
  either a 10-point match tiebreak (win by 2), or a full 3rd set played under the same rules as
  sets 1 & 2

**Switching ends**: after every odd-numbered game (1, 3, 5, 7, 9…); every 6 points during any
tiebreak; and once more immediately before a match tiebreak begins.

**Serve/receive rotation**: server rotates game-by-game through both teams' players in a fixed
4-slot cycle (Team A player 1 → Team B player 1 → Team A player 2 → Team B player 2 → repeats).
Within a game, court side alternates Deuce/Ad by total points played (even = Deuce, odd = Ad), and
each team's receiver for that court is fixed for the whole set. Tiebreaks reuse the same rotation,
continuing from whichever player is naturally "due" next; the very first point of any tiebreak is
a single point, then each player serves 2 consecutive points cycling through all 4.

## 7. Standings & qualification

- Match points: win = 2, loss = 0.
- If a team wins both its group matches, it qualifies outright.
- If all three teams in a group finish 1-1 (2 points each), ranking falls back to: game
  differential, then total games won. Match-tiebreak points never count as games won/lost.
- If it's still tied after that, the rulebook calls for a coin toss/drawing lots — this can't be
  automated, so the Standings page flags it and lets the admin pick the qualifier manually.
- Clicking **"Confirm & Propagate"** locks in that group's qualifier and immediately updates the
  corresponding Semifinal match's team slot.

## 8. Project structure

```
server.js                    Express + Socket.io entry point
models/                      Config, Team, Match, GroupWinner
routes/                      auth, teams, matches, standings
middleware/auth.js           Session cookie signing/verification
utils/doublesRulesEngine.js  Pure scoring engine (unit-testable, no DB/Express deps)
utils/groupStandings.js      Group standings calculator
utils/seedData.js            One-time/idempotent teams + schedule seeding
public/                      index.html (Matches), standings.html, teams.html, match.html
test_doubles_engine.js       Unit tests for the rules engine (`node test_doubles_engine.js`)
```
