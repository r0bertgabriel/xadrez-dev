import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Square } from 'chess.js'
import { StockfishClient, type AnalysisResult } from './engine/StockfishClient'
import {
  calculateAccuracy,
  coachingReasons,
  formatScore,
  gradeMove,
  scoreFromPerspective,
  scoreToCentipawns,
  uciToSan,
  type MoveGrade,
} from './chess/analysis'

type MoveRecord = {
  ply: number
  side: 'Você' | 'Stockfish'
  san: string
  uci: string
  grade?: MoveGrade
  centipawnLoss?: number
  evalAfter?: number
}

type Difficulty = {
  id: string
  label: string
  depth: number
  description: string
}

const DIFFICULTIES: Difficulty[] = [
  { id: 'casual', label: 'Casual', depth: 8, description: 'Responde rápido e deixa mais oportunidades.' },
  { id: 'strong', label: 'Forte', depth: 13, description: 'Bom equilíbrio entre força e velocidade.' },
  { id: 'expert', label: 'Especialista', depth: 17, description: 'Análise profunda para partidas sérias.' },
  { id: 'max', label: 'Máxima', depth: 20, description: 'Mais cálculo local e maior uso de CPU.' },
]

const PIECES: Record<string, string> = {
  wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
  bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚',
}

function squareCenter(square: string) {
  const file = square.charCodeAt(0) - 97
  const rank = Number(square[1])
  return { x: file + 0.5, y: 8 - rank + 0.5 }
}

function moveToUci(from: string, to: string, promotion?: string) {
  return `${from}${to}${promotion ?? ''}`
}

