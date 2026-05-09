/**
 * v1.83.0 — formation library + multi-role assignment regression tests.
 *
 * Pinning the per-format catalog shape, the slot-compat map, and the
 * scarcity-first assignment behavior. Each test that targets the
 * "regression-target" surface starts with `[regression]` so a future
 * stash-pop sanity check can be filtered.
 *
 * Stash-pop verified: with `formations.ts` reverted, `[regression]`
 * tests in this file fail. `[catalog]` and `[shape]` tests are pure
 * structural pins and would also fail when the file doesn't exist.
 */

import { describe, it, expect } from 'vitest'
import {
  type AssignmentInput,
  type Formation,
  assignPlayersToFormation,
  findFormation,
  getFormationsFor,
  playerCodeFillsSlot,
  playerFillsSlot,
} from '@/lib/formations'

// ── Catalog shape ─────────────────────────────────────────────────────────

describe('[catalog] getFormationsFor', () => {
  it('returns the soccer 12-code catalog for SOCCER + every supported playerCount', () => {
    for (const n of [5, 6, 7, 8, 9, 10, 11]) {
      const list = getFormationsFor('SOCCER', n)
      expect(list, `SOCCER/${n}-aside has formations`).toHaveLength(5)
      // Every formation must total `n` slots (1 GK + outfield).
      for (const f of list) {
        expect(f.slots.length, `${f.code} totals ${n} slots`).toBe(n)
        expect(f.playerCount, `${f.code} declares playerCount=${n}`).toBe(n)
        expect(f.code, `${f.code} matches displayName`).toBe(f.displayName.split(' ')[0])
      }
    }
  })

  it('returns the futsal 4-code catalog for FUTSAL/5-aside', () => {
    const list = getFormationsFor('FUTSAL', 5)
    expect(list).toHaveLength(5)
    const codes = list.map((f) => f.code)
    expect(codes).toEqual(['1-2-1', '2-2', '1-1-2', '2-1-1', '4-0'])
    // Every futsal slot uses the futsal vocabulary only.
    const futsalVocab = new Set(['GK', 'FIXO', 'ALA', 'PIVOT'])
    for (const f of list) {
      for (const slot of f.slots) {
        expect(futsalVocab.has(slot.code), `${f.code} slot ${slot.code} is futsal-vocab`).toBe(true)
      }
    }
  })

  it('SOCCER catalog uses the 12-code soccer vocabulary only', () => {
    const soccerVocab = new Set([
      'GK', 'LB', 'CB', 'RB', 'LM', 'DM', 'CM', 'CAM', 'RM', 'LW', 'ST', 'RW',
    ])
    for (const n of [5, 6, 7, 8, 9, 10, 11]) {
      for (const f of getFormationsFor('SOCCER', n)) {
        for (const slot of f.slots) {
          expect(soccerVocab.has(slot.code), `${f.code} slot ${slot.code} is soccer-vocab`).toBe(true)
        }
      }
    }
  })

  it('returns [] for unsupported (ballType, playerCount) combinations', () => {
    expect(getFormationsFor('SOCCER', 4)).toEqual([])
    expect(getFormationsFor('SOCCER', 12)).toEqual([])
    expect(getFormationsFor('FUTSAL', 6)).toEqual([])
    expect(getFormationsFor('SOCCER', null)).toEqual([])
    expect(getFormationsFor(null, 9)).toEqual(getFormationsFor('SOCCER', 9))
  })

  it('every formation slot has x and y in [0, 1]', () => {
    const all: Formation[] = []
    for (const n of [5, 6, 7, 8, 9, 10, 11]) all.push(...getFormationsFor('SOCCER', n))
    all.push(...getFormationsFor('FUTSAL', 5))
    for (const f of all) {
      for (const slot of f.slots) {
        expect(slot.x, `${f.code} ${slot.code} x in [0,1]`).toBeGreaterThanOrEqual(0)
        expect(slot.x).toBeLessThanOrEqual(1)
        expect(slot.y, `${f.code} ${slot.code} y in [0,1]`).toBeGreaterThanOrEqual(0)
        expect(slot.y).toBeLessThanOrEqual(1)
      }
    }
  })

  it('every formation has exactly one GK slot', () => {
    const all: Formation[] = []
    for (const n of [5, 6, 7, 8, 9, 10, 11]) all.push(...getFormationsFor('SOCCER', n))
    all.push(...getFormationsFor('FUTSAL', 5))
    for (const f of all) {
      const gks = f.slots.filter((s) => s.code === 'GK')
      expect(gks, `${f.code} has exactly one GK`).toHaveLength(1)
    }
  })
})

