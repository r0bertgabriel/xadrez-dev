import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Move, type Square } from 'chess.js'
import { StockfishEngine, type EngineAnalysis } from './engine'
import './styles.css'

const pieces: Record<string, string> = {
  wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
  bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚',
}

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const ranks = ['8', '7', '6', '5', '4', '3', '2', '1']
const squares = ranks.flatMap((rank) => files.map((file) => `${file}${rank}` as Square))

type ReviewMove = {
  ply: number
  san: string
  actual: string
  best: string
  loss: number
  label: string
  eval: number
}

function uciToMove(uci: string) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' }
}

function scoreOf(analysis: EngineAnalysis) {
  const line = analysis.lines[0]
  if (!line) return 0
  if (line.mate !== null) return Math.sign(line.mate) * (10000 - Math.min(99, Math.abs(line.mate)))
  return line.scoreCp ?? 0
}

function displayEval(cp: number) {
  if (Math.abs(cp) > 9000) return cp > 0 ? 'M+' : 'M−'
  const pawns = cp / 100
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(1)}`
}

function classify(loss: number, isBest: boolean) {
  if (isBest) return 'Melhor lance'
  if (loss <= 25) return 'Excelente'
  if (loss <= 60) return 'Bom'
  if (loss <= 120) return 'Imprecisão'
  if (loss <= 250) return 'Erro'
  return 'Erro grave'
}

function explainMove(game: Chess, uci: string) {
  if (!uci || uci === '(none)') return 'Não há lance disponível.'
  const probe = new Chess(game.fen())
  let move: Move
  try {
    move = probe.move(uciToMove(uci))
  } catch {
    return 'O motor identificou este lance como a continuação mais forte da posição.'
  }

  const reasons: string[] = []
  if (move.isCapture()) reasons.push(`ganha ou troca material ao capturar em ${move.to}`)
  if (probe.inCheck()) reasons.push('cria uma ameaça imediata de xeque')
  if (move.isKingsideCastle() || move.isQueensideCastle()) reasons.push('melhora a segurança do rei com o roque')
  if (['d4', 'd5', 'e4', 'e5'].includes(move.to)) reasons.push('aumenta o controle do centro')
  if (['n', 'b'].includes(move.piece) && ['1', '8'].includes(move.from[1])) reasons.push('desenvolve uma peça para uma casa mais ativa')
  if (move.isPromotion()) reasons.push('promove um peão e aumenta fortemente o material')
  if (!reasons.length) reasons.push('melhora a posição segundo a busca tática e posicional do Stockfish')
  return `Ideia: ${reasons.join('; ')}.`
}

function Arrow({ move }: { move?: string }) {
  if (!move || move.length < 4) return null
  const center = (sq: string) => {
    const x = files.indexOf(sq[0]) + 0.5
    const y = 7 - Number(sq[1]) + 1.5
    return { x: x * 12.5, y: y * 12.5 }
  }
  const from = center(move.slice(0, 2))
  const to = center(move.slice(2, 4))
  return (
    <svg className="hint-arrow" viewBox="0 0 100 100" aria-hidden="true">
      <defs><marker id="arrowhead" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 Z" /></marker></defs>
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd="url(#arrowhead)" />
    </svg>
  )
}

export default function App() {
  const [game, setGame] = useState(() => new Chess())
  const [selected, setSelected] = useState<Square | null>(null)
  const [analysis, setAnalysis] = useState<EngineAnalysis | null>(null)
  const [thinking, setThinking] = useState(false)
  const [engineElo, setEngineElo] = useState(1500)
  const [showHint, setShowHint] = useState(true)
  const [review, setReview] = useState<ReviewMove[]>([])
  const [reviewing, setReviewing] = useState(false)
  const [status, setStatus] = useState('Carregando Stockfish 18…')
  const engineRef = useRef<StockfishEngine | null>(null)

  const legalTargets = useMemo(() => selected
    ? game.moves({ square: selected, verbose: true }).map((m) => m.to)
    : [], [game, selected])

  const evalCp = analysis ? scoreOf(analysis) : 0
  const bestMove = analysis?.bestMove

  useEffect(() => {
    const engine = new StockfishEngine()
    engineRef.current = engine
    analyzeTurn(game, engine)
    return () => engine.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function analyzeTurn(position: Chess, engine = engineRef.current) {
    if (!engine || position.isGameOver()) return
    setThinking(true)
    setStatus('Analisando posição…')
    try {
      const result = await engine.analyze(position.fen(), 15, 3)
      setAnalysis(result)
      setStatus('Coach pronto')
    } catch (error) {
      console.error(error)
      setStatus('Falha ao carregar o motor local')
    } finally {
      setThinking(false)
    }
  }

  async function playComputer(position: Chess) {
    const engine = engineRef.current
    if (!engine || position.isGameOver()) return
    setThinking(true)
    setStatus(`Stockfish ${engineElo} está pensando…`)
    try {
      const uci = await engine.bestMove(position.fen(), engineElo)
      const next = new Chess(position.fen())
      next.loadPgn(position.pgn())
      next.move(uciToMove(uci))
      setGame(next)
      setSelected(null)
      if (!next.isGameOver()) await analyzeTurn(next, engine)
      else setStatus('Partida encerrada — análise disponível')
    } catch (error) {
      console.error(error)
      setStatus('Erro ao calcular resposta do adversário')
    } finally {
      setThinking(false)
    }
  }

  function clickSquare(square: Square) {
    if (thinking || game.isGameOver() || game.turn() !== 'w') return
    const piece = game.get(square)
    if (!selected) {
      if (piece?.color === 'w') setSelected(square)
      return
    }

    if (piece?.color === 'w') {
      setSelected(square)
      return
    }

    const next = new Chess()
    next.loadPgn(game.pgn())
    try {
      next.move({ from: selected, to: square, promotion: 'q' })
      setGame(next)
      setAnalysis(null)
      setSelected(null)
      if (!next.isGameOver()) void playComputer(next)
      else setStatus('Partida encerrada — análise disponível')
    } catch {
      setSelected(null)
    }
  }

  function resetGame() {
    const next = new Chess()
    setGame(next)
    setReview([])
    setAnalysis(null)
    setSelected(null)
    setStatus('Nova partida')
    void analyzeTurn(next)
  }

  function undoPair() {
    if (thinking) return
    const next = new Chess()
    next.loadPgn(game.pgn())
    next.undo()
    if (next.turn() === 'b') next.undo()
    setGame(next)
    setReview([])
    setAnalysis(null)
    setSelected(null)
    void analyzeTurn(next)
  }

  async function reviewGame() {
    const engine = engineRef.current
    if (!engine || !game.history().length) return
    setReviewing(true)
    setReview([])
    setStatus('Revisando lance por lance…')

    const replay = new Chess()
    const verbose = game.history({ verbose: true })
    const rows: ReviewMove[] = []

    try {
      for (let index = 0; index < verbose.length; index++) {
        const move = verbose[index]
        const mover = replay.turn()
        const before = await engine.analyze(replay.fen(), 12, 3)
        const best = before.bestMove
        const bestScore = scoreOf(before)
        const actualUci = `${move.from}${move.to}${move.promotion ?? ''}`
        replay.move({ from: move.from, to: move.to, promotion: move.promotion })
        const after = replay.isGameOver() ? null : await engine.analyze(replay.fen(), 12, 1)
        const afterScore = after ? scoreOf(after) : bestScore
        const rawLoss = mover === 'w' ? bestScore - afterScore : afterScore - bestScore
        const loss = Math.max(0, Math.round(rawLoss))
        rows.push({
          ply: index + 1,
          san: move.san,
          actual: actualUci,
          best,
          loss,
          label: classify(loss, actualUci === best),
          eval: afterScore,
        })
        setReview([...rows])
      }
      setStatus('Revisão concluída')
    } finally {
      setReviewing(false)
    }
  }

  const history = game.history()
  const accuracy = review.length
    ? Math.max(0, Math.round(100 - review.reduce((sum, row) => sum + Math.min(row.loss, 400), 0) / review.length / 4))
    : null

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">STOCKFISH 18 · LOCAL</span>
          <h1>Xadrez Coach</h1>
        </div>
        <div className="engine-status"><span className={thinking ? 'pulse' : 'dot'} />{status}</div>
      </header>

      <section className="game-layout">
        <div className="board-column">
          <div className="player-row"><strong>Stockfish</strong><span>{engineElo} Elo</span></div>
          <div className="board-wrap">
            <div className="board" role="grid" aria-label="Tabuleiro de xadrez">
              {squares.map((square, index) => {
                const piece = game.get(square)
                const light = (Math.floor(index / 8) + index) % 2 === 0
                const target = legalTargets.includes(square)
                const hinted = showHint && bestMove && (square === bestMove.slice(0, 2) || square === bestMove.slice(2, 4))
                return (
                  <button
                    key={square}
                    className={`square ${light ? 'light' : 'dark'} ${selected === square ? 'selected' : ''} ${target ? 'target' : ''} ${hinted ? 'hinted' : ''}`}
                    onClick={() => clickSquare(square)}
                    aria-label={square}
                  >
                    {piece && <span className={`piece ${piece.color}`}>{pieces[`${piece.color}${piece.type}`]}</span>}
                    {square[0] === 'a' && <small className="rank">{square[1]}</small>}
                    {square[1] === '1' && <small className="file">{square[0]}</small>}
                  </button>
                )
              })}
            </div>
            {showHint && <Arrow move={bestMove} />}
          </div>
          <div className="player-row"><strong>Você</strong><span>Brancas</span></div>

          <div className="actions">
            <button onClick={resetGame}>Nova partida</button>
            <button onClick={undoPair} disabled={!history.length || thinking}>Desfazer rodada</button>
            <button className="primary" onClick={() => setShowHint((value) => !value)}>{showHint ? 'Ocultar dica' : 'Mostrar dica'}</button>
          </div>
        </div>

        <aside className="coach-panel">
          <div className="eval-card">
            <div><span>Avaliação</span><strong>{analysis ? displayEval(evalCp) : '—'}</strong></div>
            <div className="eval-track"><div className="eval-fill" style={{ width: `${Math.max(4, Math.min(96, 50 + evalCp / 20))}%` }} /></div>
            <small>Positivo favorece as brancas; negativo favorece as pretas.</small>
          </div>

          <div className="card coach-card">
            <span className="section-label">MELHOR JOGADA</span>
            <h2>{bestMove ? `${bestMove.slice(0, 2)} → ${bestMove.slice(2, 4)}` : thinking ? 'Calculando…' : '—'}</h2>
            <p>{analysis ? explainMove(game, analysis.bestMove) : 'O coach analisa a posição localmente e mostra a continuação mais forte.'}</p>
          </div>

          <div className="card">
            <div className="card-title"><strong>Top 3 linhas</strong><span>profundidade 15</span></div>
            <div className="lines">
              {analysis?.lines.map((line) => (
                <div className="line" key={line.multipv}>
                  <b>{line.multipv}</b>
                  <code>{line.pv.slice(0, 5).join(' ')}</code>
                  <span>{line.mate !== null ? `M${line.mate}` : displayEval(line.scoreCp ?? 0)}</span>
                </div>
              )) ?? <span className="muted">Aguardando análise…</span>}
            </div>
          </div>

          <div className="card settings-card">
            <div className="card-title"><strong>Força do adversário</strong><span>{engineElo}</span></div>
            <input type="range" min="1320" max="2400" step="40" value={engineElo} onChange={(e) => setEngineElo(Number(e.target.value))} />
            <small>O coach continua buscando o melhor lance; apenas o adversário é limitado.</small>
          </div>

          <div className="card moves-card">
            <div className="card-title"><strong>Partida</strong><span>{Math.ceil(history.length / 2)} lances</span></div>
            <div className="move-list">
              {Array.from({ length: Math.ceil(history.length / 2) }, (_, i) => (
                <div key={i}><b>{i + 1}.</b><span>{history[i * 2] ?? ''}</span><span>{history[i * 2 + 1] ?? ''}</span></div>
              ))}
            </div>
            <button className="review-button" onClick={reviewGame} disabled={!history.length || reviewing}>{reviewing ? 'Analisando partida…' : 'Analisar partida'}</button>
          </div>
        </aside>
      </section>

      {review.length > 0 && (
        <section className="review-section">
          <div className="review-header">
            <div><span className="eyebrow">PÓS-PARTIDA</span><h2>Revisão do jogo</h2></div>
            <div className="accuracy"><span>Precisão estimada</span><strong>{accuracy}%</strong></div>
          </div>
          <div className="review-grid">
            {review.map((row) => (
              <article className="review-row" key={row.ply}>
                <div className="move-number">{Math.ceil(row.ply / 2)}{row.ply % 2 === 0 ? '…' : '.'}</div>
                <div><strong>{row.san}</strong><small>{row.actual}</small></div>
                <span className={`quality q-${row.label.toLowerCase().replaceAll(' ', '-')}`}>{row.label}</span>
                <div><small>melhor</small><code>{row.best}</code></div>
                <div><small>perda</small><strong>{row.loss} cp</strong></div>
                <div><small>avaliação</small><strong>{displayEval(row.eval)}</strong></div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
