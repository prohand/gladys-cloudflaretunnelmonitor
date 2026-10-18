// -----------------------------------------------------------------------------
// What the monitor remembers across restarts, in /data/state.json.
//
// A tunnel that goes down while Gladys restarts (an update, a power cut) must
// still fire its scene trigger: comparing with the last status seen BEFORE the
// restart is what catches it. The file also keeps the tunnels already known,
// so their devices stay published while the API is unreachable, and which
// tunnel each local connector belongs to.
//
// /data is the only writable path of the container (read-only rootfs). A file
// that cannot be read or written is logged and otherwise ignored: monitoring
// goes on, it only forgets across restarts.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

const FILE_NAME = 'state.json';

/** An empty memory: what a first start, or an unreadable file, begins with. */
export function emptyState() {
  return {
    // tunnel id -> { name, status }
    tunnels: {},
    // connector device id -> { status, tunnelId }
    connectors: {},
    // true / false once the API answered or failed; null before the first try
    apiOk: null,
  };
}

/**
 * @param {string} [dir] the data directory, `DATA_DIR` or /data by default
 */
export function createStore(dir = process.env.DATA_DIR || '/data') {
  const file = join(dir, FILE_NAME);
  return {
    async load() {
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        return {
          ...emptyState(),
          ...parsed,
          tunnels: { ...(parsed?.tunnels ?? {}) },
          connectors: { ...(parsed?.connectors ?? {}) },
        };
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Could not read ${file}, starting from an empty memory: ${err.message}`);
        }
        return emptyState();
      }
    },

    async save(state) {
      try {
        await mkdir(dir, { recursive: true });
        // Written aside then renamed: a crash mid-write never leaves half a
        // file for the next start to choke on.
        const temporary = `${file}.tmp`;
        await writeFile(temporary, JSON.stringify(state, null, 2));
        await rename(temporary, file);
      } catch (err) {
        logger.warn(`Could not write ${file}: ${err.message}`);
      }
    },
  };
}
