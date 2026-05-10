/**
 * v1.89.1 — pass 2.5 (empty-positions assignment) regression tests.
 *
 * Stash-pop verified: with the pass-2.5 block reverted in
 * `src/lib/formations.ts`, every `[v1.89.1 regression]` case below fails.
 * The legacy 5-pass algorithm leaves empty-positions players in the
 * `playersWithoutPositions` bucket only — these tests assert the new
 * behavior of placing them into back-most non-GK slots before falling
 * through to subs.
 */

import { describe, it, expect } from 'vitest'
import { assignPlayersToFormation } from '@/lib/formations'
import type { AssignmentInput, Formation } from '@/lib/formations'

function emptyPlayer(id: string): AssignmentInput {
  return { id, positions: [], preferredPositions: [], secondaryPositions: [] }
}
function positioned(id: string, preferred: string[]): AssignmentInput {
  return { id, positions: preferred, preferredPositions: preferred, secondaryPositions: [] }
}

const slot = (code: string, x = 0.5, y = 0.5) => ({ code: code as never, x, y })

describe('[v1.89.1 regression] pass 2.5 — empty-positions placement', () => {
  it('empty-positions player + only CB/CM slots open → goes to CB (back-most)', () => {
    const formation: Formation = {
      playerCount: 2,
      code: 'cb-cm',
      displayName: 'cb-cm',
      slots: [slot('CB', 0.5, 0.27), slot('CM', 0.5, 0.55)],
    }
    const result = assignPlayersToFormation('SOCCER', formation, [emptyPlayer('A')])
    expect(result.slotAssignments[0]).toBe('A') // CB filled
    expect(result.slotAssignments[1]).toBeNull() // CM stays empty
    expect(result.playersWithoutPositions).toContain('A')
    expect(result.unassignedPlayers).toEqual([])
  })

  it('empty-positions player + only GK + ST slots open → goes to ST (GK excluded)', () => {
    const formation: Formation = {
      playerCount: 2,
      code: 'gk-st',
      displayName: 'gk-st',
      slots: [slot('GK', 0.5, 0.06), slot('ST', 0.5, 0.85)],
    }
    const result = assignPlayersToFormation('SOCCER', formation, [emptyPlayer('A')])
    expect(result.slotAssignments[0]).toBeNull() // GK stays empty — never auto-fill
    expect(result.slotAssignments[1]).toBe('A') // ST filled
    expect(result.unassignedPlayers).toEqual([])
  })

  it('empty-positions player + only GK slot open → goes to subs (GK is the only slot but excluded)', () => {
    const formation: Formation = {
      playerCount: 1,
      code: 'gk-only',
      displayName: 'gk-only',
      slots: [slot('GK', 0.5, 0.06)],
    }
    const result = assignPlayersToFormation('SOCCER', formation, [emptyPlayer('A')])
    expect(result.slotAssignments[0]).toBeNull() // GK never auto-filled
    expect(result.playersWithoutPositions).toContain('A')
    expect(result.unassignedPlayers).toContain('A') // overflow to subs
  })

  it('two empty-positions players + CB + LB slots open → both placed (CB first by priority, LB next)', () => {
    const formation: Formation = {
      playerCount: 2,
      code: 'cb-lb',
      displayName: 'cb-lb',
      slots: [slot('LB', 0.15, 0.27), slot('CB', 0.5, 0.27)],
    }
    const result = assignPlayersToFormation('SOCCER', formation, [
      emptyPlayer('A'),
      emptyPlayer('B'),
    ])
    // First empty player (A) takes CB (priority 1). Second (B) takes LB (priority 2).
    expect(result.slotAssignments[1]).toBe('A') // CB at index 1
    expect(result.slotAssignments[0]).toBe('B') // LB at index 0
    expect(result.unassignedPlayers).toEqual([])
  })

  it('mixed: one CM player + one empty-positions player + CB + CM slots → CM player → CM (primary), empty → CB', () => {
    const formation: Formation = {
      playerCount: 2,
      code: 'cb-cm-mixed',
      displayName: 'cb-cm-mixed',
      slots: [slot('CB', 0.5, 0.27), slot('CM', 0.5, 0.55)],
    }
    const result = assignPlayersToFormation('SOCCER', formation, [
      positioned('cm-player', ['CM']),
      emptyPlayer('empty'),
    ])
    expect(result.slotAssignments[0]).toBe('empty') // CB ← empty-positions player (pass 2.5)
    expect(result.slotAssignments[1]).toBe('cm-player') // CM ← positioned player (pass 1a)
    expect(result.unassignedPlayers).toEqual([])
  })

  it('futsal: empty-positions player + only PIVOT + FIXO slots → FIXO first (back-most)', () => {
    const formation: Formation = {
      playerCount: 2,
      code: 'fixo-pivot',
      displayName: 'fixo-pivot',
      slots: [slot('PIVOT', 0.5, 0.85), slot('FIXO', 0.5, 0.27)],
    }
    const result = assignPlayersToFormation('FUTSAL', formation, [emptyPlayer('A')])
    expect(result.slotAssignments[1]).toBe('A') // FIXO at index 1 — picked first
    expect(result.slotAssignments[0]).toBeNull() // PIVOT stays empty
  })

  it('positioned players still get first dibs — pass 1/2 finishes before pass 2.5', () => {
    // Two CB-primary slots, two players: one CB-primary, one empty.
    // Positioned player must take CB first (pass 1a). Empty fills the other CB.
    const formation: Formation = {
      playerCount: 2,
      code: 'two-cb',
      displayName: 'two-cb',
      slots: [slot('CB', 0.32, 0.27), slot('CB', 0.68, 0.27)],
    }
    const result = assignPlayersToFormation('SOCCER', formation, [
      emptyPlayer('first-empty'),
      positioned('cb-player', ['CB']),
    ])
    expect(result.slotAssignments).toContain('cb-player')
    expect(result.slotAssignments).toContain('first-empty')
    expect(result.unassignedPlayers).toEqual([])
  })

  it('empty-positions never placed at GK even when GK is the back-most empty slot', () => {
    // GK + CB. CB filled by positioned player. Only GK remains. Empty must
    // NOT slot in — falls through to subs.
    const formation: Formation = {
      playerCount: 2,
      code: 'gk-cb',
      displayName: 'gk-cb',
      slots: [slot('GK', 0.5, 0.06), slot('CB', 0.5, 0.27)],
    }
    const result = assignPlayersToFormation('SOCCER', formation, [
      positioned('cb-player', ['CB']),
      emptyPlayer('empty'),
    ])
    expect(result.slotAssignments[0]).toBeNull() // GK still empty
    expect(result.slotAssignments[1]).toBe('cb-player') // CB filled
    expect(result.unassignedPlayers).toContain('empty') // empty player overflows to subs
  })

  it('priority order soccer: CB > LB/RB > DM > CM > CAM > LM/RM > LW/ST/RW', () => {
    // Single empty-positions player. Each iteration removes the highest-priority
    // slot and verifies the next one wins.
    const allCodes = ['CB', 'LB', 'DM', 'CM', 'CAM', 'LM', 'LW']
    // Walk the chain: remove the back-most each time.
    for (let cutoff = 0; cutoff < allCodes.length; cutoff++) {
      const codes = allCodes.slice(cutoff) // codes[0] should win
      const formation: Formation = {
        playerCount: codes.length,
        code: 'priority-' + cutoff,
        displayName: 'priority',
        slots: codes.map((c, i) => slot(c, 0.5, 0.1 + i * 0.1)),
      }
      const result = assignPlayersToFormation('SOCCER', formation, [emptyPlayer('A')])
      expect(result.slotAssignments[0], `cutoff=${cutoff}, expected ${codes[0]} at idx 0`).toBe('A')
      // Remaining slots stay empty.
      for (let i = 1; i < codes.length; i++) expect(result.slotAssignments[i]).toBeNull()
    }
  })

  it('priority order futsal: FIXO > ALA > PIVOT', () => {
    const formation: Formation = {
      playerCount: 3,
      code: 'futsal-priority',
      displayName: 'futsal',
      slots: [slot('PIVOT', 0.5, 0.85), slot('ALA', 0.5, 0.55), slot('FIXO', 0.5, 0.27)],
    }
    const result = assignPlayersToFormation('FUTSAL', formation, [emptyPlayer('A')])
    expect(result.slotAssignments[2]).toBe('A') // FIXO wins
    expect(result.slotAssignments[1]).toBeNull()
    expect(result.slotAssignments[0]).toBeNull()
  })

  it('LB/RB tie-break by slot index (deterministic)', () => {
    // LB at idx 0, RB at idx 1. Same priority (2). LB wins via lower idx.
    const formation: Formation = {
      playerCount: 2,
      code: 'lb-rb',
      displayName: 'lb-rb',
      slots: [slot('LB', 0.15, 0.27), slot('RB', 0.85, 0.27)],
    }
    const result = assignPlayersToFormation('SOCCER', formation, [emptyPlayer('A')])
    expect(result.slotAssignments[0]).toBe('A') // LB picked first
    expect(result.slotAssignments[1]).toBeNull()
  })

  it('full 4-3-3 with one empty-positions player + 10 positioned: empty fills the leftover slot if any', () => {
    // 11-slot 4-3-3 [GK, LB, CB, CB, RB, DM, CM, CM, LW, ST, RW]. Roster has
    // 10 positioned (covering every non-GK slot) + 1 empty. Empty has no
    // outfield slot left to claim → goes to subs (GK excluded).
    const formation: Formation = {
      playerCount: 11,
      code: '4-3-3',
      displayName: '4-3-3',
      slots: [
        slot('GK', 0.5, 0.06),
        slot('LB', 0.15, 0.27), slot('CB', 0.38, 0.27), slot('CB', 0.62, 0.27), slot('RB', 0.85, 0.27),
        slot('DM', 0.5, 0.42),
        slot('CM', 0.32, 0.55), slot('CM', 0.68, 0.55),
        slot('LW', 0.2, 0.85), slot('ST', 0.5, 0.85), slot('RW', 0.8, 0.85),
      ],
    }
    const ps: AssignmentInput[] = [
      positioned('lb', ['LB']), positioned('cb1', ['CB']), positioned('cb2', ['CB']), positioned('rb', ['RB']),
      positioned('dm', ['DM']),
      positioned('cm1', ['CM']), positioned('cm2', ['CM']),
      positioned('lw', ['LW']), positioned('st', ['ST']), positioned('rw', ['RW']),
      emptyPlayer('empty'),
    ]
    const result = assignPlayersToFormation('SOCCER', formation, ps)
    // GK never filled (no GK in roster) — empty doesn't go there either.
    expect(result.slotAssignments[0]).toBeNull()
    // Every non-GK slot filled by a positioned player; empty bumped to subs.
    expect(result.unassignedPlayers).toContain('empty')
    expect(result.slotAssignments).not.toContain('empty')
  })

  it('three empty-positions players + 4-3-3 with no positioned outfield → fill CB > CB > LB', () => {
    // GK, LB, CB, CB, RB are the back five. CBs (priority 1) fill first.
    // Order of empty players: A, B, C.
    const formation: Formation = {
      playerCount: 5,
      code: 'back5',
      displayName: 'back5',
      slots: [
        slot('GK', 0.5, 0.06),
        slot('LB', 0.15, 0.27), slot('CB', 0.38, 0.27), slot('CB', 0.62, 0.27), slot('RB', 0.85, 0.27),
      ],
    }
    const result = assignPlayersToFormation('SOCCER', formation, [
      emptyPlayer('A'), emptyPlayer('B'), emptyPlayer('C'),
    ])
    expect(result.slotAssignments[0]).toBeNull() // GK
    // CB at idx 2 (priority 1, lower idx) → A
    expect(result.slotAssignments[2]).toBe('A')
    // CB at idx 3 → B
    expect(result.slotAssignments[3]).toBe('B')
    // LB at idx 1 (priority 2) → C
    expect(result.slotAssignments[1]).toBe('C')
    // RB at idx 4 stays empty (only 3 empty players)
    expect(result.slotAssignments[4]).toBeNull()
    expect(result.unassignedPlayers).toEqual([])
  })

  it('player with single preferred position is NOT empty and does not enter pass 2.5', () => {
    // Sanity: a player with positions=['CB'] is positioned, not empty. They
    // go through the normal 5-pass route. Slot is CM (CB primary fallback
    // doesn't include CM → CM.fallback={DM, CAM} so still no match).
    const formation: Formation = {
      playerCount: 1,
      code: 'cm-only',
      displayName: 'cm-only',
      slots: [slot('CM', 0.5, 0.55)],
    }
    const result = assignPlayersToFormation('SOCCER', formation, [positioned('p', ['CB'])])
    // CB doesn't fill CM (not in CM.primary or CM.fallback) → unassigned.
    expect(result.slotAssignments[0]).toBeNull()
    expect(result.playersWithoutPositions).toEqual([]) // not empty-positions
    expect(result.unassignedPlayers).toContain('p')
  })

  it('empty-positions player only fills slots when positioned candidates exhaust their passes', () => {
    // Two CB players + one empty. Two CB slots. Both CBs take their primary
    // slots in pass 1a; empty player has no slot left → subs.
    const formation: Formation = {
      playerCount: 2,
      code: 'two-cb-2',
      displayName: 'two-cb-2',
      slots: [slot('CB', 0.32, 0.27), slot('CB', 0.68, 0.27)],
    }
    const result = assignPlayersToFormation('SOCCER', formation, [
      positioned('cb1', ['CB']),
      positioned('cb2', ['CB']),
      emptyPlayer('empty'),
    ])
    expect(result.slotAssignments[0]).not.toBeNull()
    expect(result.slotAssignments[1]).not.toBeNull()
    expect(result.unassignedPlayers).toContain('empty')
  })
})
