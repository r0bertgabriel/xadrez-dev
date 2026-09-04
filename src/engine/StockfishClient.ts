export type EngineScore = {
  type: 'cp' | 'mate'
  value: number
}

export type EngineLine = {
  multipv: number
  depth: number
  score: EngineScore
  pv: string[]
}

export type AnalysisResult = {
  bestMove: string | null
  ponder: string | null
  lines: EngineLine[]
}

type AnalysisOptions = {
  depth?: number
  multiPv?: number
}

type PendingAnalysis = {
  resolve: (value: AnalysisResult) => void
  reject: (reason?: unknown) => void
  lines: Map<number, EngineLine>
}

export class StockfishClient {
  private worker: Worker | null = null
  private readyPromise: Promise<void> | null = null
  private readyResolve: (() => void) | null = null
  private pending: PendingAnalysis | null = null
  private queue: Promise<unknown> = Promise.resolve()

  init(): Promise<void> {
    if (this.readyPromise) return this.readyPromise

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve

      try {
        this.worker = new Worker('/engine/stockfish-18-lite-single.js')
      } catch (error) {
        reject(error)
        return
      }

      this.worker.onmessage = (event: MessageEvent<string>) => {
        const text = String(event.data ?? '')
        for (const line of text.split(/\r?\n/)) this.handleLine(line.trim())
      }

      this.worker.onerror = (event) => {
        this.pending?.reject(new Error(event.message || 'Falha ao executar Stockfish.'))
        this.pending = null
        reject(new Error(event.message || 'Falha ao carregar Stockfish.'))
      }

      this.send('uci')
      this.send('setoption name UCI_ShowWDL value true')
      this.send('isready')
    })

    return this.readyPromise
  }

  analyze(fen: string, options: AnalysisOptions = {}): Promise<AnalysisResult> {
    const task = async () => {
      await this.init()
      return this.runAnalysis(fen, options)
    }

    const next = this.queue.then(task, task)
    this.queue = next.catch(() => undefined)
    return next
  }

  stop() {
    this.send('stop')
  }

  destroy() {
    this.worker?.terminate()
    this.worker = null
    this.readyPromise = null
    this.pending = null
  }

  private runAnalysis(fen: string, options: AnalysisOptions): Promise<AnalysisResult> {
    if (!this.worker) return Promise.reject(new Error('Stockfish ainda não foi inicializado.'))

    const depth = options.depth ?? 15
    const multiPv = Math.max(1, Math.min(5, options.multiPv ?? 1))

    this.send(`setoption name MultiPV value ${multiPv}`)
    this.send(`position fen ${fen}`)

    return new Promise<AnalysisResult>((resolve, reject) => {
      this.pending = { resolve, reject, lines: new Map() }
      this.send(`go depth ${depth}`)
    })
  }

  private handleLine(line: string) {
    if (!line) return

    if (line === 'readyok') {
      this.readyResolve?.()
      this.readyResolve = null
      return
    }

    if (line.startsWith('info ') && this.pending) {
      const parsed = this.parseInfo(line)
      if (parsed) this.pending.lines.set(parsed.multipv, parsed)
      return
    }

    if (line.startsWith('bestmove ') && this.pending) {
      const match = line.match(/^bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/)
      const bestMove = match?.[1] && match[1] !== '(none)' ? match[1] : null
      const ponder = match?.[2] ?? null
      const current = this.pending
      this.pending = null
      current.resolve({
        bestMove,
        ponder,
        lines: [...current.lines.values()].sort((a, b) => a.multipv - b.multipv),
      })
    }
  }

  private parseInfo(line: string): EngineLine | null {
    const depth = Number(line.match(/\bdepth\s+(\d+)/)?.[1] ?? 0)
    const multipv = Number(line.match(/\bmultipv\s+(\d+)/)?.[1] ?? 1)
    const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/)
    const pvMatch = line.match(/\bpv\s+(.+)$/)

    if (!scoreMatch || !pvMatch) return null

    return {
      multipv,
      depth,
      score: { type: scoreMatch[1] as 'cp' | 'mate', value: Number(scoreMatch[2]) },
      pv: pvMatch[1].trim().split(/\s+/),
    }
  }

  private send(command: string) {
    this.worker?.postMessage(command)
  }
}
