import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const source = resolve(process.env.DSH_SOURCE ?? resolve(import.meta.dirname, '../../dsh-upgrades/upgrade-0.2.2-alpha.2'))
const { clientBundle } = await import(pathToFileURL(resolve(source, 'packages/client/tsdown.client.ts')).href)

const preset = clientBundle(import.meta.dirname, ['src/index.ts'])
export default (input: Parameters<typeof preset>[0]) => preset(input).map(config =>
  config.name?.endsWith('/client') ? { ...config, target: 'es2022' } : config)
