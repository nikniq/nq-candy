<?php

namespace Tests\Feature;

use App\Models\Score;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    private function user(array $attributes = []): User
    {
        return User::create($attributes + ['name' => 'Ace', 'email' => 'ace@example.com', 'password' => 'correct-horse']);
    }

    public function test_login_and_register_pages_load(): void
    {
        $this->get('/login')->assertOk()->assertSee('Welcome back');
        $this->get('/register')->assertOk()->assertSee('Create your account');
    }

    public function test_a_player_can_register_and_is_logged_in(): void
    {
        $this->post('/register', [
            'name' => 'Sugar Fan', 'email' => 'Fan@Example.com',
            'password' => 'long-enough-1', 'password_confirmation' => 'long-enough-1',
        ])->assertRedirect('/');

        $this->assertAuthenticated();
        $this->assertDatabaseHas('users', ['name' => 'Sugar Fan', 'email' => 'fan@example.com']);
        $this->assertNotSame('long-enough-1', User::first()->password);
        $this->get('/')->assertOk()->assertSee('Logged in as Sugar Fan');
    }

    public function test_registration_rejects_bad_input(): void
    {
        $this->user();

        $this->post('/register', [
            'name' => 'ace', 'email' => 'ace@example.com',
            'password' => 'short', 'password_confirmation' => 'different',
        ])->assertSessionHasErrors(['name', 'email', 'password']);

        $this->post('/register', [
            'name' => '<script>', 'email' => 'x@example.com',
            'password' => 'long-enough-1', 'password_confirmation' => 'long-enough-1',
        ])->assertSessionHasErrors('name');

        $this->assertGuest();
        $this->assertSame(1, User::count());
    }

    public function test_a_player_can_log_in_and_out(): void
    {
        $user = $this->user();

        $this->post('/login', ['email' => 'ace@example.com', 'password' => 'correct-horse'])->assertRedirect('/');
        $this->assertAuthenticatedAs($user);

        $this->post('/logout')->assertRedirect('/');
        $this->assertGuest();
    }

    public function test_wrong_password_is_rejected_and_then_throttled(): void
    {
        $this->user();

        for ($i = 0; $i < 5; $i++) {
            $this->post('/login', ['email' => 'ace@example.com', 'password' => 'nope'])
                ->assertSessionHasErrors(['email' => 'That email and password do not match an account.']);
        }
        $this->assertGuest();

        // Sixth try is refused even with the right password.
        $this->post('/login', ['email' => 'ace@example.com', 'password' => 'correct-horse'])->assertSessionHasErrors('email');
        $this->assertGuest();
    }

    public function test_logged_in_players_are_sent_away_from_login_and_guests_cannot_log_out(): void
    {
        $this->post('/logout')->assertRedirect('/login');

        $this->actingAs($this->user());
        $this->get('/login')->assertRedirect('/');
        $this->get('/register')->assertRedirect('/');
    }

    public function test_scores_from_a_logged_in_player_use_their_account(): void
    {
        $user = $this->user();

        $this->actingAs($user)
            ->postJson('/scores', ['name' => 'Someone Else', 'score' => 700, 'level' => 2])
            ->assertCreated()
            ->assertJsonPath('top.0.name', 'Ace')
            ->assertJsonPath('top.0.member', true)
            ->assertJsonPath('top.0.mine', true);

        $this->assertDatabaseHas('scores', ['user_id' => $user->id, 'name' => 'Ace', 'score' => 700]);
        $this->get('/')->assertSee('window.__best = 700', false);
    }

    public function test_guests_cannot_score_under_a_registered_name(): void
    {
        $this->user();

        $this->postJson('/scores', ['name' => 'ACE', 'score' => 999, 'level' => 1])
            ->assertStatus(422)
            ->assertJsonValidationErrors('name');

        $this->postJson('/scores', ['name' => 'Guest', 'score' => 10, 'level' => 1])
            ->assertCreated()
            ->assertJsonPath('top.0.member', false)
            ->assertJsonPath('top.0.mine', false);

        $this->assertSame(1, Score::count());
    }
}
