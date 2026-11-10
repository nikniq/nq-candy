#!/bin/bash
#================================================================
# LOCAL command-line assistant — cx.sh (Sweet Swap / nq-candy)
#
#   ./cx.sh            # interactive menu
#   ./cx.sh 20         # run an option directly
#   ./cx.sh 91 "note"  # …with a second parameter (backup description)
#
# ⚠ Runs on your LOCAL machine only — never copy this to the server.
#   Its counterpart on the server is deploy.sh (pull + migrate + caches).
#
# Requires a vars.sh next to it defining REMOTE, PROJECT, APP_SSH, etc.
# See vars.sh.example. vars.sh is gitignored because it holds host and
# account details.
#
# Version 1.1
# - direct runs (./cx.sh 20) no longer clear the screen or print the whole
#   menu; `./cx.sh help` prints it without prompting
# - runs from its own directory, so it works when called from anywhere
# - 27 first-time server setup (clone, .env, key, first deploy), 28 rollback,
#   41 download the leaderboard database, 42 list server-side snapshots
# - 20 offers to push unpushed commits and health-checks the site afterwards
# - history log is prepended through mktemp rather than a ./tmpfile
#
# Version 1.0
# - adapted from the shared cx.sh (v2.4): same option numbers for deploy,
#   diagnosis, queue, maintenance, access and backup
# - left out what this app does not ship: seeders, pricing, connector,
#   subscriptions, ops:reap and the MCP wire log
# - 40 shows the live leaderboard; 70 runs deploy.sh --verify
#================================================================
cd "$(dirname "$0")" || exit 1

# Only an interactive run takes over the screen; `./cx.sh 20` leaves the
# scrollback alone so its output can be read after the fact.
[ -n "$1" ] || clear

if [ ! -f ./vars.sh ]; then
  echo "vars.sh not found next to cx.sh — copy vars.sh.example to vars.sh and fill it in."
  exit 1
fi
source ./vars.sh

# Defaults for settings added after vars.sh files were already in use, so
# an existing vars.sh keeps working without being edited.
REMOTE_APP="${REMOTE_APP:-www/$PROJECT}"     # app root on the server, relative to ~
APP_URL="${APP_URL:-https://$PROJECT}"       # what option 30 health-checks
LOG_OUTPUT="${LOG_OUTPUT:-./log/remote.out}"
REPO_URL="${REPO_URL:-$(git remote get-url origin 2>/dev/null)}"   # what option 27 clones
REPO_BRANCH="${REPO_BRANCH:-main}"

# This script drives the server from outside. Run on the server it would
# try to ssh to itself, and option 99 would rewrite the server's dotfiles.
if [ "$(hostname -s 2>/dev/null)" = "${REMOTE_HOST%%.*}" ]; then
  echo "⚠ This looks like $REMOTE_HOST — cx.sh is the LOCAL script. Use deploy.sh here."
  exit 1
fi

#---------------------------------------------------------------
# Helpers
#---------------------------------------------------------------

# Append a line to the history log, creating it if needed. The old inline
# form assumed ./log/history.log already existed and failed silently.
log_history() {
  mkdir -p ./log
  touch ./log/history.log
  local tmp; tmp=$(mktemp) || return
  printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M')" "$1" > "$tmp"
  cat ./log/history.log >> "$tmp" && mv "$tmp" ./log/history.log
}

# Run a command on the server, in the app directory.
remote() {
  $APP_SSH "$REMOTE" "cd ~/$REMOTE_APP && $*"
}

# Same, with a terminal attached — for anything interactive or long-running.
remote_tty() {
  $APP_SSH -t "$REMOTE" "cd ~/$REMOTE_APP && $*"
}

# Ask for PARAM2 only when the chosen option needs it.
need_param() {
  if [ -z "$PARAM2" ]; then
    read -r -p "$1: " PARAM2
  fi
}

