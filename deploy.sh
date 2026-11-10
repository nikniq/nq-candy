#!/usr/bin/env bash
# Production deploy for Sweet Swap (nq-candy). Run ON the server, from the
# app root (the directory that contains public_html/):
#
#   ./deploy.sh              # pull + composer + backup + migrate + caches + verify
#   ./deploy.sh --verify     # only run the checks, change nothing
#   ./deploy.sh --rollback   # return the code to the commit before the last deploy
#   ./deploy.sh --status     # what is live, recent deploys, pending migrations
#   ./deploy.sh --restore    # list database snapshots; add a file name to restore one
#
# One command for the whole sequence so the steps cannot drift apart: a
# pull without a migrate is the classic cause of a production 500
# ("Base table or view not found").
#
# First deploy on a new server needs a .env (copy .env.example, set
# APP_ENV=production, APP_DEBUG=false, APP_URL, then `php artisan
# key:generate`) — `./cx.sh 27` on your own machine does all of that. The
# web server's document root must be public_html/.
#
# If the server's command-line `php` is not the version the site runs on
# (common on shared hosting, where .htaccess picks the web version), put the
# right binaries in a deploy.conf next to this script — it is gitignored:
#
#   PHP_BIN=/usr/local/bin/php85
#   COMPOSER_BIN="/usr/local/bin/php85 $HOME/composer.phar"

set -euo pipefail
cd "$(dirname "$0")"

