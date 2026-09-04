import { Chess, type Color } from 'chess.js'
import type { AnalysisResult, EngineScore } from '../engine/StockfishClient'

export type MoveGrade = 'Melhor' | 'Excelente' | 'Boa' | 'Imprecisão' | 'Erro' | 'Grave'

export function scoreToCentipawns(score?: EngineScore): number {
  if (!score) return 0
  if (score.type === 'cp') return score.value
  const sign = Math.sign(score.value) || 1
  return sign * (100_000 - Math.min(Math.abs(score.value), 99) * 1_000)
}

export function formatScore(score?: EngineScore): string {
  if (!score) return '—'
  if (score.type === 'mate') return score.value > 0 ? `M${score.value}` : `-M${Math.abs(score.value)}`
  const pawns = score.value / 100
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`
}

export function gradeMove(centipawnLoss: number): MoveGrade {
  if (centipawnLoss <= 20) return 'Melhor'
  if (centipawnLoss <= 50) return 'Excelente'
  if (centipawnLoss <= 100) return 'Boa'
  if (centipawnLoss <= 160) return 'Imprecisão'
  if (centipawnLoss <= 300) return 'Erro'
  return 'Grave'
}

export function calculateAccuracy(losses: number[]): number {
  if (!losses.length) return 100
  const moveAccuracies = losses.map((loss) => 100 * Math.exp(-Math.max(0, loss) / 220))
  return Math.round(moveAccuracies.reduce((sum, value) => sum + value, 0) / moveAccuracies.length)
}

export function uciToSan(fen: string, uci?: string | null): string {
  if (!uci || uci.length < 4) return '—'
  try {
    const chess = new Chess(fen)
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || 'q',
    })
    return move?.san ?? uci
  } catch {
    return uci
  }
}

export function coachingReasons(fen: string, result: AnalysisResult): string[] {
  const best = result.bestMove
  if (!best) return ['A posição não possui um lance legal disponível.']

  const reasons: string[] = []
  try {
    const chess = new Chess(fen)
    const move = chess.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] || 'q' })
    if (!move) return ['O Stockfish considera este o lance mais preciso na posição atual.']

    if (move.captured) reasons.push(`Ganha ou troca material com ${move.san}.`)
    if (move.san.includes('+')) reasons.push('Cria uma ameaça imediata ao rei adversário.')
    if (move.san.includes('#')) reasons.push('Finaliza a partida com xeque-mate.')
    if (move.san.startsWith('O-O')) reasons.push('Melhora a segurança do rei por meio do roque.')
    if (move.promotion) reasons.push('Converte um peão avançado em uma peça de maior valor.')
    if (['d4', 'e4', 'd5', 'e5'].includes(move.to)) reasons.push('Aumenta o controle sobre o centro do tabuleiro.')
    if (['c3', 'c4', 'f3', 'f4', 'c5', 'f5', 'c6', 'f6'].includes(move.to)) reasons.push('Melhora a atividade da peça e disputa casas importantes.')
  } catch {
    // A análise da engine continua válida mesmo se a descrição heurística falhar.
  }

  if (!reasons.length) reasons.push('Mantém a melhor avaliação objetiva encontrada pela engine.')
  if (result.lines[0]?.pv.length) reasons.push('A recomendação considera a continuação principal calculada pelo Stockfish, não apenas o próximo lance.')
  return reasons.slice(0, 3)
}

export function scoreFromPerspective(score: EngineScore | undefined, sideToMove: Color, perspective: Color): number {
  const raw = scoreToCentipawns(score)
  return sideToMove === perspective ? raw : -raw
}
