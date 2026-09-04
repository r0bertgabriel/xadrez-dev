import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Color, type Square } from 'chess.js';
import { displayEvaluation, scoreToWhite, StockfishEngine, type EngineAnalysis } from './engine';

type PlayedMove = {
  fenBefore: string;
  uci: string;
  san: string;
  color: Color;
};

type ReviewMove = PlayedMove & {
  bestMove: string;
  loss: number;
  verdict: string;
  explanation: string;
};

const pieces: Record<string, string> = {
  wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
  bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚',
};

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function verdictFromLoss(loss: number) {
  if (loss <= 15) return 'Excelente';
  if (loss <= 40) return 'Boa';
  if (loss <= 90) return 'Imprecisão';
  if (loss <= 180) return 'Erro';
  return 'Erro grave';
}

function explanationFor(verdict: string, played: string, best: string) {
  if (played === best) return 'Você encontrou a primeira escolha do Stockfish nesta posição.';
  if (verdict === 'Excelente' || verdict === 'Boa') return `Sua jogada ficou próxima da melhor linha. O motor preferia ${best}.`;
  if (verdict === 'Imprecisão') return `Havia uma continuação mais eficiente com ${best}, que preservava melhor a vantagem da posição.`;
  if (verdict === 'Erro') return `A jogada concedeu uma vantagem relevante ao adversário. A defesa/continuação recomendada era ${best}.`;
  return `A posição mudou de forma decisiva. A principal alternativa era ${best}.`;
}