describe('[catalog] findFormation', () => {
  it('finds a formation by code within its (ballType, playerCount) catalog', () => {
    const f = findFormation('SOCCER', 11, '4-3-3')
    expect(f).not.toBeNull()
    expect(f!.slots).toHaveLength(11)
    expect(f!.code).toBe('4-3-3')
  })

  it('returns null when the code does not exist in the catalog', () => {
    expect(findFormation('SOCCER', 11, 'NOPE')).toBeNull()
    expect(findFormation('FUTSAL', 5, '4-3-3')).toBeNull()
  })
})

// ── Slot-compat map ───────────────────────────────────────────────────────

describe('[regression] playerCodeFillsSlot — soccer (per user spec)', () => {
  it('LB player can fill any LB slot (strict)', () => {
    expect(playerCodeFillsSlot('SOCCER', 'LB', 'LB')).toBe(true)
    // strict — does NOT auto-shift to CB/RB
    expect(playerCodeFillsSlot('SOCCER', 'LB', 'CB')).toBe(false)
    expect(playerCodeFillsSlot('SOCCER', 'LB', 'RB')).toBe(false)
  })

  it('CM player can fill DM, CM, or CAM slots (per spec)', () => {
    expect(playerCodeFillsSlot('SOCCER', 'CM', 'DM')).toBe(true)
    expect(playerCodeFillsSlot('SOCCER', 'CM', 'CM')).toBe(true)
    expect(playerCodeFillsSlot('SOCCER', 'CM', 'CAM')).toBe(true)
    // and not, e.g. wide or goalkeeper:
    expect(playerCodeFillsSlot('SOCCER', 'CM', 'GK')).toBe(false)
    expect(playerCodeFillsSlot('SOCCER', 'CM', 'LW')).toBe(false)
  })

  it('LM player can fill LM or LW slots (per spec)', () => {
    expect(playerCodeFillsSlot('SOCCER', 'LM', 'LM')).toBe(true)
    expect(playerCodeFillsSlot('SOCCER', 'LM', 'LW')).toBe(true)
    expect(playerCodeFillsSlot('SOCCER', 'LM', 'RM')).toBe(false)
  })

  it('GK is mutually exclusive — only GK fills GK', () => {
    expect(playerCodeFillsSlot('SOCCER', 'GK', 'GK')).toBe(true)
    expect(playerCodeFillsSlot('SOCCER', 'CB', 'GK')).toBe(false)
    expect(playerCodeFillsSlot('SOCCER', 'CM', 'GK')).toBe(false)
  })

  it('case-insensitive on slot code (defensive)', () => {
    expect(playerCodeFillsSlot('SOCCER', 'cm', 'cam')).toBe(true)
    expect(playerCodeFillsSlot('SOCCER', 'CM', 'cam')).toBe(true)
  })

  it('unknown player code matches nothing', () => {
    expect(playerCodeFillsSlot('SOCCER', 'WAT', 'CM')).toBe(false)
    expect(playerCodeFillsSlot('SOCCER', '', 'CM')).toBe(false)
  })
})

describe('[regression] playerCodeFillsSlot — futsal', () => {
  it('GK strict; FIXO/PIVOT/ALA permissive on neighbors', () => {
    expect(playerCodeFillsSlot('FUTSAL', 'GK', 'GK')).toBe(true)
    expect(playerCodeFillsSlot('FUTSAL', 'FIXO', 'FIXO')).toBe(true)
    expect(playerCodeFillsSlot('FUTSAL', 'FIXO', 'ALA')).toBe(true)
    expect(playerCodeFillsSlot('FUTSAL', 'FIXO', 'PIVOT')).toBe(false)
    expect(playerCodeFillsSlot('FUTSAL', 'ALA', 'PIVOT')).toBe(true)
    expect(playerCodeFillsSlot('FUTSAL', 'ALA', 'FIXO')).toBe(true)
    expect(playerCodeFillsSlot('FUTSAL', 'PIVOT', 'ALA')).toBe(true)
    expect(playerCodeFillsSlot('FUTSAL', 'PIVOT', 'FIXO')).toBe(false)
  })
})

