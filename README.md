# Trident Cricket Scorer - Backend

REST and realtime API: Node.js, Express, Socket.IO and MongoDB.

## Run locally

Needs Node 20.12 or newer and a running MongoDB.

```bash
npm install
cp .env.example .env     # then edit the values
npm run seed             # optional: two sample teams and one match
npm run dev              # http://localhost:5080
npm test                 # uses a temporary local database
```

## Environment variables

| Name | Required | Description |
| --- | --- | --- |
| `MONGODB_URI` | yes | MongoDB connection string, including the database name |
| `ADMIN_ID` | yes | Scorer login ID (min 3 characters) |
| `ADMIN_PASSWORD` | yes | Scorer password (min 8 characters) |
| `JWT_SECRET` | yes | Long random string (`openssl rand -hex 32`) |
| `CLIENT_ORIGIN` | in production | Frontend URL(s), comma separated |
| `PORT` | no | Default 5080. Render sets this itself |
| `TOKEN_TTL` | no | Login lifetime, default `12h` |

To change the scorer password, update the variable and restart. Existing logins
stay valid until they expire; change `JWT_SECRET` too to sign everyone out.

## Deploy on Render

1. Create a free database on [MongoDB Atlas](https://www.mongodb.com/atlas).
   Add a database user, allow network access from Render (`0.0.0.0/0` is the
   simple option), and copy the connection string. Put a database name before the
   `?`, for example `.../trident_cricket?retryWrites=true`.
2. Push this folder to its own Git repository.
3. In Render choose **New > Blueprint** and select the repository
   (`render.yaml` is picked up automatically).
4. Enter `MONGODB_URI`, `ADMIN_ID`, `ADMIN_PASSWORD` and `CLIENT_ORIGIN`
   (the frontend URL; update it once the frontend is deployed).
5. Check `https://<your-api>.onrender.com/api/health` returns `{"ok":true}`.

Render's free web service sleeps when idle, and the first request afterwards can
take about a minute. Open the app a few minutes before a match, or use a paid plan.

Run a single instance. Live updates are held in memory, so scaling to several
instances would also need the Socket.IO Redis adapter.

## API

| Method | Path | Login | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | no | Health check |
| POST | `/api/auth/login` | no | `{adminId, password}` returns `{token}` |
| GET | `/api/auth/me` | yes | Check a token |
| GET | `/api/teams` | no | List teams |
| POST / PUT / DELETE | `/api/teams[/:id]` | yes | Manage teams and players |
| GET | `/api/matches` | no | Live, upcoming and recent matches |
| GET | `/api/matches/:id` | no | Full scorecard |
| GET | `/api/points` | no | League points table and the final |
| POST / PUT / DELETE | `/api/matches[/:id]` | yes | Manage matches |
| POST | `/api/matches/:id/events` | yes | `{rev, event}` scores one action |
| POST | `/api/matches/:id/undo` | yes | `{rev}` removes the last action |

Event types: `toss`, `innings_start`, `ball`, `new_batter`, `new_bowler`,
`swap_strike`, `retire`, `end_innings`, `abandon`.

`rev` must match the match's current revision, otherwise the API answers `409`.
This stops double taps or a second device from recording a ball twice.

Socket.IO: emit `watch` with a match id to receive `match:update` and
`match:deleted`; emit `lobby:join` to receive `matches:changed`.

## Scoring rules

All rules live in `src/scoring/engine.js`.

- Six legal balls per over; the same bowler may bowl consecutive overs.
- Wide and no ball: 1 run penalty and the ball is bowled again. No free-hit tracking.
- Byes and leg byes are not charged to the bowler.
- An innings ends when overs run out, the target is passed, or no batter is left.
- A tie is recorded as a tie (no super over). No DLS rain calculation.
- No per-bowler over limit.

## Points table

Rules live in `src/scoring/points.js`.

- Only league matches count; the match marked as the final does not.
- Win 2 points, loss 0, tie or no result (abandoned) 1 each.
- Teams are ranked by points, then net run rate (NRR).
- NRR = runs scored per over faced, minus runs conceded per over bowled. A side
  that is bowled out, or whose innings is ended early, is charged its full overs.
  Abandoned matches are left out of NRR.
- The league is complete when every pair of teams has met and no league match is
  waiting to be played. The top 2 then qualify for the final. Teams level on both
  points and NRR for a qualifying place are flagged instead of being picked.
