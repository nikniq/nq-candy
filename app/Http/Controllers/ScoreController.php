<?php

namespace App\Http\Controllers;

use App\Models\Score;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

class ScoreController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json($this->top($request->user()));
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'name' => [$user ? 'nullable' : 'required', 'string', 'max:16'],
            'score' => ['required', 'integer', 'min:0', 'max:10000000'],
            'level' => ['required', 'integer', 'min:1', 'max:999'],
        ]);

        if ($user) {
            // A signed-in player always scores under their own name.
            $data['name'] = $user->name;
            $data['user_id'] = $user->id;
        } else {
            $data['name'] = trim(strip_tags($data['name'])) ?: 'Anonymous';

            if (User::nameTaken($data['name'])) {
                throw ValidationException::withMessages([
                    'name' => 'That name belongs to a registered player. Log in, or pick another name.',
                ]);
            }
        }

        Score::create($data);

        return response()->json([
            'rank' => Score::where('score', '>', $data['score'])->count() + 1,
            'top' => $this->top($user),
        ], 201);
    }

    private function top(?User $user): Collection
    {
        return Score::query()
            ->orderByDesc('score')
            ->orderBy('id')
            ->limit(10)
            ->get(['name', 'score', 'level', 'user_id'])
            ->map(fn (Score $s) => [
                'name' => $s->name,
                'score' => $s->score,
                'level' => $s->level,
                'member' => $s->user_id !== null,
                'mine' => $user !== null && $s->user_id === $user->id,
            ]);
    }
}
