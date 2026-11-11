<?php

namespace Tests\Feature;

use App\Models\Score;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ScoreTest extends TestCase
{
    use RefreshDatabase;

    public function test_game_page_loads_with_assets_from_public_html(): void
    {
        $this->assertStringEndsWith('public_html', public_path());

        $this->get('/')->assertOk()->assertSee('game/game.js');
    }

    public function test_score_can_be_saved_and_listed_highest_first(): void
    {
        Score::create(['name' => 'Low', 'score' => 100, 'level' => 1]);

        $this->postJson('/scores', ['name' => '<b>Ace</b>', 'score' => 9000, 'level' => 3])
            ->assertCreated()
            ->assertJsonPath('rank', 1)
            ->assertJsonPath('top.0.name', 'Ace')
            ->assertJsonPath('top.1.name', 'Low');

        $this->postJson('/scores', ['name' => 'Mid', 'score' => 500, 'level' => 2])
            ->assertCreated()
            ->assertJsonPath('rank', 2);

        $this->getJson('/scores')->assertOk()->assertJsonCount(3)->assertJsonPath('0.name', 'Ace');
    }

    public function test_invalid_score_is_rejected(): void
    {
        $this->postJson('/scores', ['name' => '', 'score' => -5, 'level' => 0])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['name', 'score', 'level']);
    }
}
