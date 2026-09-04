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
const ALL_SQUARES = RANKS.flatMap((rank) => FILES.map((file) => `${file}${rank}` as Square))
const PROMOTIONS: Array<{ piece: PieceSymbol; label: string }> = [
  { piece: 'q', label: 'Dama' },
  { piece: 'r', label: 'Torre' },
  { piece: 'b', label: 'Bispo' },
  { piece: 'n', label: 'Cavalo' },
]

type LastMove = { from: Square; to: Square } | null
type PendingPromotion = { from: Square; to: Square } | null

type ReviewMove = {
  ply: number
  san: string
  actual: string
  best: string
  loss: number
  label: string
  eval: number
}

function cloneGame(source: Chess) {
  const clone = new Chess()
  const pgn = source.pgn()
  if (pgn) clone.loadPgn(pgn)
  return clone
}

function uciToMove(uci: string) {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: (uci[4] || 'q') as PieceSymbol,
  }
}

function scoreOf(analysis: EngineAnalysis) {
  const line = analysis.lines[0]
  if (!line) return 0
  if (line.mate !== null) return Math.sign(line.mate) * (10000 - Math.min(99, Math.abs(line.mate)))
  return line.scoreCp ?? 0
}

function scoreForSide(whiteScore: number, side: Color) {
  return side === 'w' ? whiteScore : -whiteScore
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

function displayedSquares(side: Color) {
  const files = side === 'w' ? [...FILES] : [...FILES].reverse()
  const ranks = side === 'w' ? [...RANKS] : [...RANKS].reverse()
  return ranks.flatMap((rank) => files.map((file) => `${file}${rank}` as Square))
}

function isLightSquare(square: Square) {
  const file = FILES.indexOf(square[0] as (typeof FILES)[number])
  const rank = Number(square[1])
  return (file + rank) % 2 === 0
}

function findCheckedKing(game: Chess): Square | null {
  if (!game.inCheck()) return null
  for (const square of ALL_SQUARES) {
    const piece = game.get(square)
    if (piece?.type === 'k' && piece.color === game.turn()) return square
  }
  return null
}

function gameResult(game: Chess) {
  if (!game.isGameOver()) return null
  if (game.isCheckmate()) return game.turn() === 'w' ? 'Pretas venceram por xeque-mate.' : 'Brancas venceram por xeque-mate.'
  if (game.isStalemate()) return 'Empate por afogamento.'
  if (game.isThreefoldRepetition()) return 'Empate por repetição tripla.'
  if (game.isInsufficientMaterial()) return 'Empate por material insuficiente.'
  return 'Partida encerrada em empate.'
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
  if (move.isKingsideCastle() || move.isQueensideCastle()) reasons.push('melhora a segurança do rei com o roque')
  if (['d4', 'd5', 'e4', 'e5'].includes(move.to)) reasons.push('aumenta o controle do centro')
  if (['n', 'b'].includes(move.piece) && ['1', '8'].includes(move.from[1])) reasons.push('desenvolve uma peça')
  if (move.isPromotion()) reasons.push('promove um peão')
  if (!reasons.length) reasons.push('melhora a coordenação e a avaliação global da posição')
  return `Ideia principal: ${reasons.join('; ')}.`
}

function pvToSan(fen: string, pv: string[]) {
  const game = new Chess(fen)
  const san: string[] = []
  for (const uci of pv.slice(0, 6)) {
    try {
      san.push(game.move(uciToMove(uci)).san)
    } catch {
      break
    }
  }
  return san.join(' ')
}

function terminalScore(game: Chess, side: Color) {
  if (!game.isGameOver() || !game.isCheckmate()) return 0
  const winner: Color = game.turn() === 'w' ? 'b' : 'w'
  return winner === side ? 10000 : -10000
}

export default function App() {
  const gameRef = useRef(new Chess())
  const engineRef = useRef<StockfishEngine | null>(null)
  const requestRef = useRef(0)
  const sessionRef = useRef(0)

  const [playerSide, setPlayerSide] = useState<Color | null>(null)
  const [fen, setFen] = useState(gameRef.current.fen())
  const [selected, setSelected] = useState<Square | null>(null)
  const [lastMove, setLastMove] = useState<LastMove>(null)
  const [analysis, setAnalysis] = useState<EngineAnalysis | null>(null)
  const [thinking, setThinking] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [showHint, setShowHint] = useState(true)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion>(null)
  const [review, setReview] = useState<ReviewMove[]>([])

  const game = useMemo(() => cloneGame(gameRef.current), [fen])
  const boardSquares = useMemo(() => displayedSquares(playerSide ?? 'w'), [playerSide])
  const history = game.history()
  const checkedKing = findCheckedKing(game)
  const result = gameResult(game)
  const legalMoves = useMemo(() => selected ? game.moves({ square: selected, verbose: true }) : [], [game, selected])
  const legalTargets = useMemo(() => new Set(legalMoves.map((move) => move.to)), [legalMoves])
  const bestMove = playerSide && game.turn() === playerSide ? analysis?.bestMove : undefined
  const hintFrom = showHint && bestMove ? bestMove.slice(0, 2) : null
  const hintTo = showHint && bestMove ? bestMove.slice(2, 4) : null
  const userEval = playerSide && analysis ? scoreForSide(scoreOf(analysis), playerSide) : 0
  const isMyTurn = Boolean(playerSide && game.turn() === playerSide)
  const boardLocked = reviewing || game.isGameOver() || !playerSide

  useEffect(() => {
    const engine = new StockfishEngine()
    engineRef.current = engine
    return () => {
      requestRef.current += 1
      engine.destroy()
    }
  }, [])

  function commitGame(next: Chess, move: LastMove) {
    gameRef.current = next
    setFen(next.fen())
    setLastMove(move)
    setSelected(null)
    setPendingPromotion(null)
  }

  async function analyzePosition(position: Chess, side: Color, session: number) {
    const engine = engineRef.current
    if (!engine || position.isGameOver()) {
      setAnalysis(null)
      setThinking(false)
      return
    }

    const expectedFen = position.fen()
    const requestId = ++requestRef.current
    engine.stop()
    setThinking(true)
    setEngineError(null)

    try {
      const response = await engine.analyze(expectedFen, position.turn() === side ? 14 : 11, position.turn() === side ? 3 : 1)
      if (requestRef.current !== requestId || sessionRef.current !== session) return
      if (gameRef.current.fen() !== expectedFen) return
      setAnalysis(response)
    } catch (error) {
      if (requestRef.current !== requestId || sessionRef.current !== session) return
      setEngineError(error instanceof Error ? error.message : 'Não foi possível analisar a posição.')
    } finally {
      if (requestRef.current === requestId) setThinking(false)
    }
  }

  function startWithSide(side: Color) {
    sessionRef.current += 1
    requestRef.current += 1
    engineRef.current?.stop()
    const next = new Chess()
    gameRef.current = next
    setPlayerSide(side)
    setFen(next.fen())
    setSelected(null)
    setLastMove(null)
    setAnalysis(null)
    setReview([])
    setEngineError(null)
    setPendingPromotion(null)
    setThinking(false)
    void analyzePosition(next, side, sessionRef.current)
  }

  function executeMove(from: Square, to: Square, promotion?: PieceSymbol) {
    if (boardLocked) return
    const current = cloneGame(gameRef.current)
    const movingColor = current.turn()
    const piece = current.get(from)
    if (!piece || piece.color !== movingColor) return

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
      requestRef.current += 1
      engineRef.current?.stop()
      setAnalysis(null)
      setReview([])
      commitGame(current, { from: move.from, to: move.to })
      if (playerSide && !current.isGameOver()) void analyzePosition(current, playerSide, sessionRef.current)
    } catch {
      setSelected(null)
    }
  }

  function clickSquare(square: Square) {
    if (boardLocked) return
    const current = gameRef.current
    const piece = current.get(square)

    if (!selected) {
      if (piece?.color === current.turn()) setSelected(square)
      return
    }

    if (piece?.color === current.turn()) {
      setSelected(square)
      return
    }

    executeMove(selected, square)
  }

  function dragStart(square: Square, event: React.DragEvent) {
    if (boardLocked || gameRef.current.get(square)?.color !== gameRef.current.turn()) {
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
    if (from && ALL_SQUARES.includes(from)) executeMove(from, square)
  }

  function undoMove() {
    if (reviewing || !history.length || !playerSide) return
    sessionRef.current += 1
    requestRef.current += 1
    engineRef.current?.stop()
    const next = cloneGame(gameRef.current)
    next.undo()
    const verbose = next.history({ verbose: true })
    const latest = verbose.at(-1)
    commitGame(next, latest ? { from: latest.from, to: latest.to } : null)
    setAnalysis(null)
    setReview([])
    setEngineError(null)
    setThinking(false)
    void analyzePosition(next, playerSide, sessionRef.current)
  }

  function resetGame() {
    if (!playerSide) return
    startWithSide(playerSide)
  }

  async function reviewGame() {
    const engine = engineRef.current
    const side = playerSide
    const source = cloneGame(gameRef.current)
    if (!engine || !side || !source.history().length || reviewing) return

    requestRef.current += 1
    engine.stop()
    setThinking(false)
    setReviewing(true)
    setReview([])
    setEngineError(null)

    const replay = new Chess()
    const moves = source.history({ verbose: true })
    const rows: ReviewMove[] = []

    try {
      for (let index = 0; index < moves.length; index += 1) {
        const move = moves[index]
        const mover = replay.turn()
        const actual = `${move.from}${move.to}${move.promotion ?? ''}`

        if (mover !== side) {
          replay.move({ from: move.from, to: move.to, promotion: move.promotion })
          continue
        }

        const before = await engine.analyze(replay.fen(), 11, 1)
        const best = before.bestMove
        const beforeScore = scoreForSide(scoreOf(before), side)
        replay.move({ from: move.from, to: move.to, promotion: move.promotion })
        const afterScore = replay.isGameOver()
          ? terminalScore(replay, side)
          : scoreForSide(scoreOf(await engine.analyze(replay.fen(), 11, 1)), side)
        const loss = Math.max(0, Math.round(beforeScore - afterScore))

        rows.push({
          ply: index + 1,
          san: move.san,
          actual,
          best,
          loss,
          label: classify(loss, actual === best),
          eval: afterScore,
        })
        setReview([...rows])
      }
    } catch (error) {
      setEngineError(error instanceof Error ? error.message : 'A revisão não pôde ser concluída.')
    } finally {
      setReviewing(false)
      if (playerSide && !gameRef.current.isGameOver()) void analyzePosition(gameRef.current, playerSide, sessionRef.current)
    }
  }

  const accuracy = review.length
    ? Math.max(0, Math.round(100 - review.reduce((sum, row) => sum + Math.min(row.loss, 400), 0) / review.length / 4))
    : null

  if (!playerSide) {
    return (
      <main className="setup-shell">
        <section className="setup-card">
          <div className="brand-mark">XC</div>
          <span className="eyebrow">STOCKFISH 18 · LOCAL</span>
          <h1>Escolha o seu lado</h1>
          <p>Você controlará as duas cores no tabuleiro. O coach calcula avaliação e recomendações sempre pensando no lado que você escolher.</p>
          <div className="side-options">
            <button className="side-option white-option" onClick={() => startWithSide('w')}>
              <span className="side-piece">♔</span>
              <strong>Jogar pelas brancas</strong>
              <small>Você recebe a primeira recomendação imediatamente.</small>
            </button>
            <button className="side-option black-option" onClick={() => startWithSide('b')}>
              <span className="side-piece">♚</span>
              <strong>Jogar pelas pretas</strong>
              <small>Primeiro mova as brancas; depois o coach calcula sua resposta.</small>
            </button>
          </div>
          <div className="setup-note">Sem adversário automático. Você reproduz os lances das duas cores e o sistema orienta somente o seu lado.</div>
        </section>
      </main>
    )
  }

  const topLabel = playerSide === 'w' ? 'Pretas · adversário' : 'Brancas · adversário'
  const bottomLabel = playerSide === 'w' ? 'Brancas · seu lado' : 'Pretas · seu lado'

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark small">XC</div>
          <div><span className="eyebrow">ANÁLISE LOCAL</span><h1>Xadrez Coach</h1></div>
        </div>
        <div className="top-actions">
          <button className="ghost-button" onClick={() => setPlayerSide(null)}>Trocar lado</button>
          <div className={`engine-status ${engineError ? 'error' : ''}`}>
            <span className={thinking || reviewing ? 'pulse' : 'dot'} />
            {engineError ? 'Falha na engine' : reviewing ? 'Revisando partida' : thinking ? 'Calculando' : 'Coach pronto'}
          </div>
        </div>
      </header>

      {engineError && <div className="error-banner"><strong>Stockfish:</strong> {engineError}</div>}

      <section className="game-layout">
        <div className="board-column">
          <div className="player-row opponent-row"><div><span className="player-dot opponent" /><strong>{topLabel}</strong></div><span>Você controla os lances</span></div>

          <div className="board-frame">
            <div className="board" role="grid" aria-label={`Tabuleiro orientado pelas ${playerSide === 'w' ? 'brancas' : 'pretas'}`}>
              {boardSquares.map((square, index) => {
                const piece = game.get(square)
                const target = legalTargets.has(square)
                const last = lastMove?.from === square || lastMove?.to === square
                const hintedFrom = hintFrom === square
                const hintedTo = hintTo === square
                const row = Math.floor(index / 8)
                const col = index % 8
                return (
                  <button
                    key={square}
                    type="button"
                    className={`square ${isLightSquare(square) ? 'light' : 'dark'} ${selected === square ? 'selected' : ''} ${target ? 'target' : ''} ${last ? 'last-move' : ''} ${checkedKing === square ? 'checked' : ''} ${hintedFrom ? 'hint-from' : ''} ${hintedTo ? 'hint-to' : ''}`}
                    onClick={() => clickSquare(square)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => dropOnSquare(square, event)}
                    aria-label={square}
                  >
                    {piece && (
                      <span
                        className={`piece ${piece.color}`}
                        draggable={!boardLocked && piece.color === game.turn()}
                        onDragStart={(event) => dragStart(square, event)}
                      >
                        {PIECES[`${piece.color}${piece.type}`]}
                      </span>
                    )}
                    {col === 0 && <span className="coord rank-label">{square[1]}</span>}
                    {row === 7 && <span className="coord file-label">{square[0]}</span>}
                  </button>
                )
              })}
            </div>
            {reviewing && <div className="board-overlay"><span className="spinner" /><strong>Analisando seus lances</strong></div>}
          </div>

          <div className="player-row my-row"><div><span className="player-dot mine" /><strong>{bottomLabel}</strong></div><span>{isMyTurn ? 'Sua recomendação está ativa' : 'Aguardando o lance adversário'}</span></div>

          <div className="turn-banner">
            <div>
              <span className={`turn-chip ${isMyTurn ? 'mine' : 'opponent'}`}>{isMyTurn ? 'SEU LADO' : 'ADVERSÁRIO'}</span>
              <strong>{result ?? (isMyTurn ? 'Faça o lance recomendado ou escolha outra jogada.' : `Mova manualmente as ${game.turn() === 'w' ? 'brancas' : 'pretas'}.`)}</strong>
            </div>
            <span>{game.turn() === 'w' ? 'Brancas jogam' : 'Pretas jogam'}</span>
          </div>

          <div className="actions">
            <button onClick={resetGame}>Nova partida</button>
            <button onClick={undoMove} disabled={!history.length || reviewing}>Desfazer lance</button>
            <button className="primary" onClick={() => setShowHint((value) => !value)}>{showHint ? 'Ocultar dica' : 'Mostrar dica'}</button>
          </div>
        </div>

        <aside className="coach-panel">
          <section className="eval-card">
            <div className="card-heading"><div><span className="section-label">AVALIAÇÃO DO SEU LADO</span><strong className="big-eval">{analysis ? displayEval(userEval) : '—'}</strong></div><span className="side-badge">{playerSide === 'w' ? 'Brancas' : 'Pretas'}</span></div>
            <div className="eval-track"><div className="eval-fill" style={{ width: `${Math.max(4, Math.min(96, 50 + userEval / 20))}%` }} /></div>
            <small>Positivo significa vantagem para o lado que você escolheu.</small>
          </section>

          <section className={`card recommendation-card ${isMyTurn ? 'active' : ''}`}>
            <div className="card-title"><span className="section-label">MELHOR JOGADA PARA VOCÊ</span>{thinking && <span className="mini-loader" />}</div>
            {isMyTurn ? (
              <>
                <div className="move-hero">{bestMove ? <><b>{bestMove.slice(0, 2)}</b><span>→</span><b>{bestMove.slice(2, 4)}</b></> : <span className="muted">Calculando…</span>}</div>
                <p>{bestMove ? explainMove(game, bestMove) : 'O Stockfish está avaliando a melhor continuação para o seu lado.'}</p>
              </>
            ) : (
              <div className="waiting-coach"><strong>Primeiro mova o adversário</strong><p>Assim que você fizer o lance da outra cor, o coach recalcula a melhor resposta para o seu lado.</p></div>
            )}
          </section>

          <section className="card">
            <div className="card-title"><strong>Linhas candidatas</strong><span>{isMyTurn ? 'Top 3' : 'ocultas no turno adversário'}</span></div>
            <div className="lines">
              {isMyTurn && analysis?.lines.length ? analysis.lines.map((line) => {
                const score = line.mate !== null ? scoreForSide(Math.sign(line.mate) * 10000, playerSide) : scoreForSide(line.scoreCp ?? 0, playerSide)
                return (
                  <div className="line" key={line.multipv}>
                    <b>{line.multipv}</b>
                    <code>{pvToSan(game.fen(), line.pv)}</code>
                    <span>{line.mate !== null ? (score > 0 ? 'M+' : 'M−') : displayEval(score)}</span>
                  </div>
                )
              }) : <div className="empty-state">As variantes aparecem somente quando é a vez do seu lado.</div>}
            </div>
          </section>

          <section className="card moves-card">
            <div className="card-title"><strong>Partida</strong><span>{history.length} meios-lances</span></div>
            <div className="move-list">
              {Array.from({ length: Math.ceil(history.length / 2) }, (_, index) => (
                <div key={index}><b>{index + 1}.</b><span>{history[index * 2] ?? ''}</span><span>{history[index * 2 + 1] ?? ''}</span></div>
              ))}
              {!history.length && <div className="empty-state">Nenhum lance registrado.</div>}
            </div>
            <button className="review-button" onClick={reviewGame} disabled={!history.length || reviewing}>Analisar meus lances</button>
          </section>
        </aside>
      </section>

      {review.length > 0 && (
        <section className="review-section">
          <div className="review-header"><div><span className="eyebrow">PÓS-PARTIDA</span><h2>Revisão do seu lado</h2></div><div className="accuracy"><span>Precisão estimada</span><strong>{accuracy}%</strong></div></div>
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

      {pendingPromotion && (
        <div className="modal-backdrop" onClick={() => setPendingPromotion(null)}>
          <div className="promotion-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <span className="section-label">PROMOÇÃO</span><h2>Escolha a peça</h2>
            <div className="promotion-grid">
              {PROMOTIONS.map(({ piece, label }) => (
                <button key={piece} onClick={() => executeMove(pendingPromotion.from, pendingPromotion.to, piece)}>
                  <span>{PIECES[`${game.turn()}${piece}`]}</span><small>{label}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
