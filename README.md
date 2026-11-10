# nq-candy

**Sweet Swap** — a match-3 candy game built on Laravel, served from `public_html`.

## Run it

```sh
composer install
cp .env.example .env && php artisan key:generate
touch database/database.sqlite && php artisan migrate
php artisan serve
```

Then open http://localhost:8000.

## Layout

- `public_html/` — the web root (set in `bootstrap/app.php` via `usePublicPath`). Point your host's document root here.
- `public_html/.htaccess` — selects PHP 8.5 (`AddHandler application/x-httpd-php85`) and holds Laravel's rewrite rules.
- `public_html/game/` — the game itself (`game.js`, `game.css`); plain JS, no build step.
- `resources/views/game.blade.php` — the page.
- `app/Http/Controllers/ScoreController.php` — leaderboard API (`GET /scores`, `POST /scores`).

## Deploy

Two scripts, one for each end:

- `deploy.sh` runs **on the server** from the app root. It pulls, installs composer dependencies when the lockfile moved, snapshots the SQLite database, migrates, rebuilds caches and verifies.
  - `./deploy.sh --verify` only runs the checks.
  - `./deploy.sh --rollback` returns the code to the commit before the last deploy (migrations are not reverted).
- `cx.sh` runs **locally** and drives the server over SSH. Copy `vars.sh.example` to `vars.sh` and fill in your host first.
  - `./cx.sh` shows the menu; `./cx.sh 20` runs an option directly.
  - `27` first-time server setup, `20` deploy, `28` rollback, `30` health check, `31`/`32` logs, `40`–`42` leaderboard, `72`/`73` maintenance mode.

## Tests

```sh
php artisan test
```
