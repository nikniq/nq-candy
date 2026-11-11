@extends('auth.layout')

@section('title', 'Log in')
@section('heading', 'Welcome back')
@section('lead', 'Log in to play under your own name.')

@section('form')
    <form method="POST" action="{{ route('login') }}" class="auth-form">
        @csrf

        <div class="field">
            <label for="email">Email</label>
            <input id="email" name="email" type="email" value="{{ old('email') }}" required autofocus
                   autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false"
                   @error('email') aria-invalid="true" aria-describedby="email-error" @enderror>
            @error('email')<p class="err" id="email-error" role="alert">{{ $message }}</p>@enderror
        </div>

        <div class="field">
            <label for="password">Password</label>
            <div class="with-toggle">
                <input id="password" name="password" type="password" required autocomplete="current-password"
                       @error('password') aria-invalid="true" aria-describedby="password-error" @enderror>
                <button type="button" class="toggle" data-toggle="password" aria-pressed="false">Show</button>
            </div>
            @error('password')<p class="err" id="password-error" role="alert">{{ $message }}</p>@enderror
        </div>

        <label class="check"><input type="checkbox" name="remember" value="1" @checked(old('remember'))> Keep me logged in on this device</label>

        <button type="submit" class="btn" data-busy="Logging in…">Log in</button>
    </form>

    <p class="switch">New here? <a href="{{ route('register') }}">Create an account</a></p>
@endsection