describe('[regression] playerFillsSlot — multi-position', () => {
  it('any matching position in the array makes the player eligible', () => {
    expect(playerFillsSlot('SOCCER', ['CB', 'CM'], 'CAM')).toBe(true)
    expect(playerFillsSlot('SOCCER', ['CB', 'CM'], 'GK')).toBe(false)
  })

  it('empty positions array → never eligible', () => {
    expect(playerFillsSlot('SOCCER', [], 'CM')).toBe(false)
  })
})

// ── Multi-role assignment algorithm ───────────────────────────────────────

function players(...defs: Array<[id: string, positions: string[]]>): AssignmentInput[] {
  return defs.map(([id, positions]) => ({ id, positions }))
}

describe('[regression] assignPlayersToFormation — happy path', () => {
  it('fills 11 slots in 4-3-3 from a balanced roster', () => {
    const f = findFormation('SOCCER', 11, '4-3-3')!
    const ps = players(
      ['gk', ['GK']],
      ['lb', ['LB']],
      ['cb1', ['CB']],
      ['cb2', ['CB']],
      ['rb', ['RB']],
      ['dm', ['DM']],
      ['cm1', ['CM']],
      ['cm2', ['CM']],
      ['lw', ['LW']],
      ['st', ['ST']],
      ['rw', ['RW']],
    )
    const result = assignPlayersToFormation('SOCCER', f, ps)
    expect(result.slotAssignments).toHaveLength(11)
    expect(result.slotAssignments.every((id) => id !== null)).toBe(true)
    expect(result.unassignedPlayers).toEqual([])
    expect(result.playersWithoutPositions).toEqual([])
    // GK slot must be filled by the GK-only player
    const gkSlotIdx = f.slots.findIndex((s) => s.code === 'GK')
    expect(result.slotAssignments[gkSlotIdx]).toBe('gk')
  })

  it('fills futsal 1-2-1 (Diamond) from a 5-roster', () => {
    const f = findFormation('FUTSAL', 5, '1-2-1')!
    const ps = players(
      ['gk', ['GK']],
      ['fixo', ['FIXO']],
      ['ala1', ['ALA']],
      ['ala2', ['ALA']],
      ['pivot', ['PIVOT']],
    )
    const result = assignPlayersToFormation('FUTSAL', f, ps)
    expect(result.slotAssignments.every((id) => id !== null)).toBe(true)
    expect(result.unassignedPlayers).toEqual([])
  })
})

describe('[regression] assignPlayersToFormation — multi-role players', () => {
  it('a CM player gets placed into a CAM slot when no pure CAM is available', () => {
    const f = findFormation('SOCCER', 11, '4-2-3-1')!
    const ps = players(
      ['gk', ['GK']],
      ['lb', ['LB']],
      ['cb1', ['CB']],
      ['cb2', ['CB']],
      ['rb', ['RB']],
      ['dm1', ['DM']],
      ['dm2', ['DM']],
      ['lw', ['LW']],
      // No CAM specialist — CM must fill the CAM slot.
      ['cm', ['CM']],
      ['rw', ['RW']],
      ['st', ['ST']],
    )
    const result = assignPlayersToFormation('SOCCER', f, ps)
    const camSlotIdx = f.slots.findIndex((s) => s.code === 'CAM')
    expect(camSlotIdx).toBeGreaterThanOrEqual(0)
    expect(result.slotAssignments[camSlotIdx]).toBe('cm')
  })

  it('scarcity-first: LB-strict slot gets the only LB-tagged player even when they ALSO have CM', () => {
    const f = findFormation('SOCCER', 11, '4-3-3')!
    const ps = players(
      ['gk', ['GK']],
      // The only player who can fill LB. Also has CM, but LB scarcity wins.
      ['lbcm', ['LB', 'CM']],
      ['cb1', ['CB']],
      ['cb2', ['CB']],
      ['rb', ['RB']],
      ['dm', ['DM']],
      ['cm1', ['CM']],
      ['cm2', ['CM']],
      ['lw', ['LW']],
      ['st', ['ST']],
      ['rw', ['RW']],
    )
    const result = assignPlayersToFormation('SOCCER', f, ps)
    const lbSlotIdx = f.slots.findIndex((s) => s.code === 'LB')
    expect(result.slotAssignments[lbSlotIdx]).toBe('lbcm')
  })
})

