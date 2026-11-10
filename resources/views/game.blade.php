<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="theme-color" content="#2a0f4a">
    <title>Sweet Swap — a match-3 candy game</title>
    <link rel="stylesheet" href="{{ asset('game/game.css') }}?v={{ filemtime(public_path('game/game.css')) }}">
</head>
<body>
<div class="app">
    <header class="top">
        <h1><span class="logo">🍬</span> Sweet Swap</h1>
        <button id="mute" class="icon-btn" aria-label="Toggle sound">🔊</button>
    </header>

    <main class="layout">
        <section class="play">
            <div class="hud">
                <div class="stat"><span>Level</span><b id="level">1</b></div>
                <div class="stat wide"><span>Score</span><b id="score">0</b></div>
                <div class="stat"><span>Target</span><b id="target">0</b></div>
                <div class="stat"><span>Moves</span><b id="moves">0</b></div>
            </div>

            <div class="progress" aria-hidden="true">
                <div id="bar"></div>
                <i class="star" id="star1" style="left:50%">★</i>
                <i class="star" id="star2" style="left:75%">★</i>
                <i class="star" id="star3" style="left:100%">★</i>
            </div>

            <div class="board-wrap" id="wrap">
                <div id="board" aria-label="Game board"></div>
                <div id="fx"></div>
                <div id="banner"></div>
            </div>

            <div class="actions">
                <button id="hintBtn" class="btn ghost">💡 Hint</button>
                <button id="restart" class="btn ghost">↻ New run</button>
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
                    <li><b>4 in a row</b> makes a striped <b>Rocket</b> that clears a whole line.</li>
                    <li>An <b>L or T</b> makes a <b>Bomb</b> that blasts its neighbours.</li>
                    <li><b>5 in a row</b> makes a <b>Rainbow</b> — swap it with any candy to clear that colour.</li>
                    <li>Hit the target before you run out of moves. Chain reactions multiply your score!</li>
                </ul>
            </div>
        </aside>
    </main>
</div>

<div id="modal" class="modal"><div class="card" id="card"></div></div>
<div id="confetti" aria-hidden="true"></div>

<script src="{{ asset('game/game.js') }}?v={{ filemtime(public_path('game/game.js')) }}"></script>
</body>
</html>
