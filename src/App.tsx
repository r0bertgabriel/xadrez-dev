import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js'
import { StockfishEngine, type EngineAnalysis } from './engine'
import './styles.css'

const PIECES: Record<string, string> = {
  wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
  bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚',
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const
const SQUARES = RANKS.flatMap((rank) => FILES.map((file) => `${file}${rank}` as Square))
const PROMOTIONS: Array<{ piece: PieceSymbol; label: string }> = [
  { piece: 'q', label: 'Dama' },
  { piece: 'r', label: 'Torre' },
  { piece: 'b', label: 'Bispo' },
  { piece: 'n', label: 'Cavalo' },
]

type LastMove = { from: Square; to: Square } | null

type PendingPromotion = {
  from: Square
  to: Square
}

type ReviewMove = {
  ply: number
  color: Color
  san: string
  actual: string
  best: string
  loss: number
  label: string
  eval: number
}

function uciToMove(uci: string) {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: (uci[4] || 'q') as PieceSymbol,
  }
}

function cloneGame(source: Chess) {
  const clone = new Chess()
  const pgn = source.pgn()
  if (pgn) clone.loadPgn(pgn)
  return clone
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
  if (loss <= 20) return 'Excelente'
  if (loss <= 55) return 'Bom'
  if (loss <= 110) return 'Imprecisão'
  if (loss <= 240) return 'Erro'
  return 'Erro grave'
}

function gameResult(game: Chess) {
  if (!game.isGameOver()) return null
  if (game.isCheckmate()) return game.turn() === 'w' ? 'Stockfish venceu por xeque-mate.' : 'Você venceu por xeque-mate.'
  if (game.isStalemate()) return 'Empate por afogamento.'
  if (game.isThreefoldRepetition()) return 'Empate por repetição tripla.'
  if (game.isInsufficientMaterial()) return 'Empate por material insuficiente.'
  return 'Partida encerrada em empate.'
}

function findCheckedKing(game: Chess): Square | null {
  if (!game.inCheck()) return null
  const color = game.turn()
  for (const square of SQUARES) {
    const piece = game.get(square)
    if (piece?.type === 'k' && piece.color === color) return square
  }
  return null
}

function explainMove(game: Chess, uci: string) {
  if (!uci || uci === '(none)') return 'Não há lance disponível.'
  const probe = cloneGame(game)
  let move: Move
  try {
    move = probe.move(uciToMove(uci))
  } catch {
    return 'O Stockfish considera esta a continuação mais forte da posição.'
  }

  const reasons: string[] = []
  if (move.isCapture()) reasons.push(`captura em ${move.to}`)
  if (probe.inCheck()) reasons.push('cria xeque')
  if (move.isKingsideCastle() || move.isQueensideCastle()) reasons.push('coloca o rei em segurança com o roque')
  if (['d4', 'd5', 'e4', 'e5'].includes(move.to)) reasons.push('reforça o controle do centro')
  if (['n', 'b'].includes(move.piece) && ['1', '8'].includes(move.from[1])) reasons.push('desenvolve uma peça')
  if (move.isPromotion()) reasons.push('promove um peão')
  if (!reasons.length) reasons.push('melhora a coordenação e a avaliação global da posição')
  return `Ideia principal: ${reasons.join('; ')}.`
}

function pvToSan(fen: string, pv: string[]) {
  const game = new Chess(fen)
  const result: string[] = []
  for (const uci of pv.slice(0, 6)) {
    try {
      const move = game.move(uciToMove(uci))
      result.push(move.san)
    } catch {
      break
    }
  }
  return result.join(' ')
}

function Arrow({ move }: { move?: string }) {
  if (!move || move.length < 4) return null
  const center = (square: string) => {
    const x = FILES.indexOf(square[0] as (typeof FILES)[number]) + 0.5
    const rank = Number(square[1])
    return { x: x * 12.5, y: (8.5 - rank) * 12.5 }
  }
  const from = center(move.slice(0, 2))
  const to = center(move.slice(2, 4))
  return (
    <svg className="hint-arrow" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <marker id="arrowhead" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
          <path d="M0,0 L4,2 L0,4 Z" />
        </marker>
      </defs>
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd="url(#arrowhead)" />
    </svg>
  )
}

