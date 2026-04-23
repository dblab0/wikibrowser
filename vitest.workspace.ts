import { defineWorkspace } from 'vitest/config'
export default defineWorkspace([
  'server/vitest.config.ts',
  'client/vitest.config.ts',
  'shared/vitest.config.ts',
])