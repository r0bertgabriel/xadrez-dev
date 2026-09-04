# Chess Mentor

Interface web para jogar xadrez com assistência local do **Stockfish 18**, sem LLM, sem API externa e sem custo por uso.

## O que já está implementado

- Tabuleiro responsivo em React.
- Validação completa das regras com `chess.js`.
- Stockfish 18 executado localmente em WebAssembly/Web Worker.
- Dica visual da melhor jogada com seta no tabuleiro.
- Avaliação da posição em centipawns ou mate.
- Três linhas de análise (MultiPV) para comparar alternativas.
- Explicações determinísticas sobre a recomendação, sem IA generativa.
- Adversário controlado pelo Stockfish em quatro níveis de profundidade.
- Classificação dos lances do jogador: Melhor, Excelente, Boa, Imprecisão, Erro e Grave.
- Cálculo de perda em centipawns por jogada.
- Relatório pós-partida com precisão estimada e revisão dos lances.
- Botão para ocultar as dicas e jogar sem assistência.
- Nenhum backend obrigatório e nenhum serviço pago.

## Stack

- React 19
- TypeScript 7
- Vite 8
- chess.js 1.4
- Stockfish 18 / WebAssembly

## Executar

```bash
npm install
npm run dev
```

O `postinstall` copia automaticamente a versão `lite-single` do Stockfish para `public/engine`. Ela roda em um Web Worker e evita depender de um servidor de análise.

Para gerar a versão de produção:

```bash
npm run build
npm run preview
```

## Arquitetura

```text
src/
├── chess/
│   └── analysis.ts          # avaliação, classificação e explicações determinísticas
├── engine/
│   └── StockfishClient.ts   # cliente UCI e fila de análises
├── App.tsx                  # jogo, treinador e relatório
├── main.tsx
└── styles.css

scripts/
└── copy-stockfish.mjs       # instala os assets WASM localmente
```

## Como a análise funciona

1. Antes da jogada, o Stockfish calcula a melhor continuação.
2. Depois da jogada do usuário, a posição é novamente analisada.
3. A diferença entre a melhor avaliação possível e a avaliação obtida gera a perda em centipawns.
4. Essa perda classifica a jogada e alimenta o relatório final.
5. O texto do treinador é produzido por regras enxadrísticas simples (captura, xeque, roque, promoção, centro e atividade), sem LLM.

A métrica de precisão exibida pelo projeto é uma estimativa própria e transparente baseada na perda em centipawns; ela não tenta reproduzir a fórmula proprietária de outros sites.

## Privacidade e custo

A partida e a análise ficam no navegador. Não há necessidade de enviar posições para APIs externas. O custo variável por análise é zero; o único recurso consumido é CPU/RAM da própria máquina.

## Licença

GPL-3.0-or-later, compatível com os componentes GPL utilizados pelo projeto.
