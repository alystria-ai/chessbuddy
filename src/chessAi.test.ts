import { describe, expect, it, vi, afterEach } from 'vitest';
import { Chess } from 'chess.js';
import { analyzeCoachMoveContext, buildCoachInstruction, buildDynamicCoachInfo, guardObviousRecapture, shouldCoachSpeakForMove } from './chessAi';
import { getCoach, getDifficulty } from './coachConfig';

describe('coach prompting helpers', () => {
  it('includes difficulty curriculum and first-person rules in dynamic info', () => {
    const game = new Chess();
    const coach = getCoach('leila');
    const difficulty = getDifficulty('intermediate');
    const info = buildDynamicCoachInfo(game, null, null, coach, difficulty);

    expect(info).toContain('Student level: Intermediate');
    expect(info).toContain(difficulty.curriculum);
    const instruction = buildCoachInstruction(coach, difficulty, 'move');
    expect(instruction).toContain('first person');
    expect(info).toContain('Current board FEN');
    expect(info).toContain('Recent move history');
    expect(info).toContain('Position facts');
  });

  it('builds class-style move instructions for the selected level', () => {
    const instruction = buildCoachInstruction(getCoach('sofia'), getDifficulty('advanced'), 'move');

    expect(instruction).toContain('I am Sofia');
    expect(instruction).toContain('Current student level: Advanced');
    expect(instruction).toContain('Reference at least one concrete chess concept');
    expect(instruction).toContain('NEVER refer to the student in third person');
    expect(instruction).toContain('"your opponent"');
  });

  it('uses difficulty when deciding whether a normal opening move deserves speech', () => {
    const game = new Chess();
    const move = game.move('e4');

    expect(shouldCoachSpeakForMove(game, null, move, getDifficulty('new'))).toMatchObject({
      shouldSpeak: true,
      reason: 'center-control',
    });
    expect(shouldCoachSpeakForMove(game, null, move, getDifficulty('beginner'))).toMatchObject({
      shouldSpeak: false,
      reason: 'routine',
    });
    expect(shouldCoachSpeakForMove(game, null, move, getDifficulty('advanced'))).toMatchObject({
      shouldSpeak: false,
      reason: 'routine',
    });
  });

  it('does not over-coach ordinary pawn captures at higher levels', () => {
    const game = new Chess();
    game.move('e4');
    game.move('d5');
    const capture = game.move('exd5');

    expect(shouldCoachSpeakForMove(game, null, capture, getDifficulty('beginner'))).toMatchObject({
      shouldSpeak: true,
      reason: 'student-capture',
    });
    expect(shouldCoachSpeakForMove(game, null, capture, getDifficulty('intermediate'))).toMatchObject({
      shouldSpeak: false,
      reason: 'routine',
    });
    expect(shouldCoachSpeakForMove(game, null, capture, getDifficulty('expert'))).toMatchObject({
      shouldSpeak: false,
      reason: 'routine',
    });
  });

  it('flags aggressive pawn pushes on intermediate without prescribing a teaching topic', () => {
    const game = new Chess();
    game.move('e4');
    game.move('Nf6');
    const pawnPush = game.move('f4');
    const context = analyzeCoachMoveContext(game, null, pawnPush, getDifficulty('intermediate'), [
      { san: 'e4', from: 'e2', to: 'e4', piece: 'p', by: 'You' },
      { san: 'Nf6', from: 'g8', to: 'f6', piece: 'n', by: 'Leila' },
      { san: 'f4', from: 'f2', to: 'f4', piece: 'p', by: 'You' },
    ]);

    expect(context.shouldSpeak).toBe(true);
    // f4 is a flank pawn push (kingside but not the direct g-pawn cover), so it triggers
    // aggressive-pawn-push, not king-pawn-shield. king-pawn-shield is reserved for g2/g7.
    expect(context.reasons).toContain('aggressive-pawn-push');
    expect(context.reasons).not.toContain('king-pawn-shield');
    expect(context.facts.join(' ')).toContain('flank pawn');
    expect(context.facts.join(' ')).not.toContain('teach');
  });

  it('keeps dynamic info factual and avoids narration phrasing', () => {
    const game = new Chess();
    const first = game.move('e4');
    game.move('Nf6');
    const second = game.move('f4');
    const info = buildDynamicCoachInfo(
      game,
      null,
      second,
      getCoach('leila'),
      getDifficulty('intermediate'),
      [
        { san: first.san, from: first.from, to: first.to, piece: first.piece, by: 'You' },
        { san: 'Nf6', from: 'g8', to: 'f6', piece: 'n', by: 'Leila' },
        { san: second.san, from: second.from, to: second.to, piece: second.piece, by: 'You' },
      ],
    );

    expect(info).toContain('Position facts');
    expect(info).toContain('F 2');
    expect(info).toContain('F 4');
    expect(info).not.toContain('you just moved');
    expect(info).not.toContain('I will move');
    expect(info).not.toContain('Your last move');
  });

  it('attributes a student capture to the student and the lost piece to the coach', () => {
    // Position where White can play Bxd5, capturing Black's d5 pawn.
    const game = new Chess();
    game.move('e4');
    game.move('d5');
    game.move('Bc4');
    game.move('a6');
    const studentCapture = game.move('Bxd5'); // bishop takes pawn (stand-in for "bishop takes queen")
    expect(studentCapture).toBeTruthy();

    const info = buildDynamicCoachInfo(
      game,
      null,
      studentCapture,
      getCoach('leila'),
      getDifficulty('intermediate'),
    );

    // The capturing piece belongs to the student; the captured piece belongs to the coach.
    expect(info).toContain("the student's bishop");
    expect(info).toContain('capturing my pawn');
    // The inverted phrasing the LLM was hallucinating must NOT appear.
    expect(info).not.toContain('my bishop');
    expect(info).not.toContain("the student's pawn"); // because in this position only the bishop is the student's
    // The role-context guard rail must be present.
    expect(info).toContain('I must never invert this');
  });

  it('attributes a coach capture to the coach and the lost piece to the student', () => {
    // Build a position where Black plays a recapture (coach captures student's piece).
    const game = new Chess();
    game.move('e4');
    game.move('d5');
    const coachCapture = game.move('exd5'); // White move, but we use opposite-color move below
    expect(coachCapture).toBeTruthy();

    // Now Black recaptures: Black plays Qxd5 — this is the coach (Black) capturing.
    const coachRecapture = game.move('Qxd5');
    expect(coachRecapture).toBeTruthy();

    const info = buildDynamicCoachInfo(
      game,
      null,
      coachRecapture,
      getCoach('leila'),
      getDifficulty('intermediate'),
    );

    // The capturing piece belongs to the coach (me); the captured piece belongs to the student.
    expect(info).toContain('my queen');
    expect(info).toContain("capturing the student's pawn");
  });

  it('does not describe a student hint move as the coach planned move', () => {
    const game = new Chess();
    const candidate = new Chess().move('e4');
    expect(candidate).toBeTruthy();

    const info = buildDynamicCoachInfo(
      game,
      candidate,
      null,
      getCoach('leila'),
      getDifficulty('intermediate'),
    );

    expect(info).toContain('Candidate best move for the student as White');
    expect(info).toContain("the student's pawn from E 2 to E 4");
    expect(info).not.toContain('MY PLANNED NEXT MOVE');
  });

  it('names whose piece can be captured by the side to move', () => {
    const game = new Chess();
    game.move('e4');
    const coachPawn = game.move('d5');
    expect(coachPawn).toBeTruthy();

    const studentInfo = buildDynamicCoachInfo(
      game,
      null,
      coachPawn,
      getCoach('leila'),
      getDifficulty('intermediate'),
    );

    expect(studentInfo).toContain('the student (playing White) (side to move)');
    expect(studentInfo).toContain('my pawn on D 5');

    const studentCapture = game.move('exd5');
    expect(studentCapture).toBeTruthy();
    const coachInfo = buildDynamicCoachInfo(
      game,
      null,
      studentCapture,
      getCoach('leila'),
      getDifficulty('intermediate'),
    );

    expect(coachInfo).toContain('I (the coach playing Black) (side to move)');
    expect(coachInfo).toContain("the student's pawn on D 5");
  });

  it('attributes a capture to the coach (not the student) when it is the coach to move', () => {
    // Reproduces the logged D4 bug: the student captures into a square where the piece is now
    // hanging, and it is the coach (Black) to move. The coach must say "I can take", never
    // "you can take it for free".
    const game = new Chess();
    game.move('e4');
    game.move('e5');
    game.move('Nf3');
    game.move('Nc6');
    const studentCapture = game.move('Nxe5'); // white knight lands on e5, now hanging, Black to move
    expect(studentCapture).toBeTruthy();

    const info = buildDynamicCoachInfo(
      game,
      null,
      studentCapture,
      getCoach('leila'),
      getDifficulty('intermediate'),
    );

    expect(info).toContain('Pieces I (the coach playing Black) can target');
    expect(info).toContain('Capture actor: every capture listed above is a move that I, the coach');
    expect(info).toContain('can now be captured by me (the coach)');
    // The model must not be handed any phrasing that lets it tell the student to make this capture.
    expect(info).not.toContain('can now be captured by the student');
  });

  it('flags that the student has already castled and gates stale castling praise', () => {
    // Reproduces the logged castling bug: the student castled several plies ago and the coach
    // later praised castling as if it just happened.
    const game = new Chess();
    const history = [] as Array<{ san: string; from: string; to: string; piece: string; captured?: string; by: string }>;
    const play = (san: string, by: string) => {
      const m = game.move(san);
      expect(m).toBeTruthy();
      history.push({ san: m!.san, from: m!.from, to: m!.to, piece: m!.piece, captured: m!.captured, by });
    };
    play('e4', 'You');
    play('e5', 'Leila');
    play('Nf3', 'You');
    play('Nc6', 'Leila');
    play('Bc4', 'You');
    play('Bc5', 'Leila');
    play('O-O', 'You'); // student castles here
    const lastMove = game.move('Nf6'); // coach replies; latest move is NOT castling
    expect(lastMove).toBeTruthy();
    history.push({ san: lastMove!.san, from: lastMove!.from, to: lastMove!.to, piece: lastMove!.piece, by: 'Leila' });

    const info = buildDynamicCoachInfo(
      game,
      null,
      lastMove,
      getCoach('leila'),
      getDifficulty('intermediate'),
      history,
    );

    expect(info).toContain('LATEST MOVE ANCHOR');
    expect(info).toContain('Latest move is castling: no');
    expect(info).toContain('the student HAS ALREADY castled');
    expect(info).toContain('do NOT say "you still have castling available"');
  });

  it('confirms castling praise is allowed on the move the student actually castles', () => {
    const game = new Chess();
    game.move('e4');
    game.move('e5');
    game.move('Nf3');
    game.move('Nc6');
    game.move('Bc4');
    game.move('Bc5');
    const castle = game.move('O-O');
    expect(castle).toBeTruthy();

    const info = buildDynamicCoachInfo(
      game,
      null,
      castle,
      getCoach('leila'),
      getDifficulty('intermediate'),
      [{ san: 'O-O', from: 'e1', to: 'g1', piece: 'k', by: 'You' }],
    );

    expect(info).toContain('Latest move is castling: YES');
  });

  it('states that the coach is in check after the student gives check', () => {
    const game = new Chess();
    game.move('d4');
    game.move('d5');
    game.move('e3');
    game.move('Nf6');
    game.move('f4');
    game.move('e6');
    game.move('a3');
    game.move('Be7');
    const studentCheck = game.move('Bb5+');
    expect(studentCheck).toBeTruthy();

    const info = buildDynamicCoachInfo(
      game,
      null,
      studentCheck,
      getCoach('leila'),
      getDifficulty('intermediate'),
      [
        { san: 'd4', from: 'd2', to: 'd4', piece: 'p', by: 'You' },
        { san: 'd5', from: 'd7', to: 'd5', piece: 'p', by: 'Leila' },
        { san: 'e3', from: 'e2', to: 'e3', piece: 'p', by: 'You' },
        { san: 'Nf6', from: 'g8', to: 'f6', piece: 'n', by: 'Leila' },
        { san: 'f4', from: 'f2', to: 'f4', piece: 'p', by: 'You' },
        { san: 'e6', from: 'e7', to: 'e6', piece: 'p', by: 'Leila' },
        { san: 'a3', from: 'a2', to: 'a3', piece: 'p', by: 'You' },
        { san: 'Be7', from: 'f8', to: 'e7', piece: 'b', by: 'Leila' },
        { san: studentCheck.san, from: studentCheck.from, to: studentCheck.to, piece: studentCheck.piece, by: 'You' },
      ],
    );

    expect(info).toContain('Current check ownership: I (coach playing Black) am in check');
    expect(info).toContain('The student gave check to my king');
    expect(info).toContain('giving check to my king');
    expect(info).not.toContain('You (the student playing White) are in check');
    expect(info).not.toContain('I gave check to your king');
  });

  it('states that the student is in check after the coach gives check', () => {
    const game = new Chess();
    game.move('f3');
    game.move('e5');
    game.move('g4');
    const coachMate = game.move('Qh4#');
    expect(coachMate).toBeTruthy();

    const info = buildDynamicCoachInfo(
      game,
      null,
      coachMate,
      getCoach('leila'),
      getDifficulty('intermediate'),
      [
        { san: 'f3', from: 'f2', to: 'f3', piece: 'p', by: 'You' },
        { san: 'e5', from: 'e7', to: 'e5', piece: 'p', by: 'Leila' },
        { san: 'g4', from: 'g2', to: 'g4', piece: 'p', by: 'You' },
        { san: coachMate.san, from: coachMate.from, to: coachMate.to, piece: coachMate.piece, by: 'Leila' },
      ],
    );

    expect(info).toContain('Current check ownership: You (the student playing White) are in check');
    expect(info).toContain('I gave checkmate to your king');
    expect(info).toContain('giving check to your king');
    expect(info).not.toContain('Current check ownership: I (coach playing Black) am in check');
    expect(info).not.toContain('The student gave check to my king');
  });
});

