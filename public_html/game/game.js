/* Sweet Swap — an original match-3 candy game. No dependencies. */
(() => {
    'use strict';

    const SIZE = 8;
    const TYPES = 6;
    const FAST = !!window.__CANDY_FAST; // headless test mode: no waits, no effects
    const T = { swap: 240, pop: 260, fall: 320 };
    const COLORS = ['#ff4d6d', '#ff9a3c', '#ffd93d', '#4cd97b', '#4aa8ff', '#b56bff'];
    const CHEERS = ['', '', 'Nice!', 'Yum!', 'Sugar rush!', 'Candyquake!'];

    const $ = (id) => document.getElementById(id);
    const boardEl = $('board'), fxEl = $('fx'), bannerEl = $('banner'), wrapEl = $('wrap');
    const modalEl = $('modal'), cardEl = $('card'), confettiEl = $('confetti');

    const wait = (ms) => (FAST ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
    const rand = (n) => Math.floor(Math.random() * n);
    const key = (r, c) => r * SIZE + c;
    const rc = (k) => [Math.floor(k / SIZE), k % SIZE];
    const inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

    const store = {
        get(k) { try { return localStorage.getItem('sweetswap.' + k); } catch { return null; } },
        set(k, v) { try { localStorage.setItem('sweetswap.' + k, v); } catch { /* private mode */ } },
    };

    function h(tag, props = {}, ...kids) {
        const el = document.createElement(tag);
        Object.assign(el, props);
        kids.forEach((k) => el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k));
        return el;
    }

    /* ---------- sound ---------- */
    const sfx = (() => {
        let ctx = null;
        let muted = store.get('muted') === '1';
        const tone = (f, d, type = 'sine', v = 0.12, delay = 0, f2 = 0) => {
            if (muted || FAST) return;
            try {
                ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
                if (ctx.state === 'suspended') ctx.resume();
                const t = ctx.currentTime + delay;
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = type;
                o.frequency.setValueAtTime(f, t);
                if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
                g.gain.setValueAtTime(v, t);
                g.gain.exponentialRampToValueAtTime(0.001, t + d);
                o.connect(g); g.connect(ctx.destination);
                o.start(t); o.stop(t + d + 0.02);
            } catch { /* audio unavailable */ }
        };
        return {
            get muted() { return muted; },
            toggle() { muted = !muted; store.set('muted', muted ? '1' : '0'); return muted; },
            swap() { tone(520, 0.08, 'sine', 0.08, 0, 700); },
            bad() { tone(200, 0.16, 'square', 0.06, 0, 140); },
            tick(i) { tone(600 + i * 60, 0.09, 'triangle', 0.1); },
            crack() { tone(1400, 0.08, 'square', 0.04, 0, 2400); },
            match(combo) {
                const base = 440 * 2 ** ((Math.min(combo, 8) - 1) * 2 / 12);
                tone(base, 0.12, 'triangle');
                tone(base * 1.5, 0.18, 'triangle', 0.1, 0.07);
            },
            boom() { tone(170, 0.4, 'sawtooth', 0.16, 0, 40); tone(900, 0.25, 'triangle', 0.06, 0, 200); },
            win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 'triangle', 0.14, i * 0.12)); },
            lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.35, 'sine', 0.14, i * 0.18)); },
        };
    })();

    /* ---------- state ---------- */
    let grid = null, frost = null, frostEls = null;
    let level = 1, score = 0, shown = 0, total = 0, moves = 0, startMoves = 0, types = TYPES;
    let goal = { kind: 'score', target: 1 };
    let boosters = { hammer: 2, shuffle: 1 };
    let busy = false, over = true, combo = 1, selected = null, hintTimer = null, hinted = [];
    let armed = false, lastWon = null, raf = 0;

    const typeAt = (r, c) => (inside(r, c) && grid[r][c] ? grid[r][c].type : -1);

    /* ---------- levels ---------- */
    function frostPattern(n) {
        const variant = (Math.floor(n / 3) + 3) % 4; // level 3 starts with the easy centre block
        const on = [
            (r, c) => r >= 2 && r <= 5 && c >= 2 && c <= 5,
            (r, c) => r >= 5 && c >= 1 && c <= 6,
            (r, c) => r >= 1 && r <= 6 && (c === 1 || c === 2 || c === 5 || c === 6),
            (r, c) => Math.abs(r - 3.5) + Math.abs(c - 3.5) <= 3,
        ][variant];
        const thick = n >= 12;
        return Array.from({ length: SIZE }, (_, r) => Array.from({ length: SIZE }, (_, c) =>
            (on(r, c) ? (thick && (r + c) % 2 === 0 ? 2 : 1) : 0)));
    }

    // Levels rotate through three goals: 1 score, 2 collect, 3 frosting, 4 score, ...
    function levelCfg(n) {
        const kind = ['frost', 'score', 'collect'][n % 3];
        const cfg = { kind, moves: 20, types: n <= 2 ? 5 : 6 };
        if (kind === 'score') cfg.target = Math.min(11000, 3000 + (n - 1) * 450);
        if (kind === 'collect') {
            const k = n >= 8 ? 3 : 2;
            const each = Math.min(k === 2 ? 26 : 19, (k === 2 ? 16 : 13) + Math.floor(n / 3));
            const pool = [...Array(cfg.types).keys()];
            cfg.need = {};
            for (let i = 0; i < k; i++) cfg.need[pool.splice(rand(pool.length), 1)[0]] = each;
        }
        if (kind === 'frost') { cfg.frost = frostPattern(n); cfg.moves = n >= 12 ? 30 : 24; }
        return cfg;
    }

    function goalLeft() {
        if (goal.kind === 'score') return Math.max(0, goal.target - score);
        if (goal.kind === 'collect') return Object.values(goal.need).reduce((a, b) => a + b, 0);
        return frost.flat().reduce((a, b) => a + b, 0);
    }

    const goalMet = () => goalLeft() === 0;

    /* ---------- tiles ---------- */
    function place(t, r, c) {
        t.el.style.transform = `translate(${c * 100}%, ${r * 100}%)`;
    }

    function paint(t) {
        t.inner.className = 'candy ' + (t.special === 'rainbow' ? 'rainbow' : 'c' + t.type + (t.special ? ' sp-' + t.special : ''));
    }

    function makeTile(r, c, type, special = null, fromRow = r) {
        const inner = h('div');
        const el = h('div', { className: 'tile' }, inner);
        const t = { type, special, el, inner, fired: false, target: null };
        paint(t);
        place(t, fromRow, c);
        boardEl.appendChild(el);
        grid[r][c] = t;
        return t;
    }

    function dropIn(fresh) {
        void boardEl.offsetHeight; // commit start positions so the fall animates
        fresh.forEach(([t, r, c]) => place(t, r, c));
    }

    function buildBoard(cfg) {
        if (grid) grid.forEach((row) => row.forEach((t) => t && t.el.remove()));
        if (frostEls) frostEls.flat().forEach((el) => el && el.remove());

        frost = cfg.frost || Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
        frostEls = frost.map((row, r) => row.map((n, c) => {
            if (!n) return null;
            const el = h('div', { className: 'frost f' + n });
            el.style.left = (c * 100) / SIZE + '%';
            el.style.top = (r * 100) / SIZE + '%';
            boardEl.appendChild(el);
            return el;
        }));

        const fresh = [];
        do {
            fresh.splice(0).forEach(([t]) => t.el.remove());
            grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
            for (let r = 0; r < SIZE; r++) {
                for (let c = 0; c < SIZE; c++) {
                    let type;
                    do { type = rand(types); } while (
                        (typeAt(r, c - 1) === type && typeAt(r, c - 2) === type) ||
                        (typeAt(r - 1, c) === type && typeAt(r - 2, c) === type)
                    );
                    fresh.push([makeTile(r, c, type, null, r - SIZE - 1), r, c]);
                }
            }
        } while (!findMove());
        dropIn(fresh);
    }

    function hitFrost(r, c) {
        const el = frostEls[r][c];
        frost[r][c]--;
        sfx.crack();
        if (frost[r][c] > 0) { el.className = 'frost f' + frost[r][c]; return; }
        frostEls[r][c] = null;
        if (FAST) { el.remove(); return; }
        el.classList.add('gone');
        setTimeout(() => el.remove(), 350);
    }

    /* ---------- match finding ---------- */
    function findGroups() {
        const runs = [];
        const scan = (dir) => {
            for (let a = 0; a < SIZE; a++) {
                let b = 0;
                while (b < SIZE) {
                    const at = (i) => (dir === 'h' ? typeAt(a, i) : typeAt(i, a));
                    const t = at(b);
                    let e = b + 1;
                    while (t >= 0 && e < SIZE && at(e) === t) e++;
                    if (t >= 0 && e - b >= 3) {
                        const cells = [];
                        for (let i = b; i < e; i++) cells.push(dir === 'h' ? key(a, i) : key(i, a));
                        runs.push({ dir, cells, type: t });
                    }
                    b = e;
                }
            }
        };
        scan('h'); scan('v');

        let groups = [];
        for (const run of runs) {
            const merged = { cells: new Set(run.cells), runs: [run], type: run.type };
            groups = groups.filter((g) => {
                if (!run.cells.some((k) => g.cells.has(k))) return true;
                g.cells.forEach((k) => merged.cells.add(k));
                merged.runs.push(...g.runs);
                return false;
            });
            groups.push(merged);
        }
        return groups;
    }

    function specialFor(g, pref) {
        const longest = g.runs.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
        const hRun = g.runs.find((r) => r.dir === 'h'), vRun = g.runs.find((r) => r.dir === 'v');
        let special = null, pos = longest.cells[Math.floor(longest.cells.length / 2)];
        if (longest.cells.length >= 5) special = 'rainbow';
        else if (hRun && vRun) { special = 'bomb'; pos = hRun.cells.find((k) => vRun.cells.includes(k)) ?? pos; }
        else if (longest.cells.length === 4) special = longest.dir;
        if (!special) return null;
        const p = pref.find((k) => g.cells.has(k));
        if (p !== undefined) pos = p;
        return { k: pos, special, type: special === 'rainbow' ? -1 : g.type };
    }

    function matchAt(r, c) {
        const t = typeAt(r, c);
        if (t < 0) return false;
        let a = c, b = c;
        while (typeAt(r, a - 1) === t) a--;
        while (typeAt(r, b + 1) === t) b++;
        if (b - a >= 2) return true;
        a = b = r;
        while (typeAt(a - 1, c) === t) a--;
        while (typeAt(b + 1, c) === t) b++;
        return b - a >= 2;
    }

    function rawSwap(a, b) {
        const t = grid[a.r][a.c];
        grid[a.r][a.c] = grid[b.r][b.c];
        grid[b.r][b.c] = t;
    }

    function eachPair(fn) {
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                for (const [dr, dc] of [[0, 1], [1, 0]]) {
                    const a = { r, c }, b = { r: r + dr, c: c + dc };
                    if (inside(b.r, b.c) && grid[a.r][a.c] && grid[b.r][b.c] && fn(a, b) === false) return;
                }
            }
        }
    }

    const isCombo = (ta, tb) => ta.special === 'rainbow' || tb.special === 'rainbow' || !!(ta.special && tb.special);

    function findMove() {
        let found = null;
        eachPair((a, b) => {
            let ok = isCombo(grid[a.r][a.c], grid[b.r][b.c]);
            if (!ok) {
                rawSwap(a, b);
                ok = matchAt(a.r, a.c) || matchAt(b.r, b.c);
                rawSwap(a, b);
            }
            if (ok) { found = [a, b]; return false; }
        });
        return found;
    }

    // The move that helps the current goal most; used for hints.
    function bestMove() {
        let best = null, bestVal = 0;
        eachPair((a, b) => {
            let val = 0;
            if (isCombo(grid[a.r][a.c], grid[b.r][b.c])) val = 14;
            else {
                rawSwap(a, b);
                if (matchAt(a.r, a.c) || matchAt(b.r, b.c)) {
                    for (const g of findGroups()) {
                        val += g.cells.size + (g.cells.size >= 4 ? 4 : 0);
                        for (const k of g.cells) {
                            const [r, c] = rc(k);
                            if (frost[r][c]) val += 3;
                            if (grid[r][c].special) val += 3;
                        }
                        if (goal.kind === 'collect' && goal.need[g.type] > 0) val += 2 * g.cells.size;
                    }
                }
                rawSwap(a, b);
            }
            if (val > bestVal) { bestVal = val; best = [a, b]; }
        });
        return best;
    }

    /* ---------- effects ---------- */
    const pct = (i) => ((i + 0.5) * 100) / SIZE + '%';

    function fx(className, style, text, life) {
        if (FAST) return;
        const el = h('div', { className });
        if (text) el.textContent = text;
        Object.entries(style).forEach(([k, v]) => el.style.setProperty(k, v));
        fxEl.appendChild(el);
        setTimeout(() => el.remove(), life);
    }

    function particles(r, c, type) {
        const color = type < 0 ? '#ffffff' : COLORS[type];
        for (let i = 0; i < 5; i++) {
            const ang = Math.random() * Math.PI * 2, dist = 30 + Math.random() * 50;
            fx('spark', {
                left: pct(c), top: pct(r), background: color,
                '--dx': Math.cos(ang) * dist + 'px', '--dy': Math.sin(ang) * dist + 'px',
            }, '', 600);
        }
    }

    function retrigger(el, cls) {
        if (FAST) return;
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
    }

    function banner(text) {
        if (FAST) return;
        bannerEl.textContent = text;
        retrigger(bannerEl, 'show');
    }

    function confetti() {
        if (FAST) return;
        for (let i = 0; i < 90; i++) {
            const el = h('i');
            el.style.setProperty('left', Math.random() * 100 + '%');
            el.style.setProperty('background', COLORS[rand(TYPES)]);
            el.style.setProperty('animation-delay', Math.random() * 0.8 + 's');
            el.style.setProperty('animation-duration', 1.8 + Math.random() * 1.6 + 's');
            confettiEl.appendChild(el);
            setTimeout(() => el.remove(), 4500);
        }
    }

    /* ---------- HUD ---------- */
    function tweenScore() {
        const el = $('score');
        if (FAST) { el.textContent = String(score); return; }
        cancelAnimationFrame(raf);
        const step = () => {
            const d = score - shown;
            shown = Math.abs(d) < 2 ? score : shown + Math.ceil(d * 0.18);
            el.textContent = shown.toLocaleString();
            if (shown !== score) raf = requestAnimationFrame(step);
        };
        step();
    }

    function chip(type, n) {
        return h('span', { className: 'chip' + (n === 0 ? ' done' : '') },
            h('i', { className: 'mini' }, h('i', { className: 'candy c' + type })),
            n === 0 ? '✓' : String(n));
    }

    function updateHud(bump) {
        $('level').textContent = level;
        $('moves').textContent = moves;
        $('moves').classList.toggle('low', moves <= 5 && !over);
        tweenScore();
        if (bump) retrigger($('score'), 'bump');

        const left = goalLeft();
        const g = $('goal');
        if (goal.kind === 'score') g.replaceChildren(h('span', { className: 'chip' }, '🎯 ' + goal.target.toLocaleString()));
        else if (goal.kind === 'collect') g.replaceChildren(...Object.entries(goal.need).map(([t, n]) => chip(Number(t), n)));
        else g.replaceChildren(h('span', { className: 'chip' + (left ? '' : ' done') }, '🧊 ' + (left || '✓')));
        $('bar').style.width = Math.min(100, (1 - left / goal.total) * 100) + '%';
    }

    function renderBoosters() {
        $('hammerN').textContent = boosters.hammer;
        $('shuffleN').textContent = boosters.shuffle;
        $('hammer').disabled = boosters.hammer <= 0;
        $('shuffle').disabled = boosters.shuffle <= 0;
        $('hammer').classList.toggle('active', armed);
        boardEl.classList.toggle('smash', armed);
    }

    /* ---------- clearing ---------- */
    function commonType(kill) {
        const n = Array(TYPES).fill(0);
        for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
            const t = grid[r][c];
            if (t && t.type >= 0 && !kill.has(key(r, c))) n[t.type]++;
        }
        return n.indexOf(Math.max(...n));
    }

    async function blast(kill, spawns = []) {
        const queue = [...kill];
        const add = (r, c) => {
            const k = key(r, c);
            if (inside(r, c) && !kill.has(k)) { kill.add(k); queue.push(k); }
        };
        let big = false;
        while (queue.length) {
            const [r, c] = rc(queue.pop());
            const t = grid[r][c];
            if (!t || !t.special || t.fired) continue;
            t.fired = true; big = true;
            if (t.special === 'h') {
                for (let i = 0; i < SIZE; i++) add(r, i);
                fx('beam h', { top: (r * 100) / SIZE + '%' }, '', 450);
            } else if (t.special === 'v') {
                for (let i = 0; i < SIZE; i++) add(i, c);
                fx('beam v', { left: (c * 100) / SIZE + '%' }, '', 450);
            } else if (t.special === 'bomb') {
                for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) add(r + dr, c + dc);
                fx('ring', { left: pct(c), top: pct(r) }, '', 500);
            } else {
                const tt = t.target ?? commonType(kill);
                for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE; j++) if (typeAt(i, j) === tt) add(i, j);
                fx('ring wide', { left: pct(c), top: pct(r) }, '', 600);
            }
        }

        const dead = [];
        let sr = 0, sc = 0;
        for (const k of kill) {
            const [r, c] = rc(k);
            const t = grid[r][c];
            if (!t) continue;
            t.inner.classList.add('pop');
            if (!FAST) particles(r, c, t.type);
            if (goal.kind === 'collect' && goal.need[t.type] > 0) goal.need[t.type]--;
            if (frost[r][c] > 0) hitFrost(r, c);
            grid[r][c] = null;
            dead.push(t.el);
            sr += r; sc += c;
        }
        if (!dead.length) return;
        const gained = dead.length * 60 * combo;
        score += gained;
        updateHud(true);
        fx('popup', { left: pct(sc / dead.length), top: pct(sr / dead.length) }, '+' + gained.toLocaleString(), 900);
        if (big) { sfx.boom(); retrigger(wrapEl, 'shake'); } else sfx.match(combo);

        await wait(T.pop);
        dead.forEach((el) => el.remove());
        for (const s of spawns) {
            const [r, c] = rc(s.k);
            if (!grid[r][c]) makeTile(r, c, s.type, s.special).inner.classList.add('spawn');
        }
    }

    async function clearGroups(groups, pref) {
        const kill = new Set(), spawns = [];
        for (const g of groups) {
            g.cells.forEach((k) => kill.add(k));
            const s = specialFor(g, pref);
            if (s) spawns.push(s);
        }
        await blast(kill, spawns);
    }

    async function collapse() {
        const fresh = [];
        for (let c = 0; c < SIZE; c++) {
            let write = SIZE - 1;
            for (let r = SIZE - 1; r >= 0; r--) {
                const t = grid[r][c];
                if (!t) continue;
                if (r !== write) { grid[write][c] = t; grid[r][c] = null; place(t, write, c); }
                write--;
            }
            const n = write + 1;
            for (let r = write; r >= 0; r--) fresh.push([makeTile(r, c, rand(types), null, r - n), r, c]);
        }
        dropIn(fresh);
        await wait(T.fall);
    }

    async function cascade() {
        for (;;) {
            const groups = findGroups();
            if (!groups.length) return;
            combo++;
            banner(CHEERS[Math.min(combo, CHEERS.length - 1)] + ' ×' + combo);
            await clearGroups(groups, []);
            await collapse();
        }
    }

    async function shuffle(text) {
        banner(text);
        const tiles = grid.flat();
        for (let tries = 0; tries < 200; tries++) {
            for (let i = tiles.length - 1; i > 0; i--) {
                const j = rand(i + 1);
                [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
            }
            tiles.forEach((t, i) => { grid[Math.floor(i / SIZE)][i % SIZE] = t; });
            if (!findGroups().length && findMove()) break;
        }
        tiles.forEach((t, i) => place(t, Math.floor(i / SIZE), i % SIZE));
        await wait(450);
        combo = 1;
        await cascade(); // only matters if no clean arrangement was found
    }

    // Goal met with moves to spare: each spare move becomes a special, then they all go off.
    async function finale() {
        banner('Sugar finale!');
        await wait(900);
        const plain = grid.flat().filter((t) => !t.special);
        for (let i = 0; moves > 0; i++) {
            moves--;
            const t = plain.length ? plain.splice(rand(plain.length), 1)[0] : null;
            if (t) {
                t.special = ['h', 'v', 'bomb'][rand(3)];
                paint(t);
                t.inner.classList.add('spawn');
            } else score += 500;
            sfx.tick(i);
            updateHud();
            await wait(110);
        }
        await wait(350);
        for (let round = 0; round < 6; round++) {
            const kill = new Set();
            grid.forEach((row, r) => row.forEach((t, c) => { if (t.special) kill.add(key(r, c)); }));
            if (!kill.size) break;
            combo = 1;
            await blast(kill);
            await collapse();
            await cascade();
        }
    }

    // Runs after any action that cleared candies: gravity, chains, then win/lose checks.
    async function settle() {
        await collapse();
        await cascade();
        if (goalMet()) {
            const spare = moves / startMoves;
            const stars = spare >= 0.3 ? 3 : spare >= 0.12 ? 2 : 1;
            over = true;
            if (moves > 0) await finale();
            busy = false;
            endLevel(true, stars);
            return;
        }
        if (moves <= 0) { busy = false; endLevel(false, 0); return; }
        if (!findMove()) await shuffle('No moves — shuffling!');
        busy = false;
        armHint();
    }

    /* ---------- moves ---------- */
    function swapTiles(a, b) {
        rawSwap(a, b);
        place(grid[a.r][a.c], a.r, a.c);
        place(grid[b.r][b.c], b.r, b.c);
    }

    async function trySwap(a, b) {
        if (busy || over) return;
        busy = true;
        clearHint(); select(null);
        const ta = grid[a.r][a.c], tb = grid[b.r][b.c];
        swapTiles(a, b); // ta now sits at b, tb at a
        sfx.swap();
        await wait(T.swap);

        combo = 1;
        let acted = true;
        if (ta.special === 'rainbow' && tb.special === 'rainbow') {
            const all = new Set();
            for (let i = 0; i < SIZE * SIZE; i++) all.add(i);
            ta.fired = tb.fired = true;
            banner('Rainbow storm!');
            await blast(all);
        } else if (ta.special === 'rainbow' || tb.special === 'rainbow') {
            const bow = ta.special === 'rainbow' ? ta : tb, other = bow === ta ? tb : ta;
            bow.target = other.type;
            if (other.special) {
                // Rainbow + special: every candy of that colour becomes the same special.
                grid.flat().forEach((t) => {
                    if (t.type !== other.type || t.special) return;
                    t.special = other.special === 'bomb' ? 'bomb' : (rand(2) ? 'h' : 'v');
                    paint(t);
                });
                await wait(350);
            }
            await blast(new Set([bow === ta ? key(b.r, b.c) : key(a.r, a.c)]));
        } else if (ta.special && tb.special) {
            await blast(new Set([key(a.r, a.c), key(b.r, b.c)]));
        } else {
            const groups = findGroups();
            if (groups.length) await clearGroups(groups, [key(b.r, b.c), key(a.r, a.c)]);
            else acted = false;
        }

        if (!acted) {
            swapTiles(a, b);
            sfx.bad();
            await wait(T.swap);
            busy = false;
            armHint();
            return;
        }

        moves--;
        updateHud();
        await settle();
    }

    /* ---------- boosters ---------- */
    async function smash(p) {
        if (busy || over || boosters.hammer <= 0) return;
        busy = true;
        armed = false;
        boosters.hammer--;
        renderBoosters();
        clearHint(); select(null);
        combo = 1;
        await blast(new Set([key(p.r, p.c)]));
        await settle();
    }

    async function useShuffle() {
        if (busy || over || boosters.shuffle <= 0) return;
        busy = true;
        boosters.shuffle--;
        armed = false;
        renderBoosters();
        clearHint(); select(null);
        await shuffle('Shuffle!');
        busy = false;
        armHint();
    }

    /* ---------- hints & selection ---------- */
    function clearHint() {
        clearTimeout(hintTimer);
        hinted.forEach((el) => el.classList.remove('hint'));
        hinted = [];
    }

    function showHint() {
        if (busy || over) return;
        clearHint();
        const m = bestMove();
        if (!m) return;
        hinted = m.map((p) => grid[p.r][p.c].el);
        hinted.forEach((el) => el.classList.add('hint'));
    }

    function armHint() {
        clearHint();
        if (!FAST) hintTimer = setTimeout(showHint, 6000);
    }

    function select(p) {
        if (selected && grid[selected.r][selected.c]) grid[selected.r][selected.c].el.classList.remove('selected');
        selected = p;
        if (p) grid[p.r][p.c].el.classList.add('selected');
    }

    /* ---------- pointer input ---------- */
    let drag = null;

    function cellAt(e) {
        const rect = boardEl.getBoundingClientRect();
        const c = Math.floor(((e.clientX - rect.left) / rect.width) * SIZE);
        const r = Math.floor(((e.clientY - rect.top) / rect.height) * SIZE);
        return inside(r, c) ? { r, c, size: rect.width / SIZE } : null;
    }

    boardEl.addEventListener('pointerdown', (e) => {
        if (busy || over) return;
        const p = cellAt(e);
        if (!p) return;
        e.preventDefault();
        if (armed) { smash(p); return; }
        drag = { ...p, x: e.clientX, y: e.clientY };
    });

    window.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < drag.size * 0.35) return;
        const a = { r: drag.r, c: drag.c };
        const b = Math.abs(dx) > Math.abs(dy)
            ? { r: a.r, c: a.c + Math.sign(dx) }
            : { r: a.r + Math.sign(dy), c: a.c };
        drag = null;
        if (inside(b.r, b.c)) trySwap(a, b);
    });

    window.addEventListener('pointerup', () => {
        if (!drag) return;
        const p = { r: drag.r, c: drag.c };
        drag = null;
        if (busy || over) return;
        if (selected && Math.abs(selected.r - p.r) + Math.abs(selected.c - p.c) === 1) trySwap(selected, p);
        else if (selected && selected.r === p.r && selected.c === p.c) select(null);
        else { clearHint(); select(p); armHint(); }
    });

    window.addEventListener('pointercancel', () => { drag = null; });

    /* ---------- keyboard input ---------- */
    const cursorEl = h('div', { className: 'cursor' });
    fxEl.appendChild(cursorEl);
    const cur = { r: 3, c: 3, grab: false, on: false };
    const DIRS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

    function drawCursor() {
        cursorEl.style.left = (cur.c * 100) / SIZE + '%';
        cursorEl.style.top = (cur.r * 100) / SIZE + '%';
        cursorEl.classList.toggle('on', cur.on);
        cursorEl.classList.toggle('grab', cur.grab);
    }

    window.addEventListener('keydown', (e) => {
        const tag = e.target && e.target.tagName;
        if (over || tag === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
        const d = DIRS[e.key];
        if (d) {
            e.preventDefault();
            const nr = cur.r + d[0], nc = cur.c + d[1];
            if (!cur.on) cur.on = true;
            else if (cur.grab) {
                cur.grab = false;
                if (inside(nr, nc)) trySwap({ r: cur.r, c: cur.c }, { r: nr, c: nc });
            } else if (inside(nr, nc)) { cur.r = nr; cur.c = nc; }
            drawCursor();
        } else if ((e.key === 'Enter' || e.key === ' ') && tag !== 'BUTTON' && cur.on) {
            e.preventDefault();
            if (armed) smash({ r: cur.r, c: cur.c });
            else if (!busy) cur.grab = !cur.grab;
            drawCursor();
        } else if (e.key === 'h' || e.key === 'H') showHint();
    });

    /* ---------- levels & modals ---------- */
    function openModal(...kids) {
        cardEl.replaceChildren(...kids);
        modalEl.classList.add('open');
    }

    function closeModal() { modalEl.classList.remove('open'); }

    function button(label, fn, cls = 'btn') {
        const b = h('button', { className: cls, type: 'button' }, label);
        b.addEventListener('click', fn);
        return b;
    }

    function goalText() {
        if (goal.kind === 'score') return 'Score ' + goal.target.toLocaleString() + ' points';
        if (goal.kind === 'collect') return 'Collect the candies shown';
        return 'Break all the frosting';
    }

    function startLevel() {
        const cfg = levelCfg(level);
        score = 0; shown = 0; moves = startMoves = cfg.moves; types = cfg.types;
        goal = { kind: cfg.kind, target: cfg.target, need: cfg.need };
        selected = null; combo = 1; armed = false; cur.grab = false;
        buildBoard(cfg);
        goal.total = goalLeft();
        over = false; busy = false;
        updateHud();
        renderBoosters();
        drawCursor();
        closeModal();
        banner('Level ' + level + ' — ' + goalText());
        armHint();
    }

    function startRun() {
        level = 1; total = 0;
        boosters = { hammer: 2, shuffle: 1 };
        startLevel();
    }

    function saveBest(v) {
        const best = Math.max(v, Number(store.get('best')) || 0);
        store.set('best', String(best));
        $('best').textContent = best.toLocaleString();
    }

    function endLevel(won, stars) {
        over = true;
        lastWon = won;
        clearHint(); select(null);
        updateHud();
        if (won) {
            total += score;
            saveBest(total);
            boosters.hammer++;
            if (stars === 3) boosters.shuffle++;
            sfx.win(); confetti();
            openModal(
                h('div', { className: 'stars' }, '★'.repeat(stars), h('span', {}, '★'.repeat(3 - stars))),
                h('h2', {}, 'Level ' + level + ' complete!'),
                h('p', {}, 'You scored ' + score.toLocaleString() + ' — run total ' + total.toLocaleString() + '.'),
                h('p', { className: 'reward' }, 'Reward: +1 🔨' + (stars === 3 ? ' and +1 🔀 for three stars!' : '. Finish with more moves to spare for extra stars.')),
                button('Next level →', () => { level++; startLevel(); }),
            );
        } else {
            const final = total + score;
            saveBest(final);
            sfx.lose();
            const name = h('input', { type: 'text', maxLength: 16, placeholder: 'Your name', value: store.get('name') || '' });
            const note = h('p', { className: 'note' }, '');
            const save = button('Save score', async () => {
                const n = name.value.trim();
                if (!n) { name.focus(); return; }
                save.disabled = true;
                store.set('name', n);
                const ok = await submitScore(n, final, level);
                note.textContent = ok ? 'Saved to the leaderboard!' : 'Could not save — try again.';
                save.disabled = ok;
            }, 'btn ghost');
            openModal(
                h('div', { className: 'big' }, '🍭'),
                h('h2', {}, 'Out of moves!'),
                h('p', {}, 'You reached level ' + level + ' with a final score of ' + final.toLocaleString() + '.'),
                h('div', { className: 'row' }, name, save),
                note,
                button('Play again', startRun),
            );
        }
    }

    /* ---------- leaderboard ---------- */
    function renderScores(rows) {
        const list = $('scores');
        if (!Array.isArray(rows) || !rows.length) {
            list.replaceChildren(h('li', { className: 'empty' }, 'No scores yet — be the first!'));
            return;
        }
        list.replaceChildren(...rows.map((s) => h('li', {},
            h('span', { className: 'who' }, String(s.name)),
            h('span', { className: 'lv' }, 'Lv ' + s.level),
            h('b', {}, Number(s.score).toLocaleString()),
        )));
    }

    async function loadScores() {
        try {
            const res = await fetch('/scores', { headers: { Accept: 'application/json' } });
            renderScores(res.ok ? await res.json() : []);
        } catch { renderScores([]); }
    }

    async function submitScore(name, value, lvl) {
        try {
            const token = document.querySelector('meta[name="csrf-token"]');
            const res = await fetch('/scores', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-CSRF-TOKEN': token ? token.content : '',
                },
                body: JSON.stringify({ name, score: value, level: lvl }),
            });
            if (!res.ok) return false;
            renderScores(await res.json());
            return true;
        } catch { return false; }
    }

    /* ---------- boot ---------- */
    $('mute').textContent = sfx.muted ? '🔇' : '🔊';
    $('mute').addEventListener('click', () => { $('mute').textContent = sfx.toggle() ? '🔇' : '🔊'; });
    $('hintBtn').addEventListener('click', showHint);
    $('restart').addEventListener('click', () => { if (!busy) startRun(); });
    $('shuffle').addEventListener('click', useShuffle);
    $('hammer').addEventListener('click', () => {
        if (busy || over || boosters.hammer <= 0) return;
        armed = !armed;
        select(null);
        renderBoosters();
        if (armed) banner('Tap a candy to smash it');
    });

    saveBest(0);
    loadScores();
    startLevel();
    over = true; // board is visible behind the welcome card until Play is pressed
    clearHint();
    openModal(
        h('div', { className: 'big' }, '🍬'),
        h('h2', {}, 'Sweet Swap'),
        h('p', {}, 'Swap candies to match 3 or more. Every level has a new goal — hit scores, collect candies, break frosting — and spare moves explode into a sugar finale!'),
        button('Play', () => { closeModal(); over = false; banner('Level 1 — ' + goalText()); armHint(); }),
    );

    window.__candy = {
        trySwap, findMove, bestMove, startRun, smash, useShuffle,
        startAt(n) { level = n; total = 0; startLevel(); },
        get state() { return { level, score, total, moves, over, busy, won: lastWon, left: goalLeft(), boosters }; },
    };
})();