# Everything below sits inside one { … } block, closed on the last line.
# bash reads a script as it runs it, and `git pull` can replace this very
# file mid-run; the block forces the whole script to be parsed up front.
{

PREV_FILE=storage/app/deploy-prev      # commit the last deploy started from
BACKUP_DIR=storage/app/backups         # SQLite snapshots taken before migrating
KEEP_BACKUPS=10
LOCK_DIR=storage/framework/deploy.lock
DEPLOY_LOG=storage/logs/deploy.log
MIN_PHP=8.3.0                          # composer.json: "php": "^8.3"

[ -f ./deploy.conf ] && source ./deploy.conf
PHP="${PHP_BIN:-php}"
COMPOSER="${COMPOSER_BIN:-composer}"   # may be two words, so it is used unquoted
STEP="start"

step() { STEP="$1"; echo "→ $1"; }

env_value() { grep -E "^$1=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'"'" || true; }

# The CLI php on shared hosts is often older than the one serving the
# site; artisan then dies with a parse error that looks like a broken deploy.
check_php() {
    $PHP -r "exit(version_compare(PHP_VERSION, '$MIN_PHP', '>=') ? 0 : 1);" 2>/dev/null
}

pending_migrations() {
    local out; out=$($PHP artisan migrate:status --pending 2>/dev/null || true)
    ! grep -q 'No pending migrations' <<<"$out"
}

record() {
    printf '%s  %-8s %s  by %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" "$2" "${USER:-unknown}" >> "$DEPLOY_LOG" 2>/dev/null || true
}

#---------------------------------------------------------------
# Checks — shared by a normal deploy, --verify and --rollback
#---------------------------------------------------------------
verify() {
    local failed=0
    ok()   { echo "  ✓ $1"; }
    warn() { echo "  ⚠ $1"; }
    fail() { echo "  ✗ $1"; failed=1; }

    check_php && ok "$PHP is $($PHP -r 'echo PHP_VERSION;')" || fail "$PHP is older than $MIN_PHP or missing — set PHP_BIN in deploy.conf"
    if [ "$(env_value DB_CONNECTION)" = "sqlite" ]; then
        # Captured first: under pipefail, `php -m | grep -q` fails when grep
        # exits early and php dies writing to the closed pipe.
        local mods; mods=$($PHP -m 2>/dev/null || true)
        grep -qi '^pdo_sqlite$' <<<"$mods" && ok "pdo_sqlite loaded" || fail "pdo_sqlite extension missing from $PHP"
    fi
    [ -f .env ] && ok ".env present" || fail ".env missing"
    grep -q '^APP_KEY=base64:' .env 2>/dev/null && ok "APP_KEY set" || fail "APP_KEY not set — run: php artisan key:generate"
    grep -q '^APP_DEBUG=true' .env 2>/dev/null && fail "APP_DEBUG=true — error pages would expose internals" || ok "APP_DEBUG off"
    [ -f storage/framework/down ] && warn "maintenance mode is ON — visitors get a 503 (php artisan up)"
    [ "$(env_value APP_ENV)" = "production" ] && ok "APP_ENV=production" || warn "APP_ENV is '$(env_value APP_ENV)', not production"

    for d in storage/logs storage/framework/cache storage/framework/sessions storage/framework/views bootstrap/cache; do
        [ -w "$d" ] && ok "$d writable" || fail "$d not writable"
    done

    for f in public_html/index.php public_html/.htaccess public_html/game/game.js public_html/game/game.css; do
        [ -f "$f" ] && ok "$f" || fail "$f missing"
    done

    if ! pending_migrations; then
        ok "no pending migrations"
    else
        fail "pending migrations (or the database is unreachable) — run: php artisan migrate:status"
    fi

    # Through the front door, so this covers the web server, the PHP handler
    # in .htaccess and the document root — none of which the CLI exercises.
    # A warning rather than a failure: some hosts cannot reach their own
    # public name from inside. `./cx.sh 30` checks it from outside.
    local url; url=$(env_value APP_URL)
    if [ -n "$url" ] && command -v curl >/dev/null 2>&1; then
        local code; code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url/up" || true)
        [ "$code" = "200" ] && ok "$url/up responds 200" || warn "$url/up returned '${code:-nothing}' from here — check it from outside"
    fi

    return $failed
}

install_dependencies() {
    if command -v ${COMPOSER%% *} >/dev/null 2>&1; then
        step "composer install"
        $COMPOSER install --no-dev --optimize-autoloader --no-interaction
    elif [ ! -f vendor/autoload.php ]; then
        echo "✗ vendor/ is missing and '$COMPOSER' was not found (set COMPOSER_BIN in deploy.conf)."
        exit 1
    else
        # Not fatal: the code has already moved, and stopping here would
        # leave the tree un-migrated as well. Say so loudly instead.
        echo "⚠ composer.lock changed but '$COMPOSER' was not found (set COMPOSER_BIN in deploy.conf)."
        echo "  Install dependencies manually before trusting this deploy."
    fi
}

sqlite_file() {
    [ "$(env_value DB_CONNECTION)" = "sqlite" ] || return 0
    local f; f=$(env_value DB_DATABASE)
    echo "${f:-database/database.sqlite}"
}

if [ "${1:-}" = "--verify" ]; then
    echo "→ verify"
    verify && echo "✓ all checks passed" || { echo "✗ checks failed"; exit 1; }
    exit 0
fi

if [ "${1:-}" = "--status" ]; then
    echo "live       : $(git log -1 --format='%h %s (%cr)')"
    echo "branch     : $(git rev-parse --abbrev-ref HEAD), $(git status --porcelain --untracked-files=no | wc -l | tr -d ' ') tracked file(s) modified"
    echo "php        : $($PHP -r 'echo PHP_VERSION;' 2>/dev/null || echo "'$PHP' not found")"
    [ -f storage/framework/down ] && echo "maintenance: ON" || echo "maintenance: off"
    pending_migrations && echo "migrations : PENDING (or database unreachable)" || echo "migrations : up to date"
    echo "snapshots  : $(ls -1 "$BACKUP_DIR"/*.sqlite 2>/dev/null | wc -l | tr -d ' ') in $BACKUP_DIR"
    echo "recent deploys:"
    tail -n 5 "$DEPLOY_LOG" 2>/dev/null | sed 's/^/  /' || true
    [ -f "$DEPLOY_LOG" ] || echo "  none recorded yet"
    exit 0
fi

if [ "${1:-}" = "--restore" ]; then
    DB_FILE=$(sqlite_file)
    [ -n "$DB_FILE" ] || { echo "✗ DB_CONNECTION is not sqlite — nothing to restore here."; exit 1; }
    if [ -z "${2:-}" ]; then
        echo "Snapshots in $BACKUP_DIR (newest first) — restore with: ./deploy.sh --restore <file>"
        ls -1t "$BACKUP_DIR" 2>/dev/null | grep '\.sqlite$' | sed 's/^/  /' || echo "  none yet"
        exit 0
    fi
    SNAP="$BACKUP_DIR/$(basename "$2")"
    [ -f "$SNAP" ] || { echo "✗ No snapshot $SNAP"; exit 1; }
    echo "⚠ This replaces $DB_FILE with $SNAP. Scores saved since then are lost"
    echo "  (the current database is snapshotted first, so this can be undone)."
    read -r -p "Type 'yes' to continue: " reply
    [ "$reply" = "yes" ] || { echo "Skipped."; exit 0; }
    mkdir -p "$BACKUP_DIR"
    [ -s "$DB_FILE" ] && cp -p "$DB_FILE" "$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)-pre-restore.sqlite"
    cp -p "$SNAP" "$DB_FILE"
    record restore "$(basename "$SNAP")"
    echo "✓ restored $(basename "$SNAP")"
    exit 0
fi

case "${1:-}" in
    ""|--rollback) ;;
    *) echo "Unknown option '$1'. Usage: ./deploy.sh [--verify | --rollback | --status | --restore [file]]"; exit 2 ;;
esac

if [ ! -f .env ]; then
    echo "✗ No .env here. Create it first (see the header of this script)."
    exit 1
fi

# Before touching anything: with the wrong php every artisan step below
# would fail after the code had already moved.
if ! check_php; then
    echo "✗ '$PHP' is older than $MIN_PHP or missing: $($PHP -v 2>/dev/null | head -n 1)"
    echo "  Point PHP_BIN at the right binary in deploy.conf (see the header of this script)."
    exit 1
fi

# One deploy at a time: two overlapping runs can interleave a pull with a
# migrate. mkdir is atomic, so it doubles as the lock.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "✗ Another deploy seems to be running ($LOCK_DIR exists)."
    echo "  If it is not, remove that directory and try again."
    exit 1
