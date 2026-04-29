import { describe, it, expect } from 'vitest'
import { SETTING_IDS, resolveDataSource } from '@/lib/settings'

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

describe('resolveDataSource', () => {
  // v1.12.0 — the fallback on missing rows is 'db', not 'sheets'. Pre-v1.12
  // a deleted Setting row / missing seed migration / fresh Neon branch
  // silently routed the public site at the legacy Sheets parser. The new
  // default fails-safe to Postgres; operators flipping back to Sheets must
  // do so explicitly via admin Settings.
  it("returns 'db' when the Setting value is missing", () => {
    expect(resolveDataSource(null)).toBe('db')
    expect(resolveDataSource(undefined)).toBe('db')
  })

  it("returns 'db' when the value is unrecognized", () => {
    expect(resolveDataSource('')).toBe('db')
    expect(resolveDataSource('postgres')).toBe('db')
    expect(resolveDataSource('DB')).toBe('db')
  })

  it("returns 'sheets' only on the explicit 'sheets' value", () => {
    expect(resolveDataSource('sheets')).toBe('sheets')
  })

  it("returns 'db' on the explicit 'db' value", () => {
    expect(resolveDataSource('db')).toBe('db')
  })
})