banner() {
  echo ===========================================================
  echo "$1"
  echo ===========================================================
}

# From outside, so it exercises the real path in: DNS, TLS, the web server
# and the PHP handler — not just PHP on the command line.
health() {
  local failed=0 code
  for path in "" "/up" "/game/game.js" "/scores"; do
    code=$(curl -sS -o /dev/null -w '%{http_code} in %{time_total}s' --max-time 25 "$APP_URL$path" 2>/dev/null)
    case "$code" in
      200*) echo "  ✓ ${path:-/}  $code" ;;
      *)    echo "  ✗ ${path:-/}  ${code:-no response}"; failed=1 ;;
    esac
  done
  return $failed
}

# Gate for anything that moves money, drops the site, or is hard to undo.
confirm() {
  echo "⚠ $1"
  read -r -p "Type 'yes' to continue: " reply
  [ "$reply" = "yes" ] || { echo "Skipped $SELECTION."; exit 0; }
}

show_menu() {
  echo =============================================================
  echo "Hi $USER@$HOSTNAME — acting on $PROJECT ($REMOTE)"
  echo "Other sites configured: ${SITES[*]}"
  echo What do you want to do?
  echo -------------------------------------------------------------
  echo "ROUTINE — day to day"
  echo "20 : DEPLOY: pull + composer + migrate + caches + verify on $PROJECT"
  echo "22 : WHAT'S LIVE: compare the server's HEAD with local"
  echo "23 : MIGRATIONS: status (what is pending on the server)"
  echo "24 : CACHES: refresh config/routes/views"
  echo "25 : CACHES: clear everything (when a cached value looks stale)"
  echo "26 : COMPOSER: install production dependencies"
  echo "27 : FIRST-TIME SETUP: clone, .env, key and first deploy on the server"
  echo "28 : ROLLBACK: return the server to the commit before the last deploy"
  echo ----------------------------------------------
  echo DIAGNOSE
  echo "30 : HEALTH: $APP_URL — page, /up, game assets, leaderboard"
  echo "31 : LOGS: tail the Laravel log"
  echo "32 : LOGS: last errors with stack traces"
  echo "33 : ARTISAN: run a command (e.g. 'migrate:status')"
  echo "34 : CONFIG: key settings on the server"
  echo "35 : DISK: what is using the account quota"
  echo "36 : LOGS: file sizes, and what is growing"
  echo ----------------------------------------------
  echo "GAME"
  echo "40 : LEADERBOARD: top scores on $APP_URL"
  echo "41 : LEADERBOARD: download the SQLite database to ./files"
  echo "42 : LEADERBOARD: list the snapshots deploy.sh keeps on the server"
  echo ----------------------------------------------
  echo "QUEUE & SCHEDULE"
  echo "50 : QUEUE: list failed jobs"
  echo "51 : QUEUE: retry all failed jobs"
  echo "52 : QUEUE: drain the queue now"
  echo "53 : SCHEDULE: what is registered"
  echo ----------------------------------------------
  echo MAINTENANCE
  echo "70 : VERIFY: run the post-deploy checks on their own"
  echo "72 : MAINTENANCE MODE: on  [site goes down]"
  echo "73 : MAINTENANCE MODE: off"
  echo "74 : LOGS: truncate the Laravel log  [discards log history]"
  echo ----------------------------------------------
  echo GET ACCESS
  echo "00 : CONNECT: to $REMOTE"
  echo "01 : RSYNC: ssh settings and dotfiles to remote"
  echo "02 : RSYNC: copy rm.sh to remote"
  echo "03 : SETUP BACKUP: copy bk.sh to remote"
  echo "04 : ANSIBLE: scan"
  echo "05 : MONITOR: remote top"
  echo "06 : TERMINATE ACCESS: delete remote ssh directory"
  echo ----------------------------------------------
  echo SETUP REMOTE SYSTEM
  echo "07 : Update REMOTE to latest packages"
  echo "08 : INSTALL: python"
  echo "09 : INSTALL: ansible"
  echo "10 : SCAN Hosts with Ansible"
  echo "11 : CONNECT: hduser"
  echo ----------------------------------------------
  echo OTHER
  echo "80 : RM CMD01: run rm.sh 01 on remote"
  echo "91 : BACKUP: remote database and files"
  echo "99 : LOCAL FILE UPDATE and SECURITY SCRUB"
  echo "qq : Exit [Quit]"
  echo =============================================================
}

