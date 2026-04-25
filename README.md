# KCFL Card Game Manager

Realtime card-game room manager with lobby setup, live bid tracking, score ranking, and PDF report export.

## What this project does

KCFL lets you:

- Create a game room with custom card distribution rules.
- Add players (with unique auto colors or manual colors).
- Run live rounds where the super player enters bids and marks success or failure.
- Keep a running leaderboard based on total score.
- Extend the game by adding more distribution rows during play.
- End the game and export a game report PDF.
- Share a room code so others can join in view-only mode and watch updates in realtime.

## Feature list

### Room and setup

- Entry switch between Join Room and Create Game.
- Create game form with:
	- Game name and super player name.
	- Player count (2 to 15).
	- Max cards per player, constrained by deck capacity.
	- Distribution direction: descending (Max to 1) or ascending (1 to Max).
	- Optional Without Sir deck mode (65 cards instead of 52).
- Live setup preview showing:
	- Deck size.
	- Cards in play.
	- Unused cards.
	- Deck usage percentage.

### Player management

- Add players up to room capacity.
- Manual color selection or random unique color assignment.
- Super player is auto-added as the host when game is created.

### Gameplay and scoring

- Distribution table generated in wave style based on max cards and direction.
- Suit cycle per round with optional Without Sir rows.
- Super player can input bid per player per round and mark result:
	- Complete (success): score = bid + 10.
	- Incomplete (fail): score = 0.
- Ranking updates from cumulative total score.
- Add 5 more rows anytime during the game.
- End game flow with final celebration leaderboard.

### Realtime and persistence

- Socket.IO room subscriptions for live game updates.
- HTTP API with request validation via Zod.
- MongoDB persistence via Mongoose.
- TTL-based auto cleanup of games (about 1 hour after last update).

### Reporting

- Download game report as PDF.
- Report includes summary, leaderboard, and full bid table.

## Tech stack

- Client: React 19, React Router, TypeScript, Vite, Socket.IO Client
- Server: Node.js, Express 5, TypeScript, Socket.IO, Zod
- Database: MongoDB with Mongoose
- Reporting: jsPDF

## Project structure

- client: React app (UI, routing, realtime client, PDF export)
- server: Express API, Socket.IO server, game engine, MongoDB store
- Root workspace: orchestrates client and server scripts

## Prerequisites

- Node.js 18+
- npm 9+
- MongoDB connection string

## How to play

1. Start the app with npm run dev.
2. Open the client in your browser.
3. Go to Create Game.
4. Fill room settings:
	 - Game name.
	 - Super player name.
	 - Player count and max cards per player.
	 - Card order (Max to 1 or 1 to Max).
	 - Toggle Without Sir mode if needed.
5. Submit and continue to Add Players.
6. Add players until the room reaches capacity.
7. Share the room code with others.
8. Click Start Game.
9. During each round, super player enters each player's bid and marks:
	 - Success (check mark).
	 - Fail (cross mark).
10. Watch the ranking update live after each entry.
11. Use Add 5 rows if you want to continue with more rounds.
12. Click End Game when finished.
13. Download the PDF report from the room header or celebration dialog.

## Join as viewer

- Use Join Room from the entry screen.
- Enter room code.
- Viewer mode opens live read-only table updates.

## Notes

- Game data is stored in MongoDB and refreshed with each update.
- Finished games remain available long enough for report generation and then expire automatically.
