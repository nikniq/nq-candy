@extends('auth.layout')

@section('title', 'Create an account')
@section('heading', 'Create your account')
@section('lead', 'Free, and it keeps your name on the leaderboard.')

@section('form')
    <form method="POST" action="{{ route('register') }}" class="auth-form">
        @csrf

        <div class="field">
            <label for="name">Player name</label>
            <input id="name" name="name" type="text" value="{{ old('name') }}" required autofocus
                   minlength="2" maxlength="16" autocomplete="nickname" spellcheck="false" aria-describedby="name-hint @error('name') name-error @enderror"
                   @error('name') aria-invalid="true" @enderror>
            @error('name')<p class="err" id="name-error" role="alert">{{ $message }}</p>@enderror
            <p class="hint" id="name-hint">2–16 characters. This is what the leaderboard shows.</p>
        </div>

        <div class="field">
            <label for="email">Email</label>
            <input id="email" name="email" type="email" value="{{ old('email') }}" required
                   autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false"
                   @error('email') aria-invalid="true" aria-describedby="email-error" @enderror>
            @error('email')<p class="err" id="email-error" role="alert">{{ $message }}</p>@enderror
        </div>

        <div class="field">
            <label for="password">Password</label>
            <div class="with-toggle">
                <input id="password" name="password" type="password" required minlength="8" autocomplete="new-password"
                       aria-describedby="password-hint @error('password') password-error @enderror"
                       @error('password') aria-invalid="true" @enderror>
                <button type="button" class="toggle" data-toggle="password" aria-pressed="false">Show</button>
            </div>
            @error('password')<p class="err" id="password-error" role="alert">{{ $message }}</p>@enderror
            <p class="hint" id="password-hint">At least 8 characters.</p>
        </div>

        <div class="field">
            <label for="password_confirmation">Password again</label>
            <input id="password_confirmation" name="password_confirmation" type="password" required minlength="8" autocomplete="new-password">
        </div>

        <button type="submit" class="btn" data-busy="Creating account…">Create account</button>
    </form>

    <p class="switch">Already have an account? <a href="{{ route('login') }}">Log in</a></p>
@endsection
