#!/usr/bin/env bash
# Production deploy for Sweet Swap (nq-candy). Run ON the server, from the
# app root (the directory that contains public_html/):
#
#   ./deploy.sh              # pull + composer + backup + migrate + caches + verify
#   ./deploy.sh --verify     # only run the checks, change nothing
#   ./deploy.sh --rollback   # return the code to the commit before the last deploy
#
# One command for the whole sequence so the steps cannot drift apart: a
# pull without a migrate is the classic cause of a production 500
# ("Base table or view not found").
#
# First deploy on a new server needs a .env (copy .env.example, set
# APP_ENV=production, APP_DEBUG=false, APP_URL, then `php artisan
# key:generate`) — `./cx.sh 27` on your own machine does all of that. The
# web server's document root must be public_html/.

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
STEP="start"

step() { STEP="$1"; echo "→ $1"; }

env_value() { grep -E "^$1=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"'"'" || true; }

#---------------------------------------------------------------
# Checks — shared by a normal deploy, --verify and --rollback
#---------------------------------------------------------------
verify() {
    local failed=0
    ok()   { echo "  ✓ $1"; }
    warn() { echo "  ⚠ $1"; }
    fail() { echo "  ✗ $1"; failed=1; }

    [ -f .env ] && ok ".env present" || fail ".env missing"
    grep -q '^APP_KEY=base64:' .env 2>/dev/null && ok "APP_KEY set" || fail "APP_KEY not set — run: php artisan key:generate"
    grep -q '^APP_DEBUG=true' .env 2>/dev/null && fail "APP_DEBUG=true — error pages would expose internals" || ok "APP_DEBUG off"
    [ "$(env_value APP_ENV)" = "production" ] && ok "APP_ENV=production" || warn "APP_ENV is '$(env_value APP_ENV)', not production"

    for d in storage/logs storage/framework/cache storage/framework/sessions storage/framework/views bootstrap/cache; do
        [ -w "$d" ] && ok "$d writable" || fail "$d not writable"
    done

    for f in public_html/index.php public_html/.htaccess public_html/game/game.js public_html/game/game.css; do
        [ -f "$f" ] && ok "$f" || fail "$f missing"
    done

    if php artisan migrate:status --pending 2>/dev/null | grep -q 'No pending migrations'; then
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
    if command -v composer >/dev/null 2>&1; then
        step "composer install"
        composer install --no-dev --optimize-autoloader --no-interaction
    elif [ ! -f vendor/autoload.php ]; then
        echo "✗ vendor/ is missing and composer is not on PATH — cannot continue."
        exit 1
    else
        # Not fatal: the code has already moved, and stopping here would
        # leave the tree un-migrated as well. Say so loudly instead.
        echo "⚠ composer.lock changed but composer is not on PATH."
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

case "${1:-}" in
    ""|--rollback) ;;
    *) echo "Unknown option '$1'. Usage: ./deploy.sh [--verify | --rollback]"; exit 2 ;;
esac

if [ ! -f .env ]; then
    echo "✗ No .env here. Create it first (see the header of this script)."
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
trap 'code=$?; rmdir "$LOCK_DIR" 2>/dev/null || true; [ $code -eq 0 ] || echo "✗ deploy stopped during: $STEP (exit $code)"' EXIT

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
    step "migrate"
    php artisan migrate --force
fi

step "cache config/routes/views"
php artisan optimize

step "verify"
verify || { echo "✗ now on $(git log --oneline -1), but checks failed — see above"; exit 1; }

echo "✓ deployed $(git log --oneline -1) in $(( $(date +%s) - STARTED ))s"
[ "$BEFORE" = "$AFTER" ] || echo "  undo with: ./deploy.sh --rollback   (back to $(git rev-parse --short "$BEFORE"))"
exit 0
}