describe('recapture guard and capture reality check (Nxe4 trade from the 2026-07-29 bug report)', () => {
  // White just played Ng5xe4, capturing Black's knight on e4. Black's d5 pawn
  // (and f5 bishop) defend e4 — the capture is a trade, not won material.
  const FEN_BEFORE_WHITE_NXE4 = 'r2qkb1r/ppp1pppp/2n5/3p1bN1/3PnP2/8/PPP1Q1PP/RNB1KB1R w KQkq - 2 7';

  function positionAfterNxe4() {
    const setup = new Chess(FEN_BEFORE_WHITE_NXE4);
    const lastMove = setup.move('Nxe4');
    return { game: new Chess(setup.fen()), lastMove };
  }

  it('overrides a quiet engine move with the safe pawn recapture', () => {
    const { game, lastMove } = positionAfterNxe4();
    const quiet = game.moves({ verbose: true }).find((m) => m.san === 'e6')!;
    const guarded = guardObviousRecapture(game, quiet, lastMove);
    expect(guarded?.san).toBe('dxe4');
  });

  it('keeps the engine move when it already recaptures or wins equal material elsewhere', () => {
    const { game, lastMove } = positionAfterNxe4();
    const recapture = game.moves({ verbose: true }).find((m) => m.san === 'dxe4')!;
    expect(guardObviousRecapture(game, recapture, lastMove)?.san).toBe('dxe4');
    const bishopTake = game.moves({ verbose: true }).find((m) => m.san === 'Bxe4')!;
    expect(guardObviousRecapture(game, bishopTake, lastMove)?.san).toBe('Bxe4');
  });

  it('leaves pawn trades to the skill model', () => {
    const setup = new Chess();
    setup.move('e4'); setup.move('d5');
    const lastMoveW = setup.move('exd5'); // white pawn takes black pawn
    const game = new Chess(setup.fen());
    const quiet = game.moves({ verbose: true }).find((m) => m.san === 'Nf6')!;
    expect(guardObviousRecapture(game, quiet, lastMoveW)?.san).toBe('Nf6');
  });

  it('states the capture square and that the trade is not free (no hallucinated apology fuel)', () => {
    const { game, lastMove } = positionAfterNxe4();
    const context = analyzeCoachMoveContext(game, null, lastMove, getDifficulty('intermediate'), []);
    const factText = context.facts.join(' ');
    expect(context.studentCaptureAnswerable).toBe(true);
    expect(factText).toContain('CAPTURE REALITY CHECK');
    expect(factText).toContain('NOT a free win');
    expect(factText.toLowerCase()).toContain('the capture happened on e 4');

    const info = buildDynamicCoachInfo(game, null, lastMove, getCoach('sofia'), getDifficulty('intermediate'), []);
    expect(info).toContain('the student initiated a piece trade');
    expect(info).not.toContain('they won real material from me');
  });

  it('still credits genuinely won material when no recapture exists', () => {
    // White queen takes a truly loose knight on b6 — nothing defends it and
    // nothing can safely take the queen back.
    const setup = new Chess('4k3/8/1n6/8/8/1Q6/8/4K3 w - - 0 1');
    const lastMove = setup.move('Qxb6');
    const game = new Chess(setup.fen());
    const context = analyzeCoachMoveContext(game, null, lastMove, getDifficulty('intermediate'), []);
    expect(context.studentCaptureAnswerable).toBe(false);
    const info = buildDynamicCoachInfo(game, null, lastMove, getCoach('sofia'), getDifficulty('intermediate'), []);
    expect(info).toContain('they won real material from me');
  });
});

