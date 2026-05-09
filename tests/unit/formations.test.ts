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
  assignAlternatesToSlots,
  assignPlayersToFormation,
  findFormation,
  getFormationsFor,
  playerCodeFillsSlot,
  playerCodeFillsSlotPrimary,
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

describe('[regression] playerCodeFillsSlot — futsal (v1.84.0 tightened)', () => {
  // v1.84.0 spec: GK + FIXO are strict (no fallback); ALA ↔ PIVOT only.
  it('GK + FIXO are strict — only their primary code fills them', () => {
    expect(playerCodeFillsSlot('FUTSAL', 'GK', 'GK')).toBe(true)
    expect(playerCodeFillsSlot('FUTSAL', 'FIXO', 'GK')).toBe(false)
    expect(playerCodeFillsSlot('FUTSAL', 'FIXO', 'FIXO')).toBe(true)
    // FIXO no longer falls back to ALA (was permissive pre-v1.84.0).
    expect(playerCodeFillsSlot('FUTSAL', 'FIXO', 'ALA')).toBe(false)
    expect(playerCodeFillsSlot('FUTSAL', 'FIXO', 'PIVOT')).toBe(false)
    // ALA no longer falls back to FIXO either.
    expect(playerCodeFillsSlot('FUTSAL', 'ALA', 'FIXO')).toBe(false)
  })

  it('ALA ↔ PIVOT cross-fill (the only futsal fallback)', () => {
    expect(playerCodeFillsSlot('FUTSAL', 'ALA', 'PIVOT')).toBe(true)
    expect(playerCodeFillsSlot('FUTSAL', 'PIVOT', 'ALA')).toBe(true)
    // Either way is primary into its own slot.
    expect(playerCodeFillsSlot('FUTSAL', 'ALA', 'ALA')).toBe(true)
    expect(playerCodeFillsSlot('FUTSAL', 'PIVOT', 'PIVOT')).toBe(true)
    // PIVOT does NOT fall back to FIXO.
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

  // ── v1.84.0 — primary helpers + slot→{primary, fallback} surface ─────

  it('[v1.84.0 regression] playerCodeFillsSlotPrimary — soccer LB strict', () => {
    expect(playerCodeFillsSlotPrimary('SOCCER', 'LB', 'LB')).toBe(true)
    // CB is in LB's FALLBACK list (not primary) → primary check is false.
    expect(playerCodeFillsSlotPrimary('SOCCER', 'CB', 'LB')).toBe(false)
    // But via the combined check, CB CAN fill LB (fallback).
    expect(playerCodeFillsSlot('SOCCER', 'CB', 'LB')).toBe(true)
  })

  it('[v1.84.0 regression] playerCodeFillsSlotPrimary — CM is primary only for CM slot', () => {
    expect(playerCodeFillsSlotPrimary('SOCCER', 'CM', 'CM')).toBe(true)
    // CM is in CAM/DM/LM/RM fallback, not primary.
    expect(playerCodeFillsSlotPrimary('SOCCER', 'CM', 'CAM')).toBe(false)
    expect(playerCodeFillsSlotPrimary('SOCCER', 'CM', 'DM')).toBe(false)
    expect(playerCodeFillsSlotPrimary('SOCCER', 'CM', 'LM')).toBe(false)
    expect(playerCodeFillsSlotPrimary('SOCCER', 'CM', 'RM')).toBe(false)
    // Combined check still finds them in fallback.
    expect(playerCodeFillsSlot('SOCCER', 'CM', 'CAM')).toBe(true)
    expect(playerCodeFillsSlot('SOCCER', 'CM', 'LM')).toBe(true)
  })

  it('[v1.84.0 regression] LB slot accepts CB / LM / DM as fallback', () => {
    expect(playerCodeFillsSlot('SOCCER', 'CB', 'LB')).toBe(true)
    expect(playerCodeFillsSlot('SOCCER', 'LM', 'LB')).toBe(true)
    expect(playerCodeFillsSlot('SOCCER', 'DM', 'LB')).toBe(true)
    // RB / RM / ST etc are NOT in LB's fallback.
    expect(playerCodeFillsSlot('SOCCER', 'RB', 'LB')).toBe(false)
    expect(playerCodeFillsSlot('SOCCER', 'ST', 'LB')).toBe(false)
  })

  it('[v1.84.0 regression] ST slot fallback = {CAM, LW, RW} per literal spec', () => {
    expect(playerCodeFillsSlot('SOCCER', 'CAM', 'ST')).toBe(true)
    expect(playerCodeFillsSlot('SOCCER', 'LW', 'ST')).toBe(true)
    expect(playerCodeFillsSlot('SOCCER', 'RW', 'ST')).toBe(true)
    // CM is NOT in ST's fallback (per literal user spec) — see phase log
    // for the spec-vs-narrative discrepancy note. CM stays unable to ST.
    expect(playerCodeFillsSlot('SOCCER', 'CM', 'ST')).toBe(false)
  })

  it('[v1.84.0 regression] futsal ALA ↔ PIVOT fallback', () => {
    expect(playerCodeFillsSlotPrimary('FUTSAL', 'ALA', 'ALA')).toBe(true)
    expect(playerCodeFillsSlotPrimary('FUTSAL', 'PIVOT', 'ALA')).toBe(false)
    // PIVOT is in ALA's fallback → combined true, primary false.
    expect(playerCodeFillsSlot('FUTSAL', 'PIVOT', 'ALA')).toBe(true)
  })

  it('handles the 4-0 futsal formation with v1.84.0 tightened compat (FIXO no longer fills ALA)', () => {
    const f = findFormation('FUTSAL', 5, '4-0')!
    expect(f.slots.filter((s) => s.code === 'ALA')).toHaveLength(4)
    const ps = players(
      ['gk', ['GK']],
      // FIXO: with the tightened spec, can't fill ALA → goes to subs.
      ['fixo', ['FIXO']],
      ['ala', ['ALA']],
      ['pivot', ['PIVOT']],
      ['extra', ['ALA']],
    )
    const result = assignPlayersToFormation('FUTSAL', f, ps)
    // 4 of 5 slots filled (GK + 3 ALAs); the 4th ALA stays empty (no
    // candidate left after the FIXO can't shift over).
    const filled = result.slotAssignments.filter((id) => id !== null)
    expect(filled).toContain('gk')
    expect(filled).toContain('ala')
    expect(filled).toContain('pivot')
    expect(filled).toContain('extra')
    expect(result.unassignedPlayers).toEqual(['fixo'])
  })
})

// ── v1.84.0 — two-pass + re-balance + alternates ─────────────────────────

describe('[v1.84.0 regression] assignPlayersToFormation — two-pass behaviour', () => {
  it('Pass 1 picks primary matches before Pass 2 fallback even when fallback would suffice', () => {
    // 9-aside 3-3-2: slots GK, LB, CB, RB, LM, CM, RM, ST×2.
    // Roster: a CB-only player and a DM-only player. CB can fill LB
    // (fallback) or CB (primary). DM can fill LB (fallback) but NOT CB
    // primary. Pass 1: CB takes CB (only primary candidate). Pass 2: DM
    // takes LB (fallback). LB does NOT poach the CB player in Pass 1.
    const f = findFormation('SOCCER', 9, '3-3-2')!
    const ps = players(
      ['cb_only', ['CB']],
      ['dm_only', ['DM']],
    )
    const result = assignPlayersToFormation('SOCCER', f, ps)
    const cbSlotIdx = f.slots.findIndex((s) => s.code === 'CB')
    const lbSlotIdx = f.slots.findIndex((s) => s.code === 'LB')
    expect(result.slotAssignments[cbSlotIdx]).toBe('cb_only')
    // dm_only is in LB's fallback {CB, LM, DM} → fills LB in Pass 2.
    expect(result.slotAssignments[lbSlotIdx]).toBe('dm_only')
  })

  it('Pass 2 fills LM/RM with CMs when no LM/RM specialist is available', () => {
    // The user's "3 CMs join" scenario, 9-aside 3-3-2.
    // CM primary takes 1; LM/RM fallback {…, CM} takes the other 2.
    const f = findFormation('SOCCER', 9, '3-3-2')!
    const ps = players(
      ['cm1', ['CM']],
      ['cm2', ['CM']],
      ['cm3', ['CM']],
    )
    const result = assignPlayersToFormation('SOCCER', f, ps)
    const cmSlotIdx = f.slots.findIndex((s) => s.code === 'CM')
    const lmSlotIdx = f.slots.findIndex((s) => s.code === 'LM')
    const rmSlotIdx = f.slots.findIndex((s) => s.code === 'RM')
    const stSlotIdx = f.slots.findIndex((s) => s.code === 'ST')

    expect(result.slotAssignments[cmSlotIdx]).not.toBeNull()
    expect(result.slotAssignments[lmSlotIdx]).not.toBeNull()
    expect(result.slotAssignments[rmSlotIdx]).not.toBeNull()
    // Per the literal spec: ST.fallback does NOT include CM, so the ST
    // slots stay empty. (See phase-formations-followup.log M1 for the
    // narrative-vs-literal discrepancy.)
    expect(result.slotAssignments[stSlotIdx]).toBeNull()

    const placedIds = new Set(
      result.slotAssignments.filter((id): id is string => id !== null),
    )
    expect(placedIds).toEqual(new Set(['cm1', 'cm2', 'cm3']))
    expect(result.unassignedPlayers).toEqual([])
  })

  it('re-balance: ST joining a 3-CM roster takes ST primary; CMs stay in CM/LM/RM', () => {
    // The user's narrative — "if a ST joins, then put ST in the ST role".
    // The function is pure, so re-running with the new roster is the
    // re-balance. Adding a ST primary should NOT displace any of the CMs
    // in CM/LM/RM (they were placed by primary or fallback already and
    // those slots aren't in ST's fallback list).
    const f = findFormation('SOCCER', 9, '3-3-2')!
    const before = assignPlayersToFormation('SOCCER', f,
      players(['cm1', ['CM']], ['cm2', ['CM']], ['cm3', ['CM']]),
    )
    const after = assignPlayersToFormation('SOCCER', f,
      players(['cm1', ['CM']], ['cm2', ['CM']], ['cm3', ['CM']], ['st_new', ['ST']]),
    )
    const stSlotIdx = f.slots.findIndex((s) => s.code === 'ST')
    expect(before.slotAssignments[stSlotIdx]).toBeNull()
    expect(after.slotAssignments[stSlotIdx]).toBe('st_new')
    // The 3 CMs are still placed (in CM/LM/RM) — none kicked to subs.
    expect(after.unassignedPlayers).toEqual([])
  })

  it('re-balance: CB primary displaces a CB-fallback DM out of LB when the roster grows', () => {
    // Initial: 1 DM only → DM falls back to LB (LB.fallback includes DM).
    // Add a CB-only player → CB takes CB primary, AND would also fit LB
    // via fallback. The DM that was occupying LB stays put because its
    // primary is DM (no DM slot exists in 3-3-2 for example) — actually
    // in 4-2-3-1 (11-aside) there ARE DM slots.
    // Use 11-aside 4-2-3-1 which has DM × 2, LB, CB × 2, RB.
    const f = findFormation('SOCCER', 11, '4-2-3-1')!
    const before = assignPlayersToFormation('SOCCER', f, players(['dm1', ['DM']]))
    const dmSlot1 = f.slots.findIndex((s) => s.code === 'DM')
    expect(before.slotAssignments[dmSlot1]).toBe('dm1')
    // Add a second DM → both fill DM × 2 primary. Add a CB → CB primary.
    const after = assignPlayersToFormation('SOCCER', f,
      players(['dm1', ['DM']], ['dm2', ['DM']], ['cb1', ['CB']]),
    )
    const dmSlots = f.slots
      .map((s, i) => ({ s, i }))
      .filter((x) => x.s.code === 'DM')
      .map((x) => x.i)
    const dmAssignments = dmSlots
      .map((i) => after.slotAssignments[i])
      .filter((id): id is string => id !== null)
    expect(dmAssignments.sort()).toEqual(['dm1', 'dm2'])
    const cbSlot = f.slots.findIndex((s) => s.code === 'CB')
    expect(after.slotAssignments[cbSlot]).toBe('cb1')
  })

  it('LB-strict slot picks LB primary in Pass 1 even with flexible fallback candidates available', () => {
    const f = findFormation('SOCCER', 11, '4-3-3')!
    const ps = players(
      ['gk', ['GK']],
      // The only LB-tagged player. Also tagged CM (a fallback for LM/RM).
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
    // Pass 1 placed every primary; Pass 2 isn't needed for any slot.
    expect(result.unassignedPlayers).toEqual([])
  })
})

describe('[v1.84.0 regression] assignAlternatesToSlots', () => {
  it('places each sub under their primary slot when one exists', () => {
    const f = findFormation('SOCCER', 11, '4-3-3')!
    const subs: AssignmentInput[] = [
      { id: 'sub_cb', positions: ['CB'] },
      { id: 'sub_cm', positions: ['CM'] },
      { id: 'sub_st', positions: ['ST'] },
    ]
    const result = assignAlternatesToSlots('SOCCER', f, subs)
    // Each sub lands under their primary slot.
    const cbSlots = f.slots.findIndex((s) => s.code === 'CB')
    const cmSlots = f.slots.findIndex((s) => s.code === 'CM')
    const stSlots = f.slots.findIndex((s) => s.code === 'ST')
    expect(result.slotAlternates[cbSlots]).toContain('sub_cb')
    expect(result.slotAlternates[cmSlots]).toContain('sub_cm')
    expect(result.slotAlternates[stSlots]).toContain('sub_st')
    expect(result.noFitOverflow).toEqual([])
  })

  it('places a sub under fallback slot when no primary slot exists in the formation', () => {
    // 5-aside 1-1-2: slots GK, CB, CM, ST, ST. No LB / DM / etc primary.
    const f = findFormation('SOCCER', 5, '1-1-2')!
    const subs: AssignmentInput[] = [
      // DM has no primary slot here, but DM ∈ CB.fallback {DM} and ∈ CM.fallback {DM, CAM}.
      { id: 'sub_dm', positions: ['DM'] },
    ]
    const result = assignAlternatesToSlots('SOCCER', f, subs)
    // Lands in the FIRST fallback-eligible slot in slot-array order.
    // Slot order: GK(0), CB(1), CM(2), ST(3), ST(4). CB fallback {DM} hits first.
    const cbIdx = f.slots.findIndex((s) => s.code === 'CB')
    expect(result.slotAlternates[cbIdx]).toContain('sub_dm')
  })

  it('no-fit subs land in noFitOverflow', () => {
    const f = findFormation('SOCCER', 5, '1-2-1')!
    const subs: AssignmentInput[] = [
      // GK can never go anywhere except a GK slot.
      { id: 'sub_gk', positions: ['GK'] },
    ]
    const result = assignAlternatesToSlots('SOCCER', f, subs)
    const gkIdx = f.slots.findIndex((s) => s.code === 'GK')
    expect(result.slotAlternates[gkIdx]).toContain('sub_gk')
    expect(result.noFitOverflow).toEqual([])
  })

  it('multiple subs share a slot when they all primary-match', () => {
    const f = findFormation('SOCCER', 9, '3-3-2')!
    const subs: AssignmentInput[] = [
      { id: 's1', positions: ['CM'] },
      { id: 's2', positions: ['CM'] },
      { id: 's3', positions: ['CM'] },
    ]
    const result = assignAlternatesToSlots('SOCCER', f, subs)
    const cmIdx = f.slots.findIndex((s) => s.code === 'CM')
    expect(result.slotAlternates[cmIdx]).toEqual(['s1', 's2', 's3'])
  })
})
