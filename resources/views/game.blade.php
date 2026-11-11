<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="theme-color" content="#2a0f4a">
    <meta name="description" content="Sweet Swap — a free match-3 candy game. Swap candies, build rockets, bombs and rainbows, and climb the leaderboard.">
    <meta property="og:title" content="Sweet Swap">
    <meta property="og:description" content="A free match-3 candy game with goals, boosters and a leaderboard.">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-title" content="Sweet Swap">
    <link rel="icon" href="{{ asset('favicon.svg') }}" type="image/svg+xml">
    <link rel="apple-touch-icon" href="{{ asset('icons/icon-180.png') }}">
    <link rel="manifest" href="{{ asset('manifest.webmanifest') }}">
    <title>Sweet Swap — a match-3 candy game</title>
    <link rel="stylesheet" href="{{ asset('game/game.css') }}?v={{ filemtime(public_path('game/game.css')) }}">
</head>
<body>
<div class="app">
    <header class="top">
        <h1><span class="logo">🍬</span> <span class="name">Sweet Swap</span></h1>
        <div class="top-actions">
            <span id="lives" class="lives" role="img" aria-label="3 of 3 lives left">❤️❤️❤️</span>
            <button id="account" class="icon-btn @if ($player) signed-in @endif"
                    aria-label="{{ $player ? 'Account: '.$player['name'] : 'Log in or create an account' }}"
                    title="{{ $player ? 'Logged in as '.$player['name'] : 'Log in or create an account' }}">{{ $player ? mb_strtoupper(mb_substr($player['name'], 0, 1)) : '👤' }}</button>
            <button id="help" class="icon-btn" aria-label="How to play" title="How to play">?</button>
            <button id="restart" class="icon-btn" aria-label="Start a new run" title="Start a new run">↻</button>
            <button id="mute" class="icon-btn" aria-label="Toggle sound" title="Sound on/off">🔊</button>
        </div>
    </header>

    <main class="layout">
        <section class="play">
            <div class="hud">
                <div class="stat"><span>Level</span><b id="level">1</b></div>
                <div class="stat"><span>Score</span><b id="score">0</b></div>
                <div class="stat wide"><span id="goalLabel">Goal</span><b id="goal"></b></div>
                <div class="stat"><span>Moves</span><b id="moves">0</b></div>
            </div>

            <div class="progress" aria-hidden="true"><div id="bar"></div></div>

            <div class="board-wrap" id="wrap">
                <div id="board" role="application" aria-label="Game board. Arrow keys move, Enter grabs a candy, an arrow then swaps it."></div>
                <div id="fx"></div>
                <div id="banner"></div>
            </div>

            <div class="actions">
                <button id="hammer" class="btn ghost" title="Smash any one candy — costs no move">🔨 Hammer <b id="hammerN">0</b></button>
                <button id="shuffle" class="btn ghost" title="Shuffle the whole board — costs no move">🔀 Shuffle <b id="shuffleN">0</b></button>
                <button id="hintBtn" class="btn ghost" title="Show the best move (H)">💡 Hint</button>
            </div>
        </section>

        <aside class="side">
            <div class="panel">
                <h2>🏆 Leaderboard</h2>
                <ol id="scores"><li class="empty">Loading…</li></ol>
                <p class="best">Your best run: <b id="best">0</b></p>
            </div>
            <div class="panel">
                <h2>How to play</h2>
                <ul class="howto">
                    <li>Swap two neighbours (drag, swipe, or tap-tap) to line up <b>3+</b> of a kind.</li>
                    <li><b>4 in a row</b> makes a striped <b>Rocket</b>, an <b>L or T</b> makes a <b>Bomb</b>, and <b>5 in a row</b> makes a <b>Rainbow</b>. Swap two specials together for a bigger bang.</li>
                    <li>Each level has a goal: reach a <b>score</b>, <b>collect</b> candies, or break the <b>frosting</b> 🧊 by matching on top of it.</li>
                    <li>Finish early and your spare moves explode in a <b>sugar finale</b> — and earn more stars.</li>
                    <li>Winning earns a <b>🔨 Hammer</b>; three stars adds a <b>🔀 Shuffle</b>. Neither costs a move.</li>
                    <li>You have <b>3 lives</b> ❤️. Running out of moves costs one and replays the level. Your run is saved if you close the page.</li>
                    <li>Keyboard: arrows move, <b>Enter</b> grabs, arrow swaps, <b>H</b> hints, <b>Esc</b> cancels.</li>
                </ul>
            </div>
        </aside>
    </main>

    <footer class="foot">
        <a href="https://nikniq.com" rel="noopener">← Back to nikniq.com</a>
    </footer>
</div>

<div id="modal" class="modal"><div class="card" id="card" role="dialog" aria-modal="true" aria-label="Game message"></div></div>
<div id="sr" class="sr-only" aria-live="polite"></div>
<div id="confetti" aria-hidden="true"></div>

<script>
    window.__user = @json($player);
    window.__best = @json($best);
</script>
<script src="{{ asset('game/game.js') }}?v={{ filemtime(public_path('game/game.js')) }}"></script>
</body>
</html>