fi
STARTED=$(date +%s)
WENT_DOWN=0
finish() {
    local code=$?
    rmdir "$LOCK_DIR" 2>/dev/null || true
    if [ $code -ne 0 ]; then
        echo "✗ deploy stopped during: $STEP (exit $code)"
        record FAILED "during: $STEP, on $(git rev-parse --short HEAD 2>/dev/null)"
        # Left down on purpose if a migration failed half-way: a half-migrated
        # database behind a live site is worse than a 503.
        [ $WENT_DOWN -eq 1 ] && echo "⚠ the site is still in maintenance mode — fix the problem, then: $PHP artisan up"
    fi
}
trap finish EXIT

# Edits made directly on the server make the pull fail half-way or, worse,
# quietly survive it. Untracked files (.env, the database) are fine.
DIRTY=$(git status --porcelain --untracked-files=no)
if [ -n "$DIRTY" ]; then
    echo "✗ Tracked files were modified on the server:"
    echo "$DIRTY"
    echo "  Commit them from your own machine, or discard with: git checkout -- ."
    exit 1
fi

BEFORE=$(git rev-parse HEAD)
LOCK_BEFORE=$(git rev-parse HEAD:composer.lock 2>/dev/null || echo none)

if [ "${1:-}" = "--rollback" ]; then
    [ -f "$PREV_FILE" ] || { echo "✗ No previous deploy recorded in $PREV_FILE."; exit 1; }
    TARGET=$(cat "$PREV_FILE")
    [ "$TARGET" != "$BEFORE" ] || { echo "Already on $TARGET — nothing to roll back."; exit 0; }
    echo "Rolling back the code:"
    echo "  from $(git log --oneline -1 "$BEFORE")"
    echo "  to   $(git log --oneline -1 "$TARGET")"
    echo "⚠ Migrations are NOT reverted. If the newer code changed the database,"
    echo "  restore a snapshot from $BACKUP_DIR as well."
    read -r -p "Type 'yes' to continue: " reply
    [ "$reply" = "yes" ] || { echo "Skipped."; exit 0; }
    step "git reset to $TARGET"
    git reset --hard "$TARGET"
else
    step "git pull"
    git pull --ff-only
fi

AFTER=$(git rev-parse HEAD)
LOCK_AFTER=$(git rev-parse HEAD:composer.lock 2>/dev/null || echo none)

if [ "$BEFORE" = "$AFTER" ]; then
    echo "  already up to date — refreshing migrations and caches anyway"
else
    echo "$BEFORE" > "$PREV_FILE"
    echo "  changes:"
    git log --oneline --no-decorate "$BEFORE..$AFTER" | sed 's/^/    + /' | head -n 20
    git log --oneline --no-decorate "$AFTER..$BEFORE" | sed 's/^/    - /' | head -n 20
fi

if [ "$LOCK_BEFORE" != "$LOCK_AFTER" ] || [ ! -f vendor/autoload.php ]; then
    install_dependencies
fi

# The leaderboard lives in SQLite by default. The file is gitignored, so a
# fresh server has none; and it is the only copy of the scores, so it is
# snapshotted before every migrate.
DB_FILE=$(sqlite_file)
if [ -n "$DB_FILE" ]; then
    if [ ! -f "$DB_FILE" ]; then
        step "create $DB_FILE"
        mkdir -p "$(dirname "$DB_FILE")"
        touch "$DB_FILE"
    elif [ -s "$DB_FILE" ]; then
        step "back up $DB_FILE"
        mkdir -p "$BACKUP_DIR"
        cp -p "$DB_FILE" "$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short "$BEFORE").sqlite"
        # Keep the newest few; shared hosting quotas are small.
        ls -1t "$BACKUP_DIR"/*.sqlite 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | while read -r old; do rm -f "$old"; done
    fi
fi

if [ "${1:-}" != "--rollback" ]; then
    # Only take the site down when the schema is actually about to change,
    # and only bring it back if this script was what took it down.
    if pending_migrations && [ -s "${DB_FILE:-/dev/null}" ] && [ ! -f storage/framework/down ]; then
        step "maintenance mode on (pending migrations)"
        $PHP artisan down --retry=15
        WENT_DOWN=1
    fi
    step "migrate"
    $PHP artisan migrate --force
    if [ $WENT_DOWN -eq 1 ]; then
        step "maintenance mode off"
        $PHP artisan up
        WENT_DOWN=0
    fi
fi

step "cache config/routes/views"
$PHP artisan optimize

step "verify"
verify || { echo "✗ now on $(git log --oneline -1), but checks failed — see above"; exit 1; }

record "$([ "${1:-}" = "--rollback" ] && echo rollback || echo deploy)" "$(git rev-parse --short "$BEFORE") → $(git rev-parse --short "$AFTER")"
echo "✓ deployed $(git log --oneline -1) in $(( $(date +%s) - STARTED ))s"
[ "$BEFORE" = "$AFTER" ] || echo "  undo with: ./deploy.sh --rollback   (back to $(git rev-parse --short "$BEFORE"))"
exit 0
}
