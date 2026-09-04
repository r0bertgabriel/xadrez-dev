export type EngineLine = {
  multipv: number
  depth: number
  scoreCp: number | null
  mate: number | null
  pv: string[]
}

export type EngineAnalysis = {
  bestMove: string
  ponder?: string
  lines: EngineLine[]
}

type Pending = {
  resolve: (value: EngineAnalysis) => void
  reject: (reason?: unknown) => void
  lines: Map<number, EngineLine>
  fen: string
}

export class StockfishEngine {
  private worker: Worker
  private ready: Promise<void>
  private pending: Pending | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor() {
    this.worker = new Worker('/stockfish/stockfish-18-lite-single.js')
    this.worker.onmessage = (event) => this.handleMessage(String(event.data))
    this.ready = new Promise((resolve) => {
      const listener = (event: MessageEvent) => {
        if (String(event.data) === 'uciok') {
          this.worker.removeEventListener('message', listener)
          this.worker.postMessage('isready')
        }
        if (String(event.data) === 'readyok') {
          this.worker.removeEventListener('message', listener)
          resolve()
        }
      }
      this.worker.addEventListener('message', listener)
      this.worker.postMessage('uci')
    })
  }

  analyze(fen: string, depth = 15, multiPv = 3): Promise<EngineAnalysis> {
    return this.enqueue(async () => {
      await this.ready
      this.worker.postMessage('stop')
      this.worker.postMessage(`setoption name MultiPV value ${Math.max(1, Math.min(5, multiPv))}`)
      this.worker.postMessage(`position fen ${fen}`)
      return new Promise<EngineAnalysis>((resolve, reject) => {
        this.pending = { resolve, reject, lines: new Map(), fen }
        this.worker.postMessage(`go depth ${depth}`)
      })
    })
  }

  bestMove(fen: string, elo = 1400, moveTimeMs = 450): Promise<string> {
    return this.enqueue(async () => {
      await this.ready
      this.worker.postMessage('stop')
      this.worker.postMessage('setoption name MultiPV value 1')
      this.worker.postMessage('setoption name UCI_LimitStrength value true')
      this.worker.postMessage(`setoption name UCI_Elo value ${Math.max(1320, Math.min(3190, elo))}`)
      this.worker.postMessage(`position fen ${fen}`)
      const result = await new Promise<EngineAnalysis>((resolve, reject) => {
        this.pending = { resolve, reject, lines: new Map(), fen }
        this.worker.postMessage(`go movetime ${moveTimeMs}`)
      })
      this.worker.postMessage('setoption name UCI_LimitStrength value false')
      return result.bestMove
    })
  }

  destroy() {
    this.worker.terminate()
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job)
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }

  private handleMessage(message: string) {
    if (!this.pending) return

    if (message.startsWith('info ') && message.includes(' pv ')) {
      const multipv = Number(message.match(/\bmultipv (\d+)/)?.[1] ?? '1')
      const depth = Number(message.match(/\bdepth (\d+)/)?.[1] ?? '0')
      const cpMatch = message.match(/\bscore cp (-?\d+)/)
      const mateMatch = message.match(/\bscore mate (-?\d+)/)
      const pvRaw = message.split(' pv ')[1] ?? ''
      const sideToMove = this.pending.fen.split(' ')[1]
      const perspective = sideToMove === 'w' ? 1 : -1
      this.pending.lines.set(multipv, {
        multipv,
        depth,
        scoreCp: cpMatch ? Number(cpMatch[1]) * perspective : null,
        mate: mateMatch ? Number(mateMatch[1]) * perspective : null,
        pv: pvRaw.trim().split(/\s+/).filter(Boolean),
      })
      return
    }

    if (message.startsWith('bestmove ')) {
      const [, bestMove, , ponder] = message.split(/\s+/)
      const pending = this.pending
      this.pending = null
      pending.resolve({
        bestMove,
        ponder,
        lines: [...pending.lines.values()].sort((a, b) => a.multipv - b.multipv),
      })
    }
  }
}
