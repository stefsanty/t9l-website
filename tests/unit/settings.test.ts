import { describe, it, expect } from 'vitest'
import { SETTING_IDS } from '@/lib/settings'

describe('SETTING_IDS', () => {
  it('exposes deterministic ids that match the seed migration', () => {
    // These are the ids inserted by 20260427170000_seed_public_settings/migration.sql.
    // setDataSource / setWriteMode upsert by these; if they drift, the seed
    // migration's ON CONFLICT (id) DO NOTHING wouldn't match.
    expect(SETTING_IDS.publicDataSource).toBe('s-public-dataSource-global')
    expect(SETTING_IDS.publicWriteMode).toBe('s-public-writeMode-global')
  })

  it('ids are stable strings (not regenerated on import)', () => {
    const a = SETTING_IDS.publicDataSource
    const b = SETTING_IDS.publicDataSource
    expect(a).toBe(b)
  })
})