export default function App() {
  const engineRef = useRef(new StockfishClient())
  const sessionRef = useRef(0)
  const [fen, setFen] = useState(() => new Chess().fen())
  const [selected, setSelected] = useState<Square | null>(null)
  const [coach, setCoach] = useState<AnalysisResult | null>(null)
  const [coachLoading, setCoachLoading] = useState(true)
  const [engineReady, setEngineReady] = useState(false)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [thinking, setThinking] = useState(false)
  const [coachVisible, setCoachVisible] = useState(true)
  const [difficulty, setDifficulty] = useState('strong')
  const [records, setRecords] = useState<MoveRecord[]>([])
  const [showReport, setShowReport] = useState(false)

  const chess = useMemo(() => new Chess(fen), [fen])
  const currentDifficulty = DIFFICULTIES.find((item) => item.id === difficulty) ?? DIFFICULTIES[1]
  const legalTargets = useMemo(() => {
    if (!selected) return new Set<string>()
    return new Set(chess.moves({ square: selected, verbose: true }).map((move) => move.to))
  }, [chess, selected])

  const humanLosses = records
    .filter((record) => record.side === 'Você' && typeof record.centipawnLoss === 'number')
    .map((record) => record.centipawnLoss as number)
  const accuracy = calculateAccuracy(humanLosses)
  const bestMove = coach?.bestMove ?? null
  const bestMoveSan = uciToSan(fen, bestMove)
  const coachReasons = coach ? coachingReasons(fen, coach) : []

  useEffect(() => {
    const engine = engineRef.current
    let active = true
    engine.init()
      .then(() => {
        if (!active) return
        setEngineReady(true)
        return refreshCoach(fen, sessionRef.current)
      })
      .catch((error) => {
        if (!active) return
        setEngineError(error instanceof Error ? error.message : 'Não foi possível iniciar o Stockfish.')
        setCoachLoading(false)
      })

    return () => {
      active = false
      engine.destroy()
    }
    // A engine é inicializada apenas uma vez por sessão da página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshCoach(positionFen: string, session: number) {
    if (new Chess(positionFen).isGameOver()) {
      setCoach(null)
      setCoachLoading(false)
      return
    }

    setCoachLoading(true)
    try {
      const result = await engineRef.current.analyze(positionFen, { depth: 16, multiPv: 3 })
      if (sessionRef.current !== session) return
      setCoach(result)
    } catch (error) {
      if (sessionRef.current === session) {
        setEngineError(error instanceof Error ? error.message : 'Falha durante a análise da posição.')
      }
    } finally {
      if (sessionRef.current === session) setCoachLoading(false)
    }
  }

  async function handleSquareClick(square: Square) {
    if (thinking || showReport || chess.isGameOver() || chess.turn() !== 'w') return

    const piece = chess.get(square)
    if (!selected) {
      if (piece?.color === 'w') setSelected(square)
      return
    }

    if (piece?.color === 'w') {
      setSelected(square)
      return
    }

    if (!legalTargets.has(square)) {
      setSelected(null)
      return
    }

    const from = selected
    setSelected(null)
    await playHumanMove(from, square)
  }

  async function playHumanMove(from: Square, to: Square) {
    const session = sessionRef.current
    const beforeFen = fen
    const beforeGame = new Chess(beforeFen)
    const beforeCoach = coach ?? await engineRef.current.analyze(beforeFen, { depth: 16, multiPv: 1 })
    if (sessionRef.current !== session) return

    let move
    try {
      move = beforeGame.move({ from, to, promotion: 'q' })
    } catch {
      return
    }
    if (!move) return

    const playerUci = moveToUci(from, to, move.promotion)
    const afterHumanFen = beforeGame.fen()
    setFen(afterHumanFen)
    setCoach(null)
    setThinking(true)

    try {
      const afterHumanAnalysis = beforeGame.isGameOver()
        ? null
        : await engineRef.current.analyze(afterHumanFen, { depth: 14, multiPv: 1 })
      if (sessionRef.current !== session) return

      const bestBefore = scoreToCentipawns(beforeCoach.lines[0]?.score)
      const playedAfter = afterHumanAnalysis
        ? scoreFromPerspective(afterHumanAnalysis.lines[0]?.score, 'b', 'w')
        : bestBefore
      const cpl = Math.max(0, Math.min(5_000, bestBefore - playedAfter))
      const grade = beforeCoach.bestMove === playerUci ? 'Melhor' : gradeMove(cpl)

      setRecords((current) => [
        ...current,
        {
          ply: current.length + 1,
          side: 'Você',
          san: move.san,
          uci: playerUci,
          grade,
          centipawnLoss: cpl,
          evalAfter: playedAfter,
        },
      ])

      if (beforeGame.isGameOver()) {
        setShowReport(true)
        return
      }

      const opponent = await engineRef.current.analyze(afterHumanFen, {
        depth: currentDifficulty.depth,
        multiPv: 1,
      })
      if (sessionRef.current !== session || !opponent.bestMove) return

      const replyGame = new Chess(afterHumanFen)
      const reply = replyGame.move({
        from: opponent.bestMove.slice(0, 2),
        to: opponent.bestMove.slice(2, 4),
        promotion: opponent.bestMove[4] || 'q',
      })
      if (!reply) return

      const finalFen = replyGame.fen()
      setFen(finalFen)
      setRecords((current) => [
        ...current,
        {
          ply: current.length + 1,
          side: 'Stockfish',
          san: reply.san,
          uci: opponent.bestMove as string,
        },
      ])

      if (replyGame.isGameOver()) {
        setShowReport(true)
      } else {
        await refreshCoach(finalFen, session)
      }
    } catch (error) {
      if (sessionRef.current === session) {
        setEngineError(error instanceof Error ? error.message : 'Erro durante o cálculo da jogada.')
      }
    } finally {
      if (sessionRef.current === session) setThinking(false)
    }
  }

  function newGame() {
    sessionRef.current += 1
    const session = sessionRef.current
    engineRef.current.stop()
    const initialFen = new Chess().fen()
    setFen(initialFen)
    setSelected(null)
    setRecords([])
    setShowReport(false)
    setThinking(false)
    setCoach(null)
    void refreshCoach(initialFen, session)
  }

  function gameStatus() {
    if (chess.isCheckmate()) return chess.turn() === 'w' ? 'Xeque-mate — Stockfish venceu' : 'Xeque-mate — você venceu'
    if (chess.isDraw()) return 'Partida empatada'
    if (chess.inCheck()) return chess.turn() === 'w' ? 'Você está em xeque' : 'Stockfish está em xeque'
    if (thinking) return 'Stockfish está calculando…'
    return chess.turn() === 'w' ? 'Sua vez' : 'Vez do Stockfish'
  }

  const boardRows = chess.board()
  const arrow = bestMove && coachVisible ? { from: squareCenter(bestMove.slice(0, 2)), to: squareCenter(bestMove.slice(2, 4)) } : null

  const summary = {
    best: records.filter((r) => r.side === 'Você' && r.grade === 'Melhor').length,
    excellent: records.filter((r) => r.side === 'Você' && r.grade === 'Excelente').length,
    inaccuracies: records.filter((r) => r.side === 'Você' && r.grade === 'Imprecisão').length,
    mistakes: records.filter((r) => r.side === 'Você' && r.grade === 'Erro').length,
    blunders: records.filter((r) => r.side === 'Você' && r.grade === 'Grave').length,
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">LOCAL · SEM API PAGA</span>
          <h1>Chess Mentor</h1>
        </div>
        <div className="engine-pill">
          <span className={`status-dot ${engineReady ? 'ready' : ''}`} />
          {engineError ? 'Engine indisponível' : engineReady ? 'Stockfish 18 pronto' : 'Carregando Stockfish 18'}
        </div>
      </header>

      {engineError && <div className="error-banner">{engineError}</div>}

      <section className="workspace">
        <div className="game-column">
          <div className="game-meta">
            <div>
              <span className="meta-label">Status</span>
              <strong>{gameStatus()}</strong>
            </div>
            <div>
              <span className="meta-label">Precisão estimada</span>
              <strong>{accuracy}%</strong>
            </div>
            <button className="ghost-button" onClick={newGame}>Nova partida</button>
          </div>

          <div className="board-wrap">
            <div className="board" aria-label="Tabuleiro de xadrez">
              {boardRows.flatMap((row) => row.map((piece, colIndex) => {
                const rowIndex = boardRows.indexOf(row)
                const square = `${String.fromCharCode(97 + colIndex)}${8 - rowIndex}` as Square
                const isLight = (rowIndex + colIndex) % 2 === 0
                const isSelected = selected === square
                const isLegal = legalTargets.has(square)
                const isBestFrom = bestMove?.slice(0, 2) === square && coachVisible
                const isBestTo = bestMove?.slice(2, 4) === square && coachVisible
                return (
                  <button
                    key={square}
                    className={`square ${isLight ? 'light' : 'dark'} ${isSelected ? 'selected' : ''} ${isLegal ? 'legal' : ''} ${isBestFrom || isBestTo ? 'best-square' : ''}`}
                    onClick={() => void handleSquareClick(square)}
                    aria-label={square}
                  >
                    {piece && <span className={`piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`}>{PIECES[`${piece.color}${piece.type}`]}</span>}
                    {isLegal && <span className="legal-dot" />}
                    {colIndex === 0 && <span className="rank-label">{8 - rowIndex}</span>}
                    {rowIndex === 7 && <span className="file-label">{String.fromCharCode(97 + colIndex)}</span>}
                  </button>
                )
              }))}
              {arrow && (
                <svg className="coach-arrow" viewBox="0 0 8 8" preserveAspectRatio="none">
                  <defs>
                    <marker id="arrow-head" markerWidth="0.7" markerHeight="0.7" refX="0.5" refY="0.35" orient="auto" markerUnits="userSpaceOnUse">
                      <path d="M0,0 L0.7,0.35 L0,0.7 z" />
                    </marker>
                  </defs>
                  <line x1={arrow.from.x} y1={arrow.from.y} x2={arrow.to.x} y2={arrow.to.y} markerEnd="url(#arrow-head)" />
                </svg>
              )}
            </div>
          </div>

          <div className="controls-row">
            <label>
              Força do adversário
              <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)} disabled={thinking}>
                {DIFFICULTIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <button className="secondary-button" onClick={() => setShowReport(true)} disabled={!records.length}>Analisar partida</button>
          </div>
          <p className="difficulty-note">{currentDifficulty.description}</p>
        </div>

        <aside className="coach-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">TREINADOR</span>
              <h2>Melhor jogada</h2>
            </div>
            <button className={`toggle ${coachVisible ? 'on' : ''}`} onClick={() => setCoachVisible((value) => !value)} aria-label="Mostrar ou ocultar dica">
              <span />
            </button>
          </div>

          {coachLoading ? (
            <div className="coach-loading">
              <div className="spinner" />
              <p>Analisando a posição…</p>
            </div>
          ) : coach ? (
            <>
              <div className="best-move-card">
                <div>
                  <span className="meta-label">Recomendação</span>
                  <strong>{coachVisible ? bestMoveSan : 'Dica oculta'}</strong>
                </div>
                <div className="score-badge">{coachVisible ? formatScore(coach.lines[0]?.score) : '•••'}</div>
              </div>

              {coachVisible && (
                <>
                  <div className="reason-list">
                    {coachReasons.map((reason) => <p key={reason}>{reason}</p>)}
                  </div>
                  <div className="pv-block">
                    <span className="meta-label">Linha principal</span>
                    <code>{coach.lines[0]?.pv.slice(0, 8).join(' ') || '—'}</code>
                  </div>
                  <div className="alternatives">
                    <span className="meta-label">Alternativas</span>
                    {coach.lines.slice(1).map((line) => (
                      <div className="alternative-row" key={line.multipv}>
                        <strong>{uciToSan(fen, line.pv[0])}</strong>
                        <span>{formatScore(line.score)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <p className="empty-state">Sem análise disponível para esta posição.</p>
          )}

          <div className="moves-panel">
            <span className="meta-label">Histórico</span>
            <div className="moves-list">
              {!records.length && <p className="empty-state">Faça o primeiro lance para iniciar o histórico.</p>}
              {records.slice(-10).map((record) => (
                <div className="move-row" key={`${record.ply}-${record.uci}`}>
                  <span>{record.ply}.</span>
                  <strong>{record.san}</strong>
                  <span>{record.side}</span>
                  {record.grade && <em className={`grade grade-${record.grade.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`}>{record.grade}</em>}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>

      {showReport && (
        <div className="modal-backdrop" onMouseDown={() => setShowReport(false)}>
          <section className="report-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <div>
                <span className="eyebrow">PÓS-PARTIDA</span>
                <h2>Relatório da partida</h2>
              </div>
              <button className="icon-button" onClick={() => setShowReport(false)}>×</button>
            </div>

            <div className="accuracy-card">
              <span>Precisão estimada</span>
              <strong>{accuracy}%</strong>
              <small>Métrica local baseada na perda média em centipawns por jogada.</small>
            </div>

            <div className="report-grid">
              <div><strong>{summary.best}</strong><span>Melhores</span></div>
              <div><strong>{summary.excellent}</strong><span>Excelentes</span></div>
              <div><strong>{summary.inaccuracies}</strong><span>Imprecisões</span></div>
              <div><strong>{summary.mistakes}</strong><span>Erros</span></div>
              <div><strong>{summary.blunders}</strong><span>Graves</span></div>
            </div>

            <div className="review-list">
              {records.filter((record) => record.side === 'Você').map((record, index) => (
                <div className="review-row" key={`review-${record.ply}`}>
                  <span className="review-index">{index + 1}</span>
                  <div>
                    <strong>{record.san}</strong>
                    <span>{record.grade} · perda {Math.round(record.centipawnLoss ?? 0)} cp</span>
                  </div>
                  <div className="mini-eval">{typeof record.evalAfter === 'number' ? `${record.evalAfter >= 0 ? '+' : ''}${(record.evalAfter / 100).toFixed(2)}` : '—'}</div>
                </div>
              ))}
            </div>

            <div className="report-actions">
              <button className="secondary-button" onClick={() => setShowReport(false)}>Voltar ao tabuleiro</button>
              <button className="primary-button" onClick={newGame}>Nova partida</button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