function App() {
  const gameRef = useRef(new Chess());
  const engineRef = useRef<StockfishEngine | null>(null);
  const historyRef = useRef<PlayedMove[]>([]);
  const [fen, setFen] = useState(gameRef.current.fen());
  const [selected, setSelected] = useState<Square | null>(null);
  const [hint, setHint] = useState<EngineAnalysis | null>(null);
  const [thinking, setThinking] = useState(true);
  const [status, setStatus] = useState('Carregando Stockfish 18…');
  const [moves, setMoves] = useState<PlayedMove[]>([]);
  const [review, setReview] = useState<ReviewMove[]>([]);
  const [reviewing, setReviewing] = useState(false);

  const board = useMemo(() => new Chess(fen), [fen]);
  const legalTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set(board.moves({ square: selected, verbose: true }).map((move) => move.to));
  }, [board, selected]);

  useEffect(() => {
    const engine = new StockfishEngine();
    engineRef.current = engine;
    void refreshHint(gameRef.current.fen(), engine);
    return () => engine.terminate();
  }, []);

  async function refreshHint(position: string, engine = engineRef.current) {
    if (!engine) return;
    setThinking(true);
    setStatus('Analisando a posição localmente…');
    try {
      const analysis = await engine.analyze(position, 14);
      if (gameRef.current.fen() !== position) return;
      setHint(analysis);
      setStatus('Sua vez — a melhor jogada está destacada.');
    } catch {
      setStatus('Não foi possível carregar o motor local. Recarregue a página.');
    } finally {
      setThinking(false);
    }
  }

  function recordMove(fenBefore: string, from: Square, to: Square, promotion = 'q') {
    const game = gameRef.current;
    const move = game.move({ from, to, promotion });
    if (!move) return false;
    const item: PlayedMove = { fenBefore, uci: `${from}${to}${move.promotion ?? ''}`, san: move.san, color: move.color };
    historyRef.current = [...historyRef.current, item];
    setMoves(historyRef.current);
    setFen(game.fen());
    setSelected(null);
    return true;
  }

  async function playUserMove(from: Square, to: Square) {
    const game = gameRef.current;
    if (thinking || game.isGameOver() || game.turn() !== 'w') return;
    const before = game.fen();
    try {
      if (!recordMove(before, from, to)) return;
    } catch {
      return;
    }

    setHint(null);
    if (game.isGameOver()) {
      setStatus('Partida encerrada. Gere a análise para revisar suas decisões.');
      return;
    }

    const engine = engineRef.current;
    if (!engine) return;
    setThinking(true);
    setStatus('Stockfish está calculando a resposta…');
    const replyPosition = game.fen();
    const reply = await engine.analyze(replyPosition, 13);
    if (game.fen() !== replyPosition || !reply.bestMove || reply.bestMove === '(none)') return;

    const fromSq = reply.bestMove.slice(0, 2) as Square;
    const toSq = reply.bestMove.slice(2, 4) as Square;
    recordMove(replyPosition, fromSq, toSq, reply.bestMove.slice(4, 5) || 'q');

    if (game.isGameOver()) {
      setThinking(false);
      setStatus('Partida encerrada. Gere a análise para revisar suas decisões.');
      return;
    }
    await refreshHint(game.fen(), engine);
  }

  function handleSquare(square: Square) {
    const game = gameRef.current;
    if (thinking || game.turn() !== 'w' || game.isGameOver()) return;
    if (selected) {
      if (legalTargets.has(square)) {
        void playUserMove(selected, square);
        return;
      }
      const piece = game.get(square);
      setSelected(piece?.color === 'w' ? square : null);
      return;
    }
    if (game.get(square)?.color === 'w') setSelected(square);
  }

  function resetGame() {
    gameRef.current = new Chess();
    historyRef.current = [];
    setMoves([]);
    setReview([]);
    setSelected(null);
    setHint(null);
    setFen(gameRef.current.fen());
    void refreshHint(gameRef.current.fen());
  }

  async function analyzeGame() {
    const engine = engineRef.current;
    if (!engine || !historyRef.current.length || reviewing) return;
    setReviewing(true);
    setStatus('Analisando cada decisão da partida…');
    const result: ReviewMove[] = [];

    for (let i = 0; i < historyRef.current.length; i += 1) {
      const item = historyRef.current[i];
      setStatus(`Analisando jogada ${i + 1} de ${historyRef.current.length}…`);
      const best = await engine.analyze(item.fenBefore, 12);
      const after = new Chess(item.fenBefore);
      after.move({ from: item.uci.slice(0, 2) as Square, to: item.uci.slice(2, 4) as Square, promotion: item.uci.slice(4, 5) || 'q' });
      const afterFen = after.fen();
      const played = await engine.analyze(afterFen, 12);
      const bestWhite = scoreToWhite(best.score, item.fenBefore);
      const playedWhite = scoreToWhite(played.score, afterFen);
      const rawLoss = item.color === 'w' ? bestWhite - playedWhite : playedWhite - bestWhite;
      const loss = Math.max(0, Math.min(1000, Math.round(rawLoss)));
      const verdict = verdictFromLoss(loss);
      result.push({ ...item, bestMove: best.bestMove, loss, verdict, explanation: explanationFor(verdict, item.uci, best.bestMove) });
    }

    setReview(result);
    setReviewing(false);
    setStatus('Análise concluída.');
  }

  const hintFrom = hint?.bestMove.slice(0, 2);
  const hintTo = hint?.bestMove.slice(2, 4);
  const boardRows = board.board();
  const whiteReviews = review.filter((item) => item.color === 'w');
  const avgLoss = whiteReviews.length ? Math.round(whiteReviews.reduce((sum, item) => sum + item.loss, 0) / whiteReviews.length) : 0;
  const accuracy = whiteReviews.length ? Math.max(0, Math.round(100 * Math.exp(-avgLoss / 180))) : 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">STOCKFISH 18 · 100% LOCAL</span>
          <h1>Xadrez Coach</h1>
        </div>
        <button className="secondary" onClick={resetGame}>Nova partida</button>
      </header>

      <section className="workspace">
        <div className="board-column">
          <div className="engine-strip">
            <span className={thinking ? 'pulse' : 'ready-dot'} />
            <span>{status}</span>
            {hint && <strong>Avaliação {displayEvaluation(hint.score, fen)}</strong>}
          </div>

          <div className="board" aria-label="Tabuleiro de xadrez">
            {boardRows.flatMap((row, rowIndex) => row.map((piece, colIndex) => {
              const square = `${files[colIndex]}${8 - rowIndex}` as Square;
              const light = (rowIndex + colIndex) % 2 === 0;
              const classes = ['square', light ? 'light' : 'dark'];
              if (selected === square) classes.push('selected');
              if (legalTargets.has(square)) classes.push('legal');
              if (hintFrom === square) classes.push('hint-from');
              if (hintTo === square) classes.push('hint-to');
              return (
                <button key={square} className={classes.join(' ')} onClick={() => handleSquare(square)} aria-label={square}>
                  {colIndex === 0 && <span className="rank">{8 - rowIndex}</span>}
                  {rowIndex === 7 && <span className="file">{files[colIndex]}</span>}
                  {piece && <span className={`piece ${piece.color}`}>{pieces[`${piece.color}${piece.type}`]}</span>}
                </button>
              );
            }))}
          </div>

          <div className="hint-card">
            <div>
              <span className="label">GUIA DE MELHOR JOGADA</span>
              <strong>{hint?.bestMove && hint.bestMove !== '(none)' ? `${hint.bestMove.slice(0, 2)} → ${hint.bestMove.slice(2, 4)}` : 'Calculando…'}</strong>
            </div>
            <p>As casas em verde indicam origem e destino sugeridos pelo Stockfish. Você joga com as brancas.</p>
          </div>
        </div>

        <aside className="side-panel">
          <section className="panel-card">
            <div className="panel-title"><span>Partida</span><small>{Math.ceil(moves.length / 2)} lances</small></div>
            <div className="move-list">
              {!moves.length && <p className="muted">Selecione uma peça e depois a casa de destino.</p>}
              {Array.from({ length: Math.ceil(moves.length / 2) }, (_, i) => (
                <div className="move-row" key={i}>
                  <span>{i + 1}.</span>
                  <strong>{moves[i * 2]?.san}</strong>
                  <strong>{moves[i * 2 + 1]?.san ?? ''}</strong>
                </div>
              ))}
            </div>
            <button className="primary" disabled={!moves.length || reviewing} onClick={() => void analyzeGame()}>
              {reviewing ? 'Analisando…' : 'Analisar partida'}
            </button>
          </section>

          <section className="panel-card">
            <div className="panel-title"><span>Resumo técnico</span><small>sem LLM</small></div>
            {review.length ? (
              <div className="score-grid">
                <div><strong>{accuracy}%</strong><span>Precisão estimada</span></div>
                <div><strong>{avgLoss}</strong><span>Perda média (cp)</span></div>
                <div><strong>{whiteReviews.filter((x) => x.verdict === 'Erro grave').length}</strong><span>Erros graves</span></div>
                <div><strong>{whiteReviews.filter((x) => x.verdict === 'Excelente').length}</strong><span>Excelentes</span></div>
              </div>
            ) : <p className="muted">Ao analisar, cada lance será comparado com a principal linha do motor.</p>}
          </section>
        </aside>
      </section>

      {review.length > 0 && (
        <section className="review-section">
          <div className="section-heading">
            <div><span className="eyebrow">PÓS-PARTIDA</span><h2>Revisão lance a lance</h2></div>
            <span className="badge">Profundidade 12</span>
          </div>
          <div className="review-table">
            {review.map((item, index) => (
              <article className="review-row" key={`${item.uci}-${index}`}>
                <span className="move-number">{index + 1}</span>
                <div><strong>{item.san}</strong><small>{item.color === 'w' ? 'Brancas' : 'Pretas'} · {item.uci}</small></div>
                <span className={`verdict v-${item.verdict.toLowerCase().replace(' ', '-')}`}>{item.verdict}</span>
                <div className="review-copy"><strong>Melhor: {item.bestMove}</strong><p>{item.explanation}</p></div>
                <span className="loss">-{item.loss} cp</span>
              </article>
            ))}
          </div>
        </section>
      )}

      <footer>Stockfish 18 via WebAssembly · regras com chess.js · processamento local no navegador</footer>
    </main>
  );
}

export default App;