export default function App() {
  const gameRef = useRef(new Chess())
  const coachEngineRef = useRef<StockfishEngine | null>(null)
  const opponentEngineRef = useRef<StockfishEngine | null>(null)
  const sessionRef = useRef(0)
  const coachRequestRef = useRef(0)

  const [fen, setFen] = useState(gameRef.current.fen())
  const [selected, setSelected] = useState<Square | null>(null)
  const [lastMove, setLastMove] = useState<LastMove>(null)
  const [analysis, setAnalysis] = useState<EngineAnalysis | null>(null)
  const [coachThinking, setCoachThinking] = useState(false)
  const [opponentThinking, setOpponentThinking] = useState(false)
  const [engineElo, setEngineElo] = useState(1500)
  const [showHint, setShowHint] = useState(true)
  const [review, setReview] = useState<ReviewMove[]>([])
  const [reviewing, setReviewing] = useState(false)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null)

  const game = useMemo(() => cloneGame(gameRef.current), [fen])
  const history = game.history()
  const checkedKing = findCheckedKing(game)
  const result = gameResult(game)
  const legalMoves = useMemo(() => selected ? game.moves({ square: selected, verbose: true }) : [], [game, selected])
  const legalTargets = useMemo(() => new Set(legalMoves.map((move) => move.to)), [legalMoves])
  const evalCp = analysis ? scoreOf(analysis) : 0
  const bestMove = analysis?.bestMove
  const boardLocked = opponentThinking || reviewing || game.isGameOver() || game.turn() !== 'w'

  useEffect(() => {
    const coachEngine = new StockfishEngine()
    const opponentEngine = new StockfishEngine()
    coachEngineRef.current = coachEngine
    opponentEngineRef.current = opponentEngine
    void refreshCoach(gameRef.current, sessionRef.current)

    return () => {
      coachRequestRef.current += 1
      coachEngine.destroy()
      opponentEngine.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commitGame(next: Chess, move: LastMove) {
    gameRef.current = next
    setFen(next.fen())
    setLastMove(move)
    setSelected(null)
    setPendingPromotion(null)
  }

  async function refreshCoach(position: Chess, session: number) {
    const engine = coachEngineRef.current
    if (!engine || position.isGameOver()) {
      setAnalysis(null)
      return
    }

    const expectedFen = position.fen()
    const requestId = ++coachRequestRef.current
    engine.stop()
    setCoachThinking(true)

    try {
      const response = await engine.analyze(expectedFen, 14, 3)
      if (sessionRef.current !== session) return
      if (coachRequestRef.current !== requestId) return
      if (gameRef.current.fen() !== expectedFen) return
      setAnalysis(response)
      setEngineError(null)
    } catch (error) {
      if (coachRequestRef.current !== requestId || sessionRef.current !== session) return
      setEngineError(error instanceof Error ? error.message : 'Não foi possível analisar a posição.')
    } finally {
      if (coachRequestRef.current === requestId) setCoachThinking(false)
    }
  }

  async function playComputer(position: Chess, session: number) {
    const engine = opponentEngineRef.current
    if (!engine || position.isGameOver()) return

    const expectedFen = position.fen()
    setOpponentThinking(true)
    setAnalysis(null)
    setEngineError(null)

    try {
      const uci = await engine.bestMove(expectedFen, engineElo, 500)
      if (sessionRef.current !== session || gameRef.current.fen() !== expectedFen) return

      const moveData = uciToMove(uci)
      const next = cloneGame(position)
      const move = next.move(moveData)
      commitGame(next, { from: move.from, to: move.to })

      if (!next.isGameOver()) void refreshCoach(next, session)
    } catch (error) {
      if (sessionRef.current === session && gameRef.current.fen() === expectedFen) {
        setEngineError(error instanceof Error ? error.message : 'O adversário não conseguiu calcular a resposta.')
      }
    } finally {
      if (sessionRef.current === session) setOpponentThinking(false)
    }
  }

  function executeHumanMove(from: Square, to: Square, promotion?: PieceSymbol) {
    if (boardLocked) return
    const current = cloneGame(gameRef.current)
    const candidates = current.moves({ square: from, verbose: true }).filter((move) => move.to === to)
    if (!candidates.length) {
      setSelected(null)
      return
    }

    if (!promotion && candidates.some((move) => Boolean(move.promotion))) {
      setPendingPromotion({ from, to })
      return
    }

    try {
      const move = current.move({ from, to, promotion })
      const session = sessionRef.current
      coachRequestRef.current += 1
      coachEngineRef.current?.stop()
      setCoachThinking(false)
      setAnalysis(null)
      setReview([])
      commitGame(current, { from: move.from, to: move.to })

      if (!current.isGameOver()) void playComputer(current, session)
    } catch {
      setSelected(null)
    }
  }

  function clickSquare(square: Square) {
    if (boardLocked) return
    const current = gameRef.current
    const piece = current.get(square)

    if (!selected) {
      if (piece?.color === 'w') setSelected(square)
      return
    }

    if (piece?.color === 'w') {
      setSelected(square)
      return
    }

    executeHumanMove(selected, square)
  }

  function dragStart(square: Square, event: React.DragEvent) {
    if (boardLocked || gameRef.current.get(square)?.color !== 'w') {
      event.preventDefault()
      return
    }
    setSelected(square)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', square)
  }

  function dropOnSquare(square: Square, event: React.DragEvent) {
    event.preventDefault()
    if (boardLocked) return
    const from = event.dataTransfer.getData('text/plain') as Square
    if (from && SQUARES.includes(from)) executeHumanMove(from, square)
  }

  function resetGame() {
    sessionRef.current += 1
    coachRequestRef.current += 1
    coachEngineRef.current?.stop()
    opponentEngineRef.current?.stop()
    const next = new Chess()
    commitGame(next, null)
    setReview([])
    setAnalysis(null)
    setEngineError(null)
    setOpponentThinking(false)
    setCoachThinking(false)
    void refreshCoach(next, sessionRef.current)
  }

  function undoPair() {
    if (opponentThinking || reviewing || !history.length) return
    sessionRef.current += 1
    coachRequestRef.current += 1
    coachEngineRef.current?.stop()
    opponentEngineRef.current?.stop()

    const next = cloneGame(gameRef.current)
    next.undo()
    if (next.turn() === 'b' && next.history().length) next.undo()

    const verbose = next.history({ verbose: true })
    const latest = verbose.at(-1)
    commitGame(next, latest ? { from: latest.from, to: latest.to } : null)
    setReview([])
    setAnalysis(null)
    setEngineError(null)
    setOpponentThinking(false)
    setCoachThinking(false)
    void refreshCoach(next, sessionRef.current)
  }

  async function retryComputer() {
    if (opponentThinking || gameRef.current.turn() !== 'b' || gameRef.current.isGameOver()) return
    await playComputer(cloneGame(gameRef.current), sessionRef.current)
  }

  async function reviewGame() {
    const engine = coachEngineRef.current
    const source = cloneGame(gameRef.current)
    if (!engine || !source.history().length || reviewing || opponentThinking) return

    coachRequestRef.current += 1
    engine.stop()
    setCoachThinking(false)
    setReviewing(true)
    setReview([])
    setEngineError(null)

    const replay = new Chess()
    const verbose = source.history({ verbose: true })
    const rows: ReviewMove[] = []

    try {
      for (let index = 0; index < verbose.length; index += 1) {
        const move = verbose[index]
        const mover = replay.turn()
        const before = await engine.analyze(replay.fen(), 11, 1)
        const best = before.bestMove
        const bestScore = scoreOf(before)
        const actualUci = `${move.from}${move.to}${move.promotion ?? ''}`
        replay.move({ from: move.from, to: move.to, promotion: move.promotion })
        const after = replay.isGameOver() ? null : await engine.analyze(replay.fen(), 11, 1)
        const afterScore = after ? scoreOf(after) : bestScore
        const rawLoss = mover === 'w' ? bestScore - afterScore : afterScore - bestScore
        const loss = Math.max(0, Math.round(rawLoss))
        rows.push({
          ply: index + 1,
          color: mover,
          san: move.san,
          actual: actualUci,
          best,
          loss,
          label: classify(loss, actualUci === best),
          eval: afterScore,
        })
        setReview([...rows])
      }
    } catch (error) {
      setEngineError(error instanceof Error ? error.message : 'A revisão da partida foi interrompida.')
    } finally {
      setReviewing(false)
      if (!gameRef.current.isGameOver()) void refreshCoach(gameRef.current, sessionRef.current)
    }
  }

  const humanReview = review.filter((row) => row.color === 'w')
  const accuracy = humanReview.length
    ? Math.max(0, Math.round(100 - humanReview.reduce((sum, row) => sum + Math.min(row.loss, 400), 0) / humanReview.length / 4))
    : null

  const status = engineError
    ? engineError
    : reviewing
      ? `Revisando partida… ${review.length}/${history.length}`
      : opponentThinking
        ? `Stockfish ${engineElo} está pensando…`
        : result
          ? result
          : game.turn() === 'b'
            ? 'Aguardando resposta do Stockfish.'
            : coachThinking
              ? 'Sua vez — o coach está refinando a dica em segundo plano.'
              : 'Sua vez.'

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="eyebrow">STOCKFISH 18 · 100% LOCAL</span>
          <h1>Xadrez Coach</h1>
          <p>Jogue, receba orientação em tempo real e revise suas decisões sem API paga.</p>
        </div>
        <div className={`engine-status ${engineError ? 'error' : ''}`}>
          <span className={opponentThinking || coachThinking || reviewing ? 'pulse' : 'dot'} />
          {status}
        </div>
      </header>

      <section className="game-layout">
        <div className="board-column">
          <div className="player-row opponent-row">
            <div className="player-identity"><span className="avatar">SF</span><div><strong>Stockfish</strong><small>Adversário</small></div></div>
            <span className="elo-pill">{engineElo} Elo</span>
          </div>

          <div className={`board-wrap ${boardLocked ? 'locked' : ''}`}>
            <div className="board" role="grid" aria-label="Tabuleiro de xadrez">
              {SQUARES.map((square, index) => {
                const piece = game.get(square)
                const light = (Math.floor(index / 8) + index) % 2 === 0
                const target = legalTargets.has(square)
                const isLast = Boolean(lastMove && (lastMove.from === square || lastMove.to === square))
                const hintedFrom = showHint && bestMove?.slice(0, 2) === square
                const hintedTo = showHint && bestMove?.slice(2, 4) === square
                const checked = checkedKing === square
                const draggable = !boardLocked && piece?.color === 'w'

                return (
                  <button
                    key={square}
                    type="button"
                    className={`square ${light ? 'light' : 'dark'} ${selected === square ? 'selected' : ''} ${target ? 'target' : ''} ${isLast ? 'last-move' : ''} ${hintedFrom ? 'hint-from' : ''} ${hintedTo ? 'hint-to' : ''} ${checked ? 'in-check' : ''}`}
                    onClick={() => clickSquare(square)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => dropOnSquare(square, event)}
                    aria-label={square}
                    aria-pressed={selected === square}
                  >
                    {piece && (
                      <span
                        className={`piece ${piece.color}`}
                        draggable={draggable}
                        onDragStart={(event) => dragStart(square, event)}
                      >
                        {PIECES[`${piece.color}${piece.type}`]}
                      </span>
                    )}
                    {square[0] === 'a' && <small className="rank">{square[1]}</small>}
                    {square[1] === '1' && <small className="file">{square[0]}</small>}
                  </button>
                )
              })}
            </div>
            {showHint && !opponentThinking && game.turn() === 'w' && <Arrow move={bestMove} />}
            {opponentThinking && <div className="board-overlay"><span className="spinner" /><strong>Stockfish calculando…</strong></div>}
          </div>

          <div className="player-row">
            <div className="player-identity"><span className="avatar human">VOCÊ</span><div><strong>Você</strong><small>Brancas</small></div></div>
            <span className="turn-pill">{game.turn() === 'w' && !result ? 'Sua vez' : result ? 'Encerrada' : 'Aguardando'}</span>
          </div>

          <div className="actions">
            <button type="button" onClick={resetGame}>Nova partida</button>
            <button type="button" onClick={undoPair} disabled={!history.length || opponentThinking || reviewing}>Desfazer rodada</button>
            <button type="button" className="primary" onClick={() => setShowHint((value) => !value)}>{showHint ? 'Ocultar dica' : 'Mostrar dica'}</button>
          </div>

          {engineError && game.turn() === 'b' && !opponentThinking && !game.isGameOver() && (
            <button type="button" className="retry-button" onClick={retryComputer}>Tentar resposta do Stockfish novamente</button>
          )}
        </div>

        <aside className="coach-panel">
          <div className="eval-card">
            <div className="eval-heading"><div><span>Avaliação</span><small>perspectiva das brancas</small></div><strong>{analysis ? displayEval(evalCp) : '—'}</strong></div>
            <div className="eval-track"><div className="eval-fill" style={{ width: `${Math.max(4, Math.min(96, 50 + evalCp / 20))}%` }} /></div>
          </div>

          <div className="card coach-card">
            <div className="card-title"><span className="section-label">MELHOR JOGADA</span>{coachThinking && <span className="mini-loading">refinando…</span>}</div>
            <h2>{bestMove && game.turn() === 'w' ? `${bestMove.slice(0, 2)} → ${bestMove.slice(2, 4)}` : coachThinking ? 'Calculando…' : '—'}</h2>
            <p>{analysis && game.turn() === 'w' ? explainMove(game, analysis.bestMove) : 'A dica aparece quando for sua vez e é recalculada após cada resposta do adversário.'}</p>
          </div>

          <div className="card">
            <div className="card-title"><strong>Linhas candidatas</strong><span>Top 3</span></div>
            <div className="lines">
              {analysis?.lines.length ? analysis.lines.map((line) => (
                <div className="line" key={line.multipv}>
                  <b>{line.multipv}</b>
                  <code title={pvToSan(fen, line.pv)}>{pvToSan(fen, line.pv) || '—'}</code>
                  <span>{line.mate !== null ? `M${line.mate}` : displayEval(line.scoreCp ?? 0)}</span>
                </div>
              )) : <span className="muted">Aguardando uma análise válida da posição atual.</span>}
            </div>
          </div>

          <div className="card settings-card">
            <div className="card-title"><strong>Força do adversário</strong><span>{engineElo}</span></div>
            <input type="range" min="1320" max="2400" step="40" value={engineElo} onChange={(event) => setEngineElo(Number(event.target.value))} disabled={opponentThinking} />
            <div className="range-labels"><span>Treino</span><span>Forte</span></div>
            <small>O nível limita apenas o adversário. O coach continua buscando a melhor continuação.</small>
          </div>

          <div className="card moves-card">
            <div className="card-title"><strong>Partida</strong><span>{Math.ceil(history.length / 2)} lances</span></div>
            <div className="move-list">
              {history.length ? Array.from({ length: Math.ceil(history.length / 2) }, (_, index) => (
                <div key={index}><b>{index + 1}.</b><span>{history[index * 2] ?? ''}</span><span>{history[index * 2 + 1] ?? ''}</span></div>
              )) : <span className="muted">A partida ainda não começou.</span>}
            </div>
            <button className="review-button" type="button" onClick={reviewGame} disabled={!history.length || reviewing || opponentThinking}>{reviewing ? 'Analisando partida…' : 'Analisar partida'}</button>
          </div>
        </aside>
      </section>

      {review.length > 0 && (
        <section className="review-section">
          <div className="review-header">
            <div><span className="eyebrow">REVISÃO</span><h2>Análise lance a lance</h2><p>A precisão considera apenas seus lances de brancas.</p></div>
            <div className="accuracy"><span>Precisão estimada</span><strong>{accuracy ?? '—'}{accuracy !== null ? '%' : ''}</strong></div>
          </div>
          <div className="review-grid">
            {review.map((row) => (
              <article className={`review-row ${row.color === 'w' ? 'human-move' : 'engine-move'}`} key={row.ply}>
                <div className="move-number">{Math.ceil(row.ply / 2)}{row.color === 'b' ? '…' : '.'}</div>
                <div><strong>{row.san}</strong><small>{row.color === 'w' ? 'Você' : 'Stockfish'} · {row.actual}</small></div>
                <span className={`quality q-${row.label.toLowerCase().replaceAll(' ', '-')}`}>{row.label}</span>
                <div><small>melhor</small><code>{row.best}</code></div>
                <div><small>perda</small><strong>{row.loss} cp</strong></div>
                <div><small>avaliação</small><strong>{displayEval(row.eval)}</strong></div>
              </article>
            ))}
          </div>
        </section>
      )}

      {pendingPromotion && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPendingPromotion(null)}>
          <div className="promotion-dialog" role="dialog" aria-modal="true" aria-label="Escolha a peça para promoção" onMouseDown={(event) => event.stopPropagation()}>
            <span className="eyebrow">PROMOÇÃO</span>
            <h2>Escolha a peça</h2>
            <div className="promotion-options">
              {PROMOTIONS.map(({ piece, label }) => (
                <button key={piece} type="button" onClick={() => executeHumanMove(pendingPromotion.from, pendingPromotion.to, piece)}>
                  <span>{PIECES[`w${piece}`]}</span><small>{label}</small>
                </button>
              ))}
            </div>
            <button type="button" className="cancel-promotion" onClick={() => setPendingPromotion(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </main>
  )
}
