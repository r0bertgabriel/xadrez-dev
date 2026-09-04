import { mkdir, copyFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'

const sourceDir = resolve('node_modules/stockfish/bin')
const targetDir = resolve('public/stockfish')
const files = ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm']

await mkdir(targetDir, { recursive: true })

for (const file of files) {
  const source = resolve(sourceDir, file)
  const target = resolve(targetDir, file)
  await access(source)
  await copyFile(source, target)
  console.log(`Stockfish asset copied: ${file}`)
}