describe('capture talk stays consistent with the planned move', () => {
  afterEach(() => vi.restoreAllMocks());

  // 1.d4 e5 2.f3: Black (the coach) to move with exd4 available, but the
  // planned move is a quiet knight development that ignores it.
  function setup() {
    const game = new Chess();
    game.move('d4');
    game.move('e5');
    const lastMove = game.move('f3');
    return { game, lastMove };
  }

  function build(roll: number, plannedSan = 'Nc6') {
    vi.spyOn(Math, 'random').mockReturnValue(roll);
    const { game, lastMove } = setup();
    const planned = game.moves({ verbose: true }).find((m) => m.san === plannedSan)!;
    return analyzeCoachMoveContext(game, planned, lastMove, getDifficulty('intermediate'), []);
  }

  it('roll < 0.5 suppresses the capture targets and the loose-piece speech reasons', () => {
    const context = build(0.1);
    const factText = context.facts.join(' ');
    expect(factText).not.toContain('can target with a capture move');
    expect(factText).not.toContain('Capture actor');
    expect(context.reasons).not.toContain('minor-piece-loose');
    expect(context.reasons).not.toContain('moved-piece-capturable');
  });

  it('roll >= 0.5 keeps the targets but adds seen-but-declined framing', () => {
    const context = build(0.9);
    const factText = context.facts.join(' ');
    expect(factText).toContain('can target with a capture move');
    expect(factText).toContain('CONSISTENCY — my actual move this turn is Nc6');
    expect(factText).toContain('seen but declined');
  });

  it('planned capture on a listed square passes facts through untouched', () => {
    const context = build(0.1, 'exd4');
    const factText = context.facts.join(' ');
    expect(factText).toContain('can target with a capture move');
    expect(factText).not.toContain('CONSISTENCY —');
  });
});
