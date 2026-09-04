export type EngineScore = {
  type: 'cp' | 'mate';
  value: number;
};

export type EngineAnalysis = {
  bestMove: string;
  ponder?: string;
  depth: number;
  score: EngineScore;
  pv: string[];
};

type Waiter = {
  test: (line: string) => boolean;
  resolve: (line: string) => void;
};

const ENGINE_URL = '/engine/stockfish-18-lite-single.js';

export class StockfishEngine {
  private worker: Worker;
  private waiters: Waiter[] = [];
  private lastInfo = '';
  private queue: Promise<unknown> = Promise.resolve();
  private initialized: Promise<void>;

  constructor() {
    this.worker = new Worker(ENGINE_URL);
    this.worker.onmessage = (event: MessageEvent<string>) => {
      const line = String(event.data ?? '');
      if (line.startsWith('info ') && line.includes(' score ')) this.lastInfo = line;

      const waiterIndex = this.waiters.findIndex((waiter) => waiter.test(line));
      if (waiterIndex >= 0) {
        const [waiter] = this.waiters.splice(waiterIndex, 1);
        waiter.resolve(line);
      }
    };

    this.initialized = this.initialize();
  }

  private send(command: string) {
    this.worker.postMessage(command);
  }

  private waitFor(test: (line: string) => boolean) {
    return new Promise<string>((resolve) => this.waiters.push({ test, resolve }));
  }

  private async initialize() {
    this.send('uci');
    await this.waitFor((line) => line === 'uciok');
    this.send('setoption name Hash value 32');
    this.send('isready');
    await this.waitFor((line) => line === 'readyok');
  }

  analyze(fen: string, depth = 14): Promise<EngineAnalysis> {
    const task = async () => {
      await this.initialized;
      this.lastInfo = '';
      this.send('position fen ' + fen);
      this.send('go depth ' + depth);
      const bestLine = await this.waitFor((line) => line.startsWith('bestmove '));
      return this.parseAnalysis(bestLine, this.lastInfo);
    };

    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private parseAnalysis(bestLine: string, infoLine: string): EngineAnalysis {
    const bestParts = bestLine.trim().split(/\s+/);
    const bestMove = bestParts[1] ?? '';
    const ponderIndex = bestParts.indexOf('ponder');
    const ponder = ponderIndex >= 0 ? bestParts[ponderIndex + 1] : undefined;

    const depth = Number(infoLine.match(/\bdepth (\d+)/)?.[1] ?? 0);
    const scoreMatch = infoLine.match(/\bscore (cp|mate) (-?\d+)/);
    const pvMatch = infoLine.match(/\bpv (.+)$/);

    return {
      bestMove,
      ponder,
      depth,
      score: {
        type: (scoreMatch?.[1] as 'cp' | 'mate') ?? 'cp',
        value: Number(scoreMatch?.[2] ?? 0),
      },
      pv: pvMatch?.[1]?.trim().split(/\s+/) ?? [],
    };
  }

  terminate() {
    this.worker.terminate();
    this.waiters = [];
  }
}

export function scoreToWhite(score: EngineScore, fen: string): number {
  const sideToMove = fen.split(' ')[1];
  const raw = score.type === 'mate'
    ? Math.sign(score.value || 1) * (100_000 - Math.min(Math.abs(score.value), 99) * 100)
    : score.value;
  return sideToMove === 'w' ? raw : -raw;
}

export function displayEvaluation(score: EngineScore, fen: string): string {
  const normalized = scoreToWhite(score, fen);
  if (score.type === 'mate') {
    const moves = Math.abs(score.value);
    return normalized > 0 ? `M${moves} para as brancas` : `M${moves} para as pretas`;
  }
  const pawns = normalized / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}
