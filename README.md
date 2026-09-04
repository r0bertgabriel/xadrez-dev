# Xadrez Coach

Interface web de análise assistida por Stockfish 18 executado localmente no navegador. O projeto não usa LLM, API paga ou serviço com cobrança por uso.

## Estratégia atual

O usuário escolhe primeiro o seu lado: brancas ou pretas.

Depois disso, ele controla manualmente as duas cores do tabuleiro. Não existe mais um adversário automático. O objetivo é permitir reproduzir qualquer sequência de lances enquanto o sistema mantém a análise orientada para o lado escolhido.

- Se for a vez do seu lado, o coach mostra a melhor jogada, destaca origem/destino e exibe até três variantes.
- Se for a vez do adversário, você movimenta manualmente a outra cor. A avaliação continua sendo exibida do ponto de vista do seu lado, mas a recomendação de jogada fica aguardando a sua próxima vez.
- A barra de avaliação é sempre normalizada para o lado escolhido: positivo significa vantagem para você.
- A revisão pós-partida considera apenas os lances do lado escolhido.

## Funcionalidades

- escolha inicial entre brancas e pretas;
- tabuleiro orientado automaticamente pelo lado escolhido;
- controle manual das duas cores;
- movimentação por clique e arrastar/soltar;
- validação completa de movimentos com `chess.js`;
- promoção com escolha entre dama, torre, bispo e cavalo;
- destaque de movimentos legais;
- destaque do último lance;
- indicação visual de xeque;
- indicação da melhor jogada sem seta sobreposta ao tabuleiro;
- Top 3 variantes quando é a vez do lado escolhido;
- avaliação sempre orientada ao lado escolhido;
- histórico da partida;
- desfazer um lance;
- revisão dos seus lances com perda em centipawns e precisão estimada;
- Stockfish 18 em Web Worker/WebAssembly;
- interface responsiva para desktop e mobile.

## Stack

- React 19 + TypeScript
- Vite
- `chess.js`
- Stockfish 18 via pacote `stockfish`

## Como executar

A forma recomendada no Linux é:

```bash
./star.sh
```

O script instala as dependências quando necessário, prepara os arquivos locais do Stockfish, inicia o Vite em segundo plano, registra o PID e grava o log em `.xadrez-dev.log`.

Por padrão:

```text
http://localhost:5173
```

Outra porta:

```bash
PORT=5174 ./star.sh
```

Parar tudo:

```bash
./stop.sh
```

Execução manual:

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

## Arquitetura

Toda a inteligência de xadrez roda localmente. O frontend envia posições FEN ao Stockfish via protocolo UCI e recebe avaliações, variantes e melhor lance.

O score retornado pelo motor é convertido para a perspectiva do lado escolhido. Por isso, a interface não muda o significado da avaliação quando você joga de pretas.

As recomendações de jogada são exibidas apenas quando o lado escolhido é quem deve mover. Durante o turno adversário, o usuário informa manualmente o lance da outra cor; em seguida o coach recalcula a melhor resposta para o seu lado.

## Diagnóstico

```bash
tail -f .xadrez-dev.log
```

O cliente do Stockfish possui timeout explícito de inicialização e análise para evitar espera indefinida caso o Web Worker falhe.

## Licença

O pacote `stockfish`/Stockfish.js é distribuído sob GPL-3.0. Consulte a licença e os requisitos do projeto original ao distribuir binários derivados do motor.
