/**
 * Imported first in main.tsx. Zod probes whether `new Function` works so it can compile
 * faster validators; under our CSP (no eval) the probe is blocked and reported as a
 * violation. Jitless mode skips the probe. It must run before any schema module loads,
 * because schemas built at import time trigger the probe.
 */
import { z } from 'zod'

z.config({ jitless: true })
