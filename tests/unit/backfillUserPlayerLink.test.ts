import { describe, it, expect } from 'vitest'
import {
  decideBackfillAction,
  type BackfillInputs,
} from '../../scripts/backfillUserPlayerLink'

/**
 * v1.29.0 — User ↔ Player link backfill decision helper (stage β
 * companion). Pure-function tests — every branch of the planner.
 */

function inputs(partial: Partial<BackfillInputs>): BackfillInputs {
  return {
    player: { id: 'p-stefan-s', lineId: 'U_stefan', userId: null },
    user: { id: 'user-stefan', playerId: null },
    ...partial,
  }
}

describe('decideBackfillAction', () => {
  describe('skip-no-user branch', () => {
    it('returns skip-no-user when User is missing for the lineId', () => {
      const result = decideBackfillAction(inputs({ user: null }))
      expect(result.kind).toBe('skip-no-user')
      if (result.kind === 'skip-no-user') {
        expect(result.lineId).toBe('U_stefan')
        expect(result.playerId).toBe('p-stefan-s')
      }
    })
  })

  describe('link-exists branch', () => {
    it('returns link-exists when both pointers already canonical', () => {
      const result = decideBackfillAction(
        inputs({
          player: { id: 'p-stefan-s', lineId: 'U_stefan', userId: 'user-stefan' },
          user: { id: 'user-stefan', playerId: 'p-stefan-s' },
        }),
      )
      expect(result.kind).toBe('link-exists')
      if (result.kind === 'link-exists') {
        expect(result.userId).toBe('user-stefan')
        expect(result.playerId).toBe('p-stefan-s')
      }
    })
  })

  describe('create-link branch', () => {
    it('returns create-link when both pointers are null', () => {
      const result = decideBackfillAction(
        inputs({
          player: { id: 'p-stefan-s', lineId: 'U_stefan', userId: null },
          user: { id: 'user-stefan', playerId: null },
        }),
      )
      expect(result.kind).toBe('create-link')
      if (result.kind === 'create-link') {
        expect(result.userId).toBe('user-stefan')
        expect(result.playerId).toBe('p-stefan-s')
      }
    })
  })

  describe('drift-overwrite branch', () => {
    it('returns drift-overwrite when Player.userId mismatches', () => {
      const result = decideBackfillAction(
        inputs({
          player: { id: 'p-stefan-s', lineId: 'U_stefan', userId: 'user-WRONG' },
          user: { id: 'user-stefan', playerId: null },
        }),
      )
      expect(result.kind).toBe('drift-overwrite')
      if (result.kind === 'drift-overwrite') {
        expect(result.hadPlayerUserId).toBe('user-WRONG')
        expect(result.hadUserPlayerId).toBeNull()
      }
    })

    it('returns drift-overwrite when User.playerId mismatches', () => {
      const result = decideBackfillAction(
        inputs({
          player: { id: 'p-stefan-s', lineId: 'U_stefan', userId: null },
          user: { id: 'user-stefan', playerId: 'p-WRONG' },
        }),
      )
      expect(result.kind).toBe('drift-overwrite')
      if (result.kind === 'drift-overwrite') {
        expect(result.hadPlayerUserId).toBeNull()
        expect(result.hadUserPlayerId).toBe('p-WRONG')
      }
    })

    it('returns drift-overwrite when both pointers exist but neither matches canonical', () => {
      const result = decideBackfillAction(
        inputs({
          player: { id: 'p-stefan-s', lineId: 'U_stefan', userId: 'user-WRONG' },
          user: { id: 'user-stefan', playerId: 'p-WRONG' },
        }),
      )
      expect(result.kind).toBe('drift-overwrite')
    })
  })

  describe('idempotency (re-run scenarios)', () => {
    it('post-first-run: a previously create-link row resolves to link-exists', () => {
      const before = decideBackfillAction(
        inputs({
          player: { id: 'p-stefan-s', lineId: 'U_stefan', userId: null },
          user: { id: 'user-stefan', playerId: null },
        }),
      )
      expect(before.kind).toBe('create-link')

      const after = decideBackfillAction(
        inputs({
          player: { id: 'p-stefan-s', lineId: 'U_stefan', userId: 'user-stefan' },
          user: { id: 'user-stefan', playerId: 'p-stefan-s' },
        }),
      )
      expect(after.kind).toBe('link-exists')
    })

    it('post-first-run: a drift-overwrite row resolves to link-exists on the next pass', () => {
      const before = decideBackfillAction(
        inputs({
          player: { id: 'p-stefan-s', lineId: 'U_stefan', userId: 'user-WRONG' },
          user: { id: 'user-stefan', playerId: 'p-WRONG' },
        }),
      )
      expect(before.kind).toBe('drift-overwrite')

      const after = decideBackfillAction(
        inputs({
          player: { id: 'p-stefan-s', lineId: 'U_stefan', userId: 'user-stefan' },
          user: { id: 'user-stefan', playerId: 'p-stefan-s' },
        }),
      )
      expect(after.kind).toBe('link-exists')
    })
  })
})
