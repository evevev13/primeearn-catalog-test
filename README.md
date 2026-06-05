# PrimeEarn Offers Test App

Small web app to quickly verify PrimeEarn catalog integration and open live offer tracking URLs.

## What this does

- Fetches available offers from PrimeEarn via `GET /{app_token}/api/v1/offers`
- Displays game cards with image, genre, platform, and reward
- Lets you open each game through `tracking_url` using **Play & Earn**
- Loads offer details and task-level rewards via `GET /{app_token}/api/v1/offers/{hash}`

## Why there is a backend

PrimeEarn docs explicitly say the app token must stay secret. This app keeps the token on the server and your frontend only talks to `/api/*` routes.

## Run

1. Install dependencies:
   - `npm install`
2. Create env file:
   - `cp .env.example .env`
3. Edit `.env` and set your real `APP_TOKEN`
4. Start app:
   - `npm run dev`
5. Open `http://localhost:3000`

## Persistent free hosting on Render

This repo is ready for a Render free web service via [render.yaml](render.yaml).

Deploy it once to get a stable `*.onrender.com` address:

1. Push the project to a GitLab repository.
2. In Render, create a new Web Service from that GitLab repo, or import the Blueprint.
3. Set `APP_TOKEN` as a secret environment variable.
4. Keep `APP_HASH` set to `sltVRszfuB` unless PrimeEarn gives you a different hash.
5. Deploy the service.

GitLab CI is also configured in [ .gitlab-ci.yml ](.gitlab-ci.yml) to verify the app and optionally trigger a Render deploy hook when you define `RENDER_DEPLOY_HOOK_URL`.

## Env vars

- `APP_TOKEN`: PrimeEarn partner token (required)
- `APP_HASH`: App hash (pre-filled as `sltVRszfuB`)
- `PORT`: local server port (default `3000`)

On Render, set `APP_TOKEN` in the service environment settings.

## Notes

- `external_user_id` and `ip` are required by PrimeEarn. The UI lets you set user ID and optional IP.
- If IP is empty in local dev, the server attempts public IP lookup for easier testing.
