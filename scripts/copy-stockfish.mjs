import { copyFile, mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const sourceDir = resolve('node_modules/stockfish/bin')
const targetDir = resolve('public/engine')
const files = ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm']

await mkdir(targetDir, { recursive: true })

for (const file of files) {
  const source = resolve(sourceDir, file)
  await stat(source)
  await copyFile(source, resolve(targetDir, file))
}

console.log('Stockfish 18 lite single-threaded copied to public/engine')
