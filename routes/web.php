<?php

use App\Http\Controllers\ScoreController;
use Illuminate\Support\Facades\Route;

Route::view('/', 'game');

Route::get('/scores', [ScoreController::class, 'index']);
Route::post('/scores', [ScoreController::class, 'store'])->middleware('throttle:20,1');
