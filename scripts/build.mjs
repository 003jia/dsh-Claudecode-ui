/** Reuse the matching DSH toolchain without installing or changing its dependencies. */
import { createRequire } from 'node:module'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const source = resolve(process.env.DSH_SOURCE ?? join(root, '../../dsh-upgrades/upgrade-0.2.2-alpha.2'))
const sourceRequire = createRequire(join(source, 'package.json'))
const modules = join(root, 'node_modules')
mkdirSync(join(modules, '@deepseek-ai'), { recursive: true })
const paths = {}
function connect(name, target) {
  const link = join(modules, name)
  mkdirSync(resolve(link, '..'), { recursive: true })
  let entry
  try { entry = lstatSync(link) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (entry?.isSymbolicLink() && resolve(resolve(link, '..'), readlinkSync(link)) !== target) {
    unlinkSync(link)
    entry = undefined
  }
  if (entry === undefined) symlinkSync(target, link, 'dir')
}
for (const group of readdirSync(join(source, 'packages'), { withFileTypes: true }).filter(row => row.isDirectory())) {
  for (const row of readdirSync(join(source, 'packages', group.name), { withFileTypes: true }).filter(row => row.isDirectory())) {
    const dir = join(source, 'packages', group.name, row.name)
    const file = join(dir, 'package.json')
    if (!existsSync(file)) continue
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    connect(pkg.name, dir)
  }
}
for (const row of readdirSync(join(source, 'vendor'), { withFileTypes: true }).filter(row => row.isDirectory())) {
  const dir = join(source, 'vendor', row.name)
  const file = join(dir, 'package.json')
  if (existsSync(file)) connect(JSON.parse(readFileSync(file, 'utf8')).name, dir)
}
const uiRequire = createRequire(join(source, 'packages/client/ui-conversation/package.json'))
for (const name of ['react', 'react-dom']) connect(name, resolve(uiRequire.resolve(name + '/package.json'), '..'))
connect('@types', join(source, 'node_modules/@types'))
const config = {
  compilerOptions: {
    target: 'ES2024', module: 'NodeNext', moduleResolution: 'NodeNext',
    lib: ['ES2024', 'DOM', 'DOM.Iterable', 'ESNext.Disposable'],
    strict: true, skipLibCheck: true, esModuleInterop: true, jsx: 'react-jsx',
    allowImportingTsExtensions: true, declaration: true, emitDeclarationOnly: true,
    rootDir: './src', outDir: './lib/types', types: ['node', 'react'], paths,
  }, include: ['src'],
}
writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(config, null, 2) + '\n')
const types = spawnSync(process.execPath, [sourceRequire.resolve('typescript/bin/tsc'), '-p', join(root, 'tsconfig.json')], { cwd: root, stdio: 'inherit' })
if (types.status !== 0) process.exit(types.status ?? 1)
if (!process.argv.includes('--types-only')) {
  const bundle = spawnSync(join(source, 'node_modules/.bin/tsdown'), ['--config', join(root, 'tsdown.config.ts')], { cwd: root, stdio: 'inherit' })
  if (bundle.status !== 0) process.exit(bundle.status ?? 1)

  // Rolldown labels virtual CSS modules with absolute paths. Make those
  // labels portable while preserving source-map line positions.
  const clientPath = join(root, 'lib/client.js')
  const client = readFileSync(clientPath, 'utf8')
  const portable = client.replace(
    /^([ \t]*\/\/#region \\0dsh-(?:inline-|global-)?css:)([^\r\n]+)$/gm,
    (_label, prefix, file) => prefix + relative(root, file).replaceAll('\\', '/'),
  )
  if (portable !== client) writeFileSync(clientPath, portable)
}
console.log('Built dsh-claude-ui against', relative(root, source))