# Command line selection
if [ -n "$1" ]; then
  SELECTION=$1
  [ "$SELECTION" = "help" ] && { show_menu; exit 0; }
else
  show_menu
  echo Enter [Selection] to continue
  read  -n 2 SELECTION
fi
# PARAM2 is only meaningful to a few options, so it is asked for inside
# those. Reading it here ran `read -n PARAM2`, which bash rejects as an
# invalid number on every interactive run.
PARAM2="${2:-}"
echo
echo Your selection is : $SELECTION.


case "$SELECTION" in
# Note variable is quoted.

  #-------------------------------------------------------------
  # ROUTINE
  #-------------------------------------------------------------

  "20" )
  banner "DEPLOY: $PROJECT"
  # The server deploys by pulling from git, so anything not pushed is not
  # deployed. Without this check the deploy "succeeds" on the previous
  # commit and the change appears to have silently done nothing.
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo "⚠ Uncommitted local changes — these will NOT deploy:"
    git status --short
    echo
  fi
  UNPUSHED=$(git log --oneline @{u}.. 2>/dev/null)
  if [ -n "$UNPUSHED" ]; then
    echo "⚠ Commits not pushed — these will NOT deploy:"
    echo "$UNPUSHED"
    echo
    read -r -p "Push them first? [push / skip / quit]: " reply
    case "$reply" in
      push) git push || { echo "✗ push failed — nothing deployed."; exit 1; } ;;
      skip) echo "Deploying without them." ;;
      *)    echo "Skipped $SELECTION"; exit 0 ;;
    esac
  fi
  echo "Local HEAD : $(git log --oneline -1)"
  echo
  if remote_tty "./deploy.sh"; then
    log_history "Deployed $PROJECT at $(git rev-parse --short HEAD)"
    echo
    echo "--- from outside: $APP_URL ---"
    health || echo "⚠ deployed, but the site is not answering cleanly — try 32 for recent errors."
  else
    echo "✗ deploy.sh failed on the server — nothing above this line should be trusted as live."
    log_history "Deploy FAILED on $PROJECT"
    exit 1
  fi
  ;;



  "22" )
  banner "WHAT'S LIVE on $PROJECT"
  echo "--- server ---"
  remote "git log --oneline -3 && git status --short"
  echo
  echo "--- local ---"
  git log --oneline -3
  echo
  LOCAL_HEAD=$(git rev-parse HEAD 2>/dev/null)
  SERVER_HEAD=$(remote "git rev-parse HEAD" 2>/dev/null | tr -d '\r')
  if [ "$LOCAL_HEAD" = "$SERVER_HEAD" ]; then
    echo "✓ server matches local HEAD"
  else
    echo "✗ server is NOT on your local HEAD"
    echo "  local : $LOCAL_HEAD"
    echo "  server: $SERVER_HEAD"
  fi
  ;;


  "23" )
  banner "MIGRATIONS: status on $PROJECT"
  # A pull without a migrate is the classic cause of a production 500
  # ("Base table or view not found"), so this is the check for it.
  remote "php artisan migrate:status"
  ;;


  "24" )
  banner "CACHES: refresh on $PROJECT"
  remote "php artisan optimize"
  log_history "Refreshed caches on $PROJECT"
  ;;


  "25" )
  banner "CACHES: clear everything on $PROJECT"
  # The counterpart to 24. optimize:clear drops the config, route, view and
  # event caches; a stale config cache is why an .env change can appear to
  # have been ignored. deploy.sh rebuilds them, so run 24 after this.
  remote "php artisan optimize:clear"
  log_history "Cleared all caches on $PROJECT"
  ;;


  "26" )
  banner "COMPOSER: install production dependencies"
  # deploy.sh now does this itself whenever composer.lock moves. This is for
  # the case where it warned that composer was not on PATH, or where a
  # dependency needs reinstalling without a deploy.
  remote_tty "composer install --no-dev --optimize-autoloader --no-interaction"
  log_history "Installed composer dependencies on $PROJECT"
  ;;


  "27" )
  banner "FIRST-TIME SETUP: $PROJECT on $REMOTE"
  [ -n "$REPO_URL" ] || { echo "✗ No REPO_URL in vars.sh and no git remote here."; exit 1; }
  echo "Repository : $REPO_URL ($REPO_BRANCH)"
  echo "App root   : ~/$REMOTE_APP   (document root must be ~/$REMOTE_APP/public_html)"
  confirm "If ~/$REMOTE_APP/public_html already holds the host's placeholder files, tracked files there are replaced by the repo's."
  # Hosts usually pre-create the site directory with a public_html inside,
  # and git refuses to clone into a non-empty directory — so this fetches
  # into it instead. An existing checkout or .env is left alone.
  $APP_SSH -t "$REMOTE" "set -e
    mkdir -p ~/$REMOTE_APP && cd ~/$REMOTE_APP
    if [ ! -d .git ]; then
      git init -q && git remote add origin '$REPO_URL'
      git fetch -q origin '$REPO_BRANCH' && git checkout -q -f -B '$REPO_BRANCH' 'origin/$REPO_BRANCH'
      git branch -q --set-upstream-to='origin/$REPO_BRANCH'
      echo '✓ repository checked out'
    else
      echo '✓ repository already present'
    fi
    if [ ! -f .env ]; then
      sed -e 's|^APP_ENV=.*|APP_ENV=production|' -e 's|^APP_DEBUG=.*|APP_DEBUG=false|' -e 's|^APP_URL=.*|APP_URL=$APP_URL|' .env.example > .env
      chmod 600 .env
      NEW_ENV=1
      echo '✓ .env created for production'
    else
      echo '✓ .env already present — left as it is'
    fi
    if [ ! -f vendor/autoload.php ]; then composer install --no-dev --optimize-autoloader --no-interaction; fi
    if [ -n \"\$NEW_ENV\" ]; then php artisan key:generate --force; fi
    chmod +x deploy.sh
    ./deploy.sh"
  log_history "First-time setup of $PROJECT"
  ;;


  "28" )
  banner "ROLLBACK: $PROJECT"
  # deploy.sh records the commit each deploy started from and asks for its
  # own confirmation. Code only — it says so, and points at the snapshots.
  remote_tty "./deploy.sh --rollback"
  log_history "Rolled back $PROJECT"
  ;;


  #-------------------------------------------------------------
  # DIAGNOSE
  #-------------------------------------------------------------

  "30" )
  banner "HEALTH: $APP_URL"
  health && echo "✓ all good" || echo "✗ something is not answering — 32 shows recent errors, 70 runs the server-side checks."
  ;;


  "31" )
  banner "LOGS: tail on $PROJECT (Ctrl-C to stop)"
  remote_tty "tail -n 40 -f storage/logs/laravel.log"
  ;;


  "32" )
  banner "LOGS: recent errors on $PROJECT"
  # Stack traces are noise; the ERROR lines and the exception message
  # immediately after them are what identifies the fault.
  remote "grep -nE '\.(ERROR|CRITICAL|ALERT|EMERGENCY):' storage/logs/laravel.log | tail -n 25" \
    || echo "No matching lines (or no log file yet)."
  ;;


  "33" )
  banner "ARTISAN on $PROJECT"
  need_param "artisan command (without the word 'artisan')"
  # On some shared hosts the SSH php is the cgi-fcgi binary, where
  # interactive commands like tinker die; non-interactive ones are fine.
  remote_tty "php artisan $PARAM2"
  log_history "Ran artisan $PARAM2 on $PROJECT"
  ;;


  "34" )
  banner "CONFIG on $PROJECT"
  # Values are deliberately not printed for anything that looks like a
  # secret — this runs in a terminal that scrolls back.
  echo "--- environment ---"
  remote "grep -E '^(APP_ENV|APP_DEBUG|APP_URL|SESSION_DRIVER|CACHE_STORE|QUEUE_CONNECTION|MAIL_MAILER|DB_CONNECTION)=' .env | sort"
  echo
  echo "--- keys present (values hidden) ---"
  remote "grep -oE '^[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)[A-Z_]*=' .env | tr -d '=' | sort | sed 's/^/  /'"
  ;;


  "35" )
  banner "DISK: quota and the biggest directories"
  # Shared hosting has a hard quota, and the usual cause of filling it is a
  # log or a backup directory nobody is watching.
  remote "du -sh . 2>/dev/null; echo; echo 'largest directories:'; du -sh */ 2>/dev/null | sort -rh | head -12"
  ;;


  "36" )
  banner "LOGS: sizes on $PROJECT"
  remote "ls -lh storage/logs/ 2>/dev/null | tail -n +2; echo; echo 'total:'; du -sh storage/logs 2>/dev/null"
  ;;



  #-------------------------------------------------------------
  # GAME
  #-------------------------------------------------------------

  "40" )
  banner "LEADERBOARD: $APP_URL"
  # Read through the public endpoint the game itself uses, so this also
  # proves the route, the database and the scores table are all working.
  curl -sS --max-time 25 -H 'Accept: application/json' "$APP_URL/scores" \
    | (python3 -m json.tool 2>/dev/null || cat) || echo "✗ no response"
  echo
  ;;






  "41" )
  banner "LEADERBOARD: download from $PROJECT"
  # The scores exist only in this one SQLite file on the server.
  mkdir -p ./files
  DEST="./files/scores-$(date +%Y%m%d-%H%M%S).sqlite"
  if $APP_SCP "$REMOTE:~/$REMOTE_APP/database/database.sqlite" "$DEST"; then
    echo "✓ saved $DEST ($(du -h "$DEST" | cut -f1))"
    command -v sqlite3 >/dev/null 2>&1 && sqlite3 "$DEST" "select count(*) || ' scores, best ' || coalesce(max(score), 0) from scores;"
    log_history "Downloaded leaderboard to $DEST"
  else
    echo "✗ download failed — is DB_CONNECTION still sqlite on the server? (34 shows it)"
  fi
  ;;


  "42" )
  banner "LEADERBOARD: snapshots on $PROJECT"
  # Taken by deploy.sh before each migrate; named by time and the commit
  # the deploy started from. Restore by copying one over database.sqlite.
  remote "ls -lh storage/app/backups/ 2>/dev/null | tail -n +2 || echo 'No snapshots yet.'"
  ;;


  #-------------------------------------------------------------
  # QUEUE & SCHEDULE
  #-------------------------------------------------------------

  "50" )
  banner "QUEUE: failed jobs"
  remote "php artisan queue:failed"
  ;;


  "51" )
  banner "QUEUE: retry all failed jobs"
  remote_tty "php artisan queue:retry all"
  log_history "Retried failed jobs on $PROJECT"
  ;;


  "52" )
  banner "QUEUE: drain now"
  # --stop-when-empty so it exits instead of daemonising.
  remote_tty "php artisan queue:work database --stop-when-empty --max-time=120"
  ;;


  "53" )
  banner "SCHEDULE on $PROJECT"
  remote "php artisan schedule:list"
  ;;






  #-------------------------------------------------------------
  # MAINTENANCE
  #-------------------------------------------------------------

  "70" )
  banner "VERIFY: post-deploy checks on $PROJECT"
  # The same checks deploy.sh ends with — .env, migrations, writable
  # storage, game assets in public_html and production safety.
  remote "./deploy.sh --verify"
  ;;



  "72" )
  banner "MAINTENANCE MODE: ON"
  confirm "$APP_URL will start returning 503 to everyone until you run 73."
  # --retry sets Retry-After so crawlers come back rather than de-indexing.
  remote_tty "php artisan down --retry=60"
  log_history "Maintenance mode ON for $PROJECT"
  ;;


  "73" )
  banner "MAINTENANCE MODE: OFF"
  remote_tty "php artisan up"
  log_history "Maintenance mode OFF for $PROJECT"
  ;;


  "74" )
  banner "LOGS: truncate the Laravel log"
  confirm "This discards the Laravel log on $PROJECT. Run 36 first if you want to know how big it is, and 32 if you have not read the recent errors."
  # Truncated in place rather than deleted: removing the file loses the
  # permissions the web user needs to recreate it.
  remote "test -f storage/logs/laravel.log && : > storage/logs/laravel.log && echo 'laravel.log truncated.' || echo 'No laravel.log to truncate.'"
  log_history "Truncated the Laravel log on $PROJECT"
  ;;


  #-------------------------------------------------------------
  # ACCESS AND SETUP
  #-------------------------------------------------------------

  "00" )
  banner "CONNECT: to $REMOTE"
  $APP_SSH $REMOTE
  echo Completed $SELECTION
  log_history "Connect to remote"
  ;;


  "01" )
  banner "GAIN ACCESS: Copy ssh settings from local to remote"
  $APP_SSH $REMOTE 'if [ -d ~/.ssh ]; then echo remote SSH directory exists; else echo Creating remote SSH directory; mkdir ~/.ssh/; fi'
  echo Copy authorized keys to remote
  $APP_SCP ~/.ssh/remote/$PROJECT/shell/authorized_keys  $REMOTE:~/.ssh/authorized_keys
  echo Copy known_hosts to remote
  $APP_SCP ~/.ssh/remote/$PROJECT/shell/known_hosts  $REMOTE:~/.ssh/known_hosts

  echo SECURITY: Set 700 to .ssh directory
  $APP_SSH $REMOTE 'if [ -d ~/.ssh ]; then chmod 700 ~/.ssh; fi'
  echo SECURITY: Set 600 to any private keys on remote
  $APP_SSH $REMOTE 'if [ -e ~/.ssh/id* ]; then chmod 600 ~/.ssh/id*; fi'
  echo SECURITY: Set 644 to any public keys on remote
  $APP_SSH $REMOTE 'if [ -d ~/.ssh/id*.pub ]; then chmod 644 ~/.ssh/id*.pub; fi'
  echo SECURITY: Set 600 to authorized_keys on remote. Mandatory for transparent sshing
  $APP_SSH $REMOTE 'if [ -e ~/.ssh/authorized_keys ];then chmod 600 ~/.ssh/authorized_keys;  fi'

  banner ".vimrc, .alias .bashrc .bash_logout transfered"
  $APP_SCP ~/.ssh/remote/$PROJECT/shell/.vimrc $REMOTE:~/.vimrc
  $APP_SCP ~/.ssh/remote/$PROJECT/shell/.alias $REMOTE:~/.alias
  $APP_SCP ~/.ssh/remote/$PROJECT/shell/.bashrc $REMOTE:~/.bashrc
  $APP_SCP ~/.ssh/remote/$PROJECT/shell/.bash_logout $REMOTE:~/.bash_logout

  banner ".bash_profile updated"
  $APP_SSH $REMOTE 'echo "source ~/.alias" >> ~/.bash_profile'
  echo Completed $SELECTION
  log_history "GAIN ACCESS: Copy ssh settings from local to remote"
  ;;


  "02" )
  banner "GAIN CONTROL: Copy rm.sh to remote"
  $APP_SSH $REMOTE "if [ -d ~/$PROJECT/source ]; then echo remote SOURCE directory exists; else echo Creating remote SOURCE directory; mkdir -p ~/$PROJECT/source/; fi"
  $APP_SCP ~/.ssh/remote/$PROJECT/rm.sh  $REMOTE:~/.ssh/rm.sh
  $APP_SCP ~/.ssh/remote/$PROJECT/vars.sh  $REMOTE:~/.ssh/vars.sh
  echo SECURITY: Set 754 to rm.sh on remote. Enables execution
  $APP_SSH $REMOTE 'if [ -e ~/.ssh/rm.sh ];then chmod 754 ~/.ssh/rm.sh;  fi'
  echo Completed $SELECTION rm.sh to remote
  log_history "GAIN CONTROL: Copy rm.sh to remote"
  ;;


  "03" )
  banner "BACKUP CAPABILITY: Copy backup script bk.sh from local to remote"
  # Double-quoted so $PROJECT expands here. Single-quoted, it reached the
  # server as a literal and the test ran against ~/www//backup.
  # APP_SSH/APP_SCP already carry the port, so it is not repeated.
  $APP_SSH $REMOTE "mkdir -p ~/$REMOTE_APP/backup && chmod 700 ~/$REMOTE_APP/backup"
  $APP_SCP ~/.ssh/remote/$PROJECT/bk.sh   $REMOTE:~/$REMOTE_APP/bk.sh
  $APP_SCP ~/.ssh/remote/$PROJECT/vars.sh $REMOTE:~/$REMOTE_APP/vars.sh
  $APP_SSH $REMOTE "if [ -e ~/$REMOTE_APP/bk.sh ]; then chmod 755 ~/$REMOTE_APP/bk.sh; fi"
  echo Completed $SELECTION bk.sh to remote
  log_history "BACKUP CAPABILITY: Copy backup script bk.sh from local to remote"
  ;;


  "04" )
  banner "ANSIBLE: Scan"
  $APP_ANSIBLE -u $ANSIBLE_USER -i $ANSIBLE_INVENTORY $ANSIBLE_CLUSTER -m setup -v
  echo Completed $SELECTION Ansible Scan
  ;;


  "05" )
  banner "MONITOR: Remote Top"
  $APP_SSH -t $REMOTE 'top'
  echo Completed $SELECTION Remote TOP
  ;;


  "06" )
  banner "TERMINATE ACCESS: Delete remote ssh directory"
  echo "⚠ This wipes EVERY file in the remote ~/.ssh, including"
  echo "  authorized_keys — you may lock yourself out of $REMOTE."
  read -r -p "Type 'yes' to continue: " confirm
  if [ "$confirm" = "yes" ]; then
    $APP_SSH $REMOTE 'cd ~/.ssh/ && rm -f *'
    echo Completed $SELECTION : Terminate remote ssh settings
  else
    echo Skipped $SELECTION
  fi
  ;;


  "07" )
  banner "UPDATE Remote: latest package cache"
  $APP_SSH $REMOTE 'date && sudo apt-get update' | tee /dev/tty >> $LOG_OUTPUT
  echo Completed $SELECTION : Update Remote apt-get update cache
  ;;

  "08" )
  banner "INSTALL Python on remote"
  $APP_SSH $REMOTE 'date && sudo apt-cache show python' | tee /dev/tty >> $LOG_OUTPUT
  $APP_SSH $REMOTE 'date && sudo apt-cache show python3' | tee /dev/tty >> $LOG_OUTPUT
  echo Completed $SELECTION : Install Python
  ;;


  "09" )
  banner "INSTALL Ansible on remote"
  $APP_SSH $REMOTE 'date && sudo apt-get install ansible' | tee /dev/tty >> $LOG_OUTPUT
  echo Completed $SELECTION : Install Ansible
  ;;


  "10" )
  banner "SCAN Hosts with Ansible"
  $APP_ANSIBLE -u $ANSIBLE_USER -i $ANSIBLE_INVENTORY $ANSIBLE_CLUSTER -m setup -v
  ;;


  "11" )
  banner "CONNECT: hduser@$REMOTE_HOST"
  $APP_SSH hduser@$REMOTE_HOST
  echo Completed $SELECTION: CONNECT hduser
  ;;


  "80" )
  banner "REMOTE Shell via rm.sh"
  $APP_SSH $REMOTE '~/.ssh/rm.sh 01'
  ;;


  "91" )
  banner "BACKUP: database and files"
  need_param "Backup description"
  # Run from where option 03 puts it. These two paths disagreed, so the
  # backup could never find the script.
  $APP_SSH -t "$REMOTE" "~/$REMOTE_APP/bk.sh 01 '$PARAM2'"
  $APP_SSH -t "$REMOTE" "~/$REMOTE_APP/bk.sh 02 '$PARAM2'"
  log_history "Backup database and files: $PARAM2"
  ;;


  "99" )
  banner "LOCAL FILE UPDATE and SECURITY SCRUB"
  START_PWD="$PWD"
  for d in shell log files; do
    [ -d "$d" ] || mkdir "$d"
  done
  touch ./log/history.log
  cp $LOCAL_SCRIPTS_DEFAULT/README.txt .
  cp $LOCAL_SCRIPTS_DEFAULT/shell/.alias ./shell
  cp $LOCAL_SCRIPTS_DEFAULT/shell/.vimrc ./shell
  cp $LOCAL_SCRIPTS_DEFAULT/shell/.bashrc ./shell
  cp $LOCAL_SCRIPTS_DEFAULT/shell/.bash_logout ./shell
  cp $LOCAL_SCRIPTS_DEFAULT/shell/authorized_keys ./shell
  cp $LOCAL_SCRIPTS_DEFAULT/shell/known_hosts ./shell
  cp $LOCAL_SCRIPTS_DEFAULT/rm.sh .
  cp $LOCAL_SCRIPTS_DEFAULT/bk.sh .
  cp $LOCAL_SCRIPTS_DEFAULT/mm.sh .

  # Cleanup: remove only stray copies of the files this block handles.
  # (This was `rm .*` + bare `rm authorized_keys`, which matched every
  # dotfile in the working directory — running it from a project root
  # deleted .env, .gitignore and friends.)
  for stray in .alias .vimrc .bashrc .bash_logout authorized_keys known_hosts; do
    [ -f "./$stray" ] && rm -f "./$stray"
  done

  # TODO: Disable execution for bk.sh, rm.sh and vars.sh. Only enabled on remote

  chmod 700 ~/.ssh
  # Globbed with a guard: with no matching keys these chmods errored.
  for k in ~/.ssh/id*; do
    [ -f "$k" ] || continue
    case "$k" in
      *.pub) chmod 644 "$k" ;;
      *)     chmod 600 "$k" ;;
    esac
  done
  if [ -e ~/.ssh/authorized_keys ]; then
    chmod 600 ~/.ssh/authorized_keys
  fi
  cd "$START_PWD"
  log_history "Refreshed files from Default"
  ;;


  # Attempt to cater for ESC
  "\x1B" )
  echo ESC1
  exit 0
  ;;


  # Attempt to cater for ESC
  "^[" )
  echo ESC2
  exit 0
  ;;


  "qq" )
  echo Quit
  exit 0
  ;;


   * )
   # Default option.
   # Empty input (hitting RETURN) fits here, too.
   echo
   echo "Not a recognized option."
  ;;

esac
