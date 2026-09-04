# Xadrez Coach

Interface web para jogar xadrez contra o Stockfish 18 com assistência em tempo real e análise pós-partida, sem LLM e sem APIs pagas.

## O que já está implementado

- jogo de brancas contra Stockfish 18;
- validação completa das regras com `chess.js`;
- Stockfish executado localmente no navegador via WebAssembly/Web Worker;
- melhor jogada destacada em tempo real;
- avaliação da posição em centipawns ou mate;
- histórico em notação algébrica;
- análise pós-partida lance a lance;
- classificação de decisões: Excelente, Boa, Imprecisão, Erro e Erro grave;
- perda de centipawns por jogada;
- estimativa de precisão da partida;
- explicações determinísticas baseadas na avaliação do motor, sem LLM;
- layout responsivo para desktop e mobile.

## Stack

- React 19
- TypeScript 5
- Vite 7
- chess.js 1.4
- Stockfish.js 18.0.8 (`lite-single`)

## Como executar

```bash
npm install
npm run dev
```

O `postinstall` copia automaticamente os arquivos `stockfish-18-lite-single.js` e `stockfish-18-lite-single.wasm` do pacote npm para `public/engine`.

Para build de produção:

```bash
npm run build
npm run preview
```

## Arquitetura da inteligência

Não há chamada para OpenAI, Anthropic, Gemini ou qualquer API de inferência. O motor Stockfish roda na máquina do próprio usuário. Assim, não existe custo por jogada ou por partida.

A interface usa profundidade 14 para as dicas em tempo real, 13 para o adversário e 12 para a análise pós-partida, equilibrando força e responsividade no navegador.

## Observação de licença

Stockfish/Stockfish.js é distribuído sob GPLv3. Os binários usados pelo projeto são provenientes do pacote npm `stockfish` e executados em Web Worker dedicado.
