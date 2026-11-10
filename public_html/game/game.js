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
    let grid = null;
    let level = 1, score = 0, total = 0, moves = 0, target = 0;
    let busy = false, over = true, combo = 1, selected = null, hintTimer = null, hinted = [];
    let reachedTarget = false;

    const levelCfg = (n) => ({ moves: 20, target: 3000 + (n - 1) * 600 });
    const typeAt = (r, c) => (inside(r, c) && grid[r][c] ? grid[r][c].type : -1);

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

    function buildBoard() {
        if (grid) grid.forEach((row) => row.forEach((t) => t && t.el.remove()));
        const fresh = [];
        do {
            if (grid) fresh.splice(0).forEach(([t]) => t.el.remove());
            grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
            for (let r = 0; r < SIZE; r++) {
                for (let c = 0; c < SIZE; c++) {
                    let type;
                    do { type = rand(TYPES); } while (
                        (typeAt(r, c - 1) === type && typeAt(r, c - 2) === type) ||
                        (typeAt(r - 1, c) === type && typeAt(r - 2, c) === type)
                    );
                    fresh.push([makeTile(r, c, type, null, r - SIZE - 1), r, c]);
                }
            }
        } while (!findMove());
        dropIn(fresh);
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

    function findMove() {
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                for (const [dr, dc] of [[0, 1], [1, 0]]) {
                    const a = { r, c }, b = { r: r + dr, c: c + dc };
                    if (!inside(b.r, b.c)) continue;
                    const ta = grid[a.r][a.c], tb = grid[b.r][b.c];
                    if (!ta || !tb) continue;
                    if (ta.special === 'rainbow' || tb.special === 'rainbow' || (ta.special && tb.special)) return [a, b];
                    rawSwap(a, b);
                    const ok = matchAt(a.r, a.c) || matchAt(b.r, b.c);
                    rawSwap(a, b);
                    if (ok) return [a, b];
                }
            }
        }
        return null;
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
    function updateHud(bump) {
        $('level').textContent = level;
        $('score').textContent = score.toLocaleString();
        $('target').textContent = target.toLocaleString();
        $('moves').textContent = moves;
        $('moves').classList.toggle('low', moves <= 5);
        $('bar').style.width = Math.min(100, (score / (target * 2)) * 100) + '%';
        $('star1').classList.toggle('on', score >= target);
        $('star2').classList.toggle('on', score >= target * 1.5);
        $('star3').classList.toggle('on', score >= target * 2);
        if (bump) retrigger($('score'), 'bump');
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
            grid[r][c] = null;
            dead.push(t.el);
            sr += r; sc += c;
        }
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
            for (let r = write; r >= 0; r--) fresh.push([makeTile(r, c, rand(TYPES), null, r - n), r, c]);
        }
        dropIn(fresh);
        await wait(T.fall);
    }

    async function cascade() {
        for (;;) {
            const groups = findGroups();
            if (!groups.length) return;
            combo++;
            if (combo >= 2) banner(CHEERS[Math.min(combo, CHEERS.length - 1)] + ' ×' + combo);
            await clearGroups(groups, []);
            await collapse();
        }
    }

    async function shuffle() {
        banner('No moves — shuffling!');
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
        await cascade(); // only matters if no clean arrangement was found
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
        await collapse();
        await cascade();

        if (!reachedTarget && score >= target && moves > 0) {
            reachedTarget = true;
            banner('Target reached! Keep going for stars ★');
        }
        if (moves <= 0) { busy = false; endLevel(); return; }
        if (!findMove()) await shuffle();
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
        const m = findMove();
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

    /* ---------- input ---------- */
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

    function startLevel() {
        const cfg = levelCfg(level);
        score = 0; moves = cfg.moves; target = cfg.target;
        reachedTarget = false; selected = null; combo = 1;
        buildBoard();
        updateHud();
        closeModal();
        over = false; busy = false;
        banner('Level ' + level);
        armHint();
    }

    function startRun() {
        level = 1; total = 0;
        startLevel();
    }

    function saveBest(v) {
        const best = Math.max(v, Number(store.get('best')) || 0);
        store.set('best', String(best));
        $('best').textContent = best.toLocaleString();
    }

    function endLevel() {
        over = true;
        clearHint(); select(null);
        if (score >= target) {
            total += score;
            saveBest(total);
            const stars = score >= target * 2 ? 3 : score >= target * 1.5 ? 2 : 1;
            sfx.win(); confetti();
            openModal(
                h('div', { className: 'stars' }, '★'.repeat(stars), h('span', {}, '★'.repeat(3 - stars))),
                h('h2', {}, 'Level ' + level + ' complete!'),
                h('p', {}, 'You scored ' + score.toLocaleString() + ' — run total ' + total.toLocaleString() + '.'),
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
                note.textContent = (await submitScore(n, final, level)) ? 'Saved to the leaderboard!' : 'Could not save — try again.';
                if (note.textContent.startsWith('Could')) save.disabled = false;
            }, 'btn ghost');
            openModal(
                h('div', { className: 'big' }, '🍭'),
                h('h2', {}, 'Out of moves!'),
                h('p', {}, 'You needed ' + (target - score).toLocaleString() + ' more on level ' + level + '. Final score: ' + final.toLocaleString() + '.'),
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

    saveBest(0);
    loadScores();
    startLevel();
    over = true; // board is visible behind the welcome card until Play is pressed
    clearHint();
    openModal(
        h('div', { className: 'big' }, '🍬'),
        h('h2', {}, 'Sweet Swap'),
        h('p', {}, 'Swap candies to match 3 or more. Build rockets, bombs and rainbows, chain combos, and climb the leaderboard!'),
        button('Play', () => { closeModal(); over = false; banner('Level 1'); armHint(); }),
    );

    window.__candy = {
        trySwap, findMove, startRun,
        next() { level++; startLevel(); },
        get state() { return { level, score, total, moves, target, over, busy }; },
    };
})();
