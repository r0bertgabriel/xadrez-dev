# Xadrez Coach

Interface web para jogar xadrez com assistência em tempo real de um motor local. O projeto não usa LLM, API paga ou serviço com cobrança por uso: a análise é feita pelo Stockfish 18 em WebAssembly no navegador do usuário.

## O que já está implementado

- Partida contra Stockfish com força ajustável por Elo.
- Coach em tempo real com indicação visual da melhor jogada.
- Top 3 variantes calculadas pelo motor.
- Barra de avaliação da posição.
- Explicações heurísticas simples sobre a ideia do melhor lance, sem IA generativa.
- Destaque de casas legais e melhor jogada no tabuleiro.
- Histórico da partida.
- Desfazer uma rodada e reiniciar a partida.
- Revisão pós-partida lance a lance.
- Classificação de lances: melhor, excelente, bom, imprecisão, erro e erro grave.
- Perda aproximada em centipawns e precisão estimada.
- Interface responsiva para desktop e mobile.

## Stack

- React 19 + TypeScript
- Vite
- `chess.js` para regras, validação e PGN
- Stockfish 18 via pacote `stockfish` e WebAssembly

## Como executar

```bash
npm install
npm run dev
```

Durante o `npm install`, o script `scripts/copy-stockfish.mjs` copia automaticamente o build `stockfish-18-lite-single.js/.wasm` do pacote instalado para `public/stockfish/`. Esses arquivos são ignorados pelo Git porque são artefatos derivados da dependência.

Para gerar a versão de produção:

```bash
npm run build
npm run preview
```

## Arquitetura

Toda a análise do tabuleiro roda localmente no navegador em um Web Worker. O frontend envia posições FEN ao Stockfish usando o protocolo UCI e recebe avaliação, variantes e melhor lance. Isso mantém a interface responsiva e evita custo por requisição.

O adversário pode ter a força limitada usando `UCI_LimitStrength`/`UCI_Elo`, enquanto o coach continua usando uma análise mais forte. Assim, o usuário pode treinar contra níveis realistas sem perder a qualidade das dicas.

## Observação sobre licença

O pacote `stockfish`/Stockfish.js é distribuído sob GPL-3.0. Consulte a licença e os requisitos do projeto original ao distribuir binários derivados do motor.
