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
- `public_html/game/` — the game itself (`game.js`, `game.css`); plain JS, no build step.
- `resources/views/game.blade.php` — the page.
- `app/Http/Controllers/ScoreController.php` — leaderboard API (`GET /scores`, `POST /scores`).

## Tests

```sh
php artisan test
```