describe('[regression] assignPlayersToFormation — edge cases', () => {
  it('players with empty positions go to playersWithoutPositions, not the slot pool', () => {
    const f = findFormation('SOCCER', 11, '4-3-3')!
    const ps = players(
      ['gk', ['GK']],
      ['ghost', []],
    )
    const result = assignPlayersToFormation('SOCCER', f, ps)
    expect(result.playersWithoutPositions).toContain('ghost')
    expect(result.slotAssignments).not.toContain('ghost')
    expect(result.unassignedPlayers).not.toContain('ghost')
  })

  it('fewer eligible players than slots → leftover slots remain null', () => {
    const f = findFormation('SOCCER', 11, '4-3-3')!
    const ps = players(['gk', ['GK']], ['cb', ['CB']])
    const result = assignPlayersToFormation('SOCCER', f, ps)
    const filled = result.slotAssignments.filter((id) => id !== null)
    expect(filled).toHaveLength(2)
    const empty = result.slotAssignments.filter((id) => id === null)
    expect(empty.length).toBeGreaterThan(0)
  })

  it('more eligible players than slots → overflow lands in unassignedPlayers (subs)', () => {
    const f = findFormation('SOCCER', 9, '3-3-2')!
    // 12 players, 9 slots → 3 subs.
    const ps = players(
      ['gk', ['GK']],
      ['lb', ['LB']],
      ['cb1', ['CB']],
      ['rb', ['RB']],
      ['lm', ['LM']],
      ['cm', ['CM']],
      ['rm', ['RM']],
      ['st1', ['ST']],
      ['st2', ['ST']],
      // Extras — flexible CMs that should land in subs since no slot is short.
      ['sub1', ['CM']],
      ['sub2', ['CM']],
      ['sub3', ['CM']],
    )
    const result = assignPlayersToFormation('SOCCER', f, ps)
    expect(result.slotAssignments.every((id) => id !== null)).toBe(true)
    expect(result.unassignedPlayers).toHaveLength(3)
  })

  it('assignment is deterministic — same input produces same output', () => {
    const f = findFormation('SOCCER', 9, '3-3-2')!
    const ps = players(
      ['gk', ['GK']],
      ['p1', ['CB']], ['p2', ['CB']], ['p3', ['CB']],
      ['p4', ['CM']], ['p5', ['CM']], ['p6', ['CM']],
      ['p7', ['ST']], ['p8', ['ST']],
    )
    const a = assignPlayersToFormation('SOCCER', f, ps)
    const b = assignPlayersToFormation('SOCCER', f, ps)
    expect(a.slotAssignments).toEqual(b.slotAssignments)
  })

  it('GK player only goes into the GK slot, never an outfield slot', () => {
    const f = findFormation('SOCCER', 11, '4-3-3')!
    // Only one player; they should land in GK and nowhere else.
    const result = assignPlayersToFormation('SOCCER', f, players(['gk', ['GK']]))
    const gkSlotIdx = f.slots.findIndex((s) => s.code === 'GK')
    expect(result.slotAssignments[gkSlotIdx]).toBe('gk')
    // Every other slot is null.
    for (let i = 0; i < result.slotAssignments.length; i++) {
      if (i === gkSlotIdx) continue
      expect(result.slotAssignments[i]).toBeNull()
    }
  })

  it('outfield player is never auto-placed in the GK slot', () => {
    const f = findFormation('SOCCER', 11, '4-3-3')!
    // No GK player at all. The GK slot must remain empty.
    const ps = players(
      ['lb', ['LB']],
      ['cb1', ['CB']],
      ['cb2', ['CB']],
      ['rb', ['RB']],
      ['dm', ['DM']],
      ['cm1', ['CM']],
      ['cm2', ['CM']],
      ['lw', ['LW']],
      ['st', ['ST']],
      ['rw', ['RW']],
    )
    const result = assignPlayersToFormation('SOCCER', f, ps)
    const gkSlotIdx = f.slots.findIndex((s) => s.code === 'GK')
    expect(result.slotAssignments[gkSlotIdx]).toBeNull()
  })

  it('handles the 4-0 futsal formation (4 ALA outfield) with a mixed roster', () => {
    const f = findFormation('FUTSAL', 5, '4-0')!
    expect(f.slots.filter((s) => s.code === 'ALA')).toHaveLength(4)
    const ps = players(
      ['gk', ['GK']],
      ['fixo', ['FIXO']],
      ['ala', ['ALA']],
      ['pivot', ['PIVOT']],
      ['extra', ['ALA']],
    )
    const result = assignPlayersToFormation('FUTSAL', f, ps)
    // All 5 slots filled — every futsal outfield code (FIXO/ALA/PIVOT) can fill an ALA slot.
    expect(result.slotAssignments.every((id) => id !== null)).toBe(true)
    expect(result.unassignedPlayers).toEqual([])
  })
})
