import { clientBundle } from '../../deepseek-harness/packages/client/tsdown.client.ts'

/**
 * Browser half only.
 *
 * The shared preset emits a node half beside the client bundle, but this
 * package's node half is built by `tsc` (`lib/index.js`, `lib/host/*`, and the
 * declarations `exports.types` points at). Keeping only the preset's client
 * config leaves one writer per artifact, and it keeps the client entry at the
 * fixed `src/client/index.ts` the source face uses — the harness's
 * `lib/types/client/index.js` layout does not exist outside its workspace.
 */
const configs = clientBundle('dsh-laya-go-decision', ['src/index.ts'])
const CLIENT_CONFIG_NAME = 'dsh-laya-go-decision/client'

export default (inline: Parameters<typeof configs>[0]) =>
  configs(inline).filter(config => config.name === CLIENT_CONFIG_NAME)
