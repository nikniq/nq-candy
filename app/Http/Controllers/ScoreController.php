<?php

namespace App\Http\Controllers;

use App\Models\Score;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ScoreController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json($this->top());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:16'],
            'score' => ['required', 'integer', 'min:0', 'max:10000000'],
            'level' => ['required', 'integer', 'min:1', 'max:999'],
        ]);

        $data['name'] = trim(strip_tags($data['name'])) ?: 'Anonymous';

        Score::create($data);

        return response()->json($this->top(), 201);
    }

    private function top()
    {
        return Score::query()
            ->orderByDesc('score')
            ->orderBy('id')
            ->limit(10)
            ->get(['name', 'score', 'level']);
    }
}
