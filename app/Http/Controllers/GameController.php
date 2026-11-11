<?php

namespace App\Http\Controllers;

use App\Models\Score;
use Illuminate\Http\Request;
use Illuminate\View\View;

class GameController extends Controller
{
    public function __invoke(Request $request): View
    {
        $user = $request->user();

        return view('game', [
            'player' => $user?->only(['id', 'name']),
            'best' => $user ? (int) Score::where('user_id', $user->id)->max('score') : 0,
        ]);
    }
}
