<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#2a0f4a">
    <title>@yield('title') — Sweet Swap</title>
    <link rel="icon" href="{{ asset('favicon.svg') }}" type="image/svg+xml">
    <link rel="stylesheet" href="{{ asset('game/game.css') }}?v={{ filemtime(public_path('game/game.css')) }}">
    <link rel="stylesheet" href="{{ asset('game/auth.css') }}?v={{ filemtime(public_path('game/auth.css')) }}">
</head>
<body class="auth">
<main class="auth-wrap">
    <a class="auth-brand" href="{{ route('game') }}"><span class="logo">🍬</span> Sweet Swap</a>

    <section class="auth-card">
        <h1>@yield('heading')</h1>
        <p class="lead">@yield('lead')</p>

        @yield('form')
    </section>

    <a class="auth-back" href="{{ route('game') }}">← Back to the game</a>
    <a class="auth-home" href="https://nikniq.com" rel="noopener">nikniq.com</a>
</main>

<script>
    // Show/hide password, and stop a double tap from submitting twice.
    document.querySelectorAll('[data-toggle]').forEach((btn) => btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.toggle);
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Hide' : 'Show';
        btn.setAttribute('aria-pressed', show);
    }));
    document.querySelectorAll('form').forEach((form) => form.addEventListener('submit', () => {
        const submit = form.querySelector('[type=submit]');
        submit.disabled = true;
        submit.textContent = submit.dataset.busy;
    }));
</script>
</body>
</html>
