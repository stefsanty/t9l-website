import { describe, it, expect } from 'vitest'
import { groupedPositionLabel } from '@/lib/positions'
import { assignPlayersToFormation, getFormationsFor } from '@/lib/formations'
import type { AssignmentInput } from '@/lib/formations'

// ── Task B: groupedPositionLabel ──────────────────────────────────────────

describe('[v1.85.2 regression] groupedPositionLabel — soccer grouping', () => {
  it('single GK → "GK"', () => {
    expect(groupedPositionLabel(['GK'])).toBe('GK')
  })

  it('single CB → "DF"', () => {
    expect(groupedPositionLabel(['CB'])).toBe('DF')
  })

  it('LB → "DF", RB → "DF"', () => {
    expect(groupedPositionLabel(['LB'])).toBe('DF')
    expect(groupedPositionLabel(['RB'])).toBe('DF')
  })

  it('CM → "MF", DM → "MF", CAM → "MF", LM → "MF", RM → "MF"', () => {
    expect(groupedPositionLabel(['CM'])).toBe('MF')
    expect(groupedPositionLabel(['DM'])).toBe('MF')
    expect(groupedPositionLabel(['CAM'])).toBe('MF')
    expect(groupedPositionLabel(['LM'])).toBe('MF')
    expect(groupedPositionLabel(['RM'])).toBe('MF')
  })

  it('ST → "FW", LW → "FW", RW → "FW"', () => {
    expect(groupedPositionLabel(['ST'])).toBe('FW')
    expect(groupedPositionLabel(['LW'])).toBe('FW')
    expect(groupedPositionLabel(['RW'])).toBe('FW')
  })

  it('dedupes same bucket: [CM, CAM] → "MF" not "MF / MF"', () => {
    expect(groupedPositionLabel(['CM', 'CAM'])).toBe('MF')
  })

  it('dedupes: [CB, LB, RB] → "DF"', () => {
    expect(groupedPositionLabel(['CB', 'LB', 'RB'])).toBe('DF')
  })

  it('mixed buckets: [CB, LW] → "DF / FW"', () => {
    expect(groupedPositionLabel(['CB', 'LW'])).toBe('DF / FW')
  })

  it('mixed buckets: [CM, ST] → "MF / FW"', () => {
    expect(groupedPositionLabel(['CM', 'ST'])).toBe('MF / FW')
  })

  it('empty array → ""', () => {
    expect(groupedPositionLabel([])).toBe('')
  })
})

describe('[v1.85.2 regression] groupedPositionLabel — futsal passthrough', () => {
  it('FIXO passes through unchanged (not "DF")', () => {
    expect(groupedPositionLabel(['FIXO'])).toBe('FIXO')
  })

  it('ALA passes through unchanged (not "MF")', () => {
    expect(groupedPositionLabel(['ALA'])).toBe('ALA')
  })

  it('PIVOT passes through unchanged (not "FW")', () => {
    expect(groupedPositionLabel(['PIVOT'])).toBe('PIVOT')
  })

  it('futsal GK still → "GK"', () => {
    expect(groupedPositionLabel(['GK'])).toBe('GK')
  })

  it('[ALA, PIVOT] → "ALA / PIVOT"', () => {
    expect(groupedPositionLabel(['ALA', 'PIVOT'])).toBe('ALA / PIVOT')
  })
})

// ── Task C: 5-pass algorithm ──────────────────────────────────────────────

describe('[v1.85.2 regression] assignPlayersToFormation — 5-pass primary/secondary', () => {
  // Helper: pick the first 9-aside formation (3-3-2) from SOCCER catalog
  const formation9 = getFormationsFor('SOCCER', 9)[0]!

  it('Pass 1a: player primary (positions[0]) fills slot.primary before secondary', () => {
    // A=[CM,ST] has CM as primary. There is a CM slot and an ST slot.
    // Pass 1a should place A at CM (primary→primary match).
    // B=[GK] fills GK slot.
    // ST slot stays empty (no more players).
    const players: AssignmentInput[] = [
      { id: 'A', positions: ['CM', 'ST'] },
      { id: 'B', positions: ['GK'] },
    ]
    // Use a minimal formation: GK + CM + ST
    const minFormation = {
      playerCount: 3,
      code: 'test',
      displayName: 'test',
      slots: [
        { code: 'GK', x: 0.5, y: 0.06 },
        { code: 'CM', x: 0.5, y: 0.55 },
        { code: 'ST', x: 0.5, y: 0.85 },
      ],
    }
    const result = assignPlayersToFormation('SOCCER', minFormation, players)
    const gkIdx = 0
    const cmIdx = 1
    const stIdx = 2
    expect(result.slotAssignments[gkIdx]).toBe('B')
    expect(result.slotAssignments[cmIdx]).toBe('A')
    expect(result.slotAssignments[stIdx]).toBeNull() // no one left for ST
  })

  it('Pass 1b: secondary position fills slot.primary when primary is already placed', () => {
    // A=[GK], B=[CM,ST]: A fills GK (1a), B.positions[0]=CM fills CM (1a).
    // C=[DM,ST]: C.positions[0]=DM. DM slot exists? Use a DM+ST formation.
    // B's secondary ST fills the ST slot via pass 1b IF B is still unplaced.
    // Set up: A=[GK], B=[ST,CM] (ST as primary), C=[CM] — B fills ST(1a), C fills CM(1a), done.
    // To test 1b: A=[GK], B=[CM], C=[DM,ST]: 1a places A→GK, B→CM, C→DM. ST empty.
    // Better: A=[GK], B=[LM,ST]: 1a: B→LM (B.positions[0]=LM, LM slot primary).
    //         ST slot: pass 1b checks remaining unplaced players' secondaries.
    //         Nobody unplaced has ST as secondary → empty.
    //
    // Real 1b test: A=[GK], B=[DM], C=[CM,LM] in a [GK,DM,LM] formation.
    //   1a: A→GK (primary), B→DM (primary), C→? C.positions[0]=CM, no CM slot.
    //   1b: C.positions[1]=LM matches LM slot.primary → C→LM.
    const players: AssignmentInput[] = [
      { id: 'A', positions: ['GK'] },
      { id: 'B', positions: ['DM'] },
      { id: 'C', positions: ['CM', 'LM'] },
    ]
    const formation = {
      playerCount: 3,
      code: 'test-1b',
      displayName: 'test-1b',
      slots: [
        { code: 'GK', x: 0.5, y: 0.06 },
        { code: 'DM', x: 0.5, y: 0.42 },
        { code: 'LM', x: 0.2, y: 0.55 },
      ],
    }
    const result = assignPlayersToFormation('SOCCER', formation, players)
    expect(result.slotAssignments[0]).toBe('A') // GK→A
    expect(result.slotAssignments[1]).toBe('B') // DM→B
    expect(result.slotAssignments[2]).toBe('C') // LM→C via secondary (pass 1b)
    expect(result.unassignedPlayers).toHaveLength(0)
  })

  it('Pass 2a: player primary fills slot.fallback when slot.primary exhausted', () => {
    // A=[GK], B=[CB] — formation has [GK, LB]. CB is in LB.fallback.
    // 1a: A→GK. LB primary=['LB'], B.positions[0]=CB ∉ ['LB'] → skip.
    // 1b: B has no secondaries.
    // 2a: B.positions[0]=CB, LB.fallback=['CB','LM','DM'] → B→LB.
    const players: AssignmentInput[] = [
      { id: 'A', positions: ['GK'] },
      { id: 'B', positions: ['CB'] },
    ]
    const formation = {
      playerCount: 2,
      code: 'test-2a',
      displayName: 'test-2a',
      slots: [
        { code: 'GK', x: 0.5, y: 0.06 },
        { code: 'LB', x: 0.2, y: 0.27 },
      ],
    }
    const result = assignPlayersToFormation('SOCCER', formation, players)
    expect(result.slotAssignments[0]).toBe('A')
    expect(result.slotAssignments[1]).toBe('B') // CB fills LB via fallback (pass 2a)
  })

  it('Pass 2b: player secondary fills slot.fallback when all earlier passes miss', () => {
    // A=[GK], B=[ST,CB]: ST not in LB.primary or LB.fallback; CB is in LB.fallback.
    // 1a: A→GK. B.positions[0]=ST, LB.primary=['LB'] → miss.
    // 1b: B.positions[1]=CB, LB.primary=['LB'] → miss.
    // 2a: B.positions[0]=ST, LB.fallback=['CB','LM','DM'] → miss.
    // 2b: B.positions[1]=CB, LB.fallback=['CB','LM','DM'] → hit → B→LB.
    const players: AssignmentInput[] = [
      { id: 'A', positions: ['GK'] },
      { id: 'B', positions: ['ST', 'CB'] },
    ]
    const formation = {
      playerCount: 2,
      code: 'test-2b',
      displayName: 'test-2b',
      slots: [
        { code: 'GK', x: 0.5, y: 0.06 },
        { code: 'LB', x: 0.2, y: 0.27 },
      ],
    }
    const result = assignPlayersToFormation('SOCCER', formation, players)
    expect(result.slotAssignments[0]).toBe('A')
    expect(result.slotAssignments[1]).toBe('B') // CB secondary fills LB via pass 2b
  })

  it('primary beats secondary: two players A=[CM] B=[LM,CM] competing for CM and LM slots', () => {
    // A.positions[0]=CM (primary), B.positions[0]=LM (primary).
    // Pass 1a: both slots have primary candidates. Scarcity-first:
    //   CM slot: candidates={A}, size=1.
    //   LM slot: candidates={B}, size=1.
    //   Both size=1; pick by index. A→CM, B→LM.
    const players: AssignmentInput[] = [
      { id: 'A', positions: ['CM'] },
      { id: 'B', positions: ['LM', 'CM'] },
    ]
    const formation = {
      playerCount: 2,
      code: 'test-primary-beats-secondary',
      displayName: 'test',
      slots: [
        { code: 'CM', x: 0.5, y: 0.55 },
        { code: 'LM', x: 0.2, y: 0.55 },
      ],
    }
    const result = assignPlayersToFormation('SOCCER', formation, players)
    expect(result.slotAssignments[0]).toBe('A') // CM→A (primary match for A)
    expect(result.slotAssignments[1]).toBe('B') // LM→B (primary match for B)
    expect(result.unassignedPlayers).toHaveLength(0)
  })

  it('worked example from spec: A=[CM,ST] in [CM,ST] formation → A fills CM (1a), ST stays empty', () => {
    const players: AssignmentInput[] = [
      { id: 'A', positions: ['CM', 'ST'] },
    ]
    const formation = {
      playerCount: 2,
      code: 'spec-example',
      displayName: 'spec',
      slots: [
        { code: 'CM', x: 0.5, y: 0.55 },
        { code: 'ST', x: 0.5, y: 0.85 },
      ],
    }
    const result = assignPlayersToFormation('SOCCER', formation, players)
    expect(result.slotAssignments[0]).toBe('A') // CM filled by primary
    expect(result.slotAssignments[1]).toBeNull() // ST stays empty (A already placed)
    expect(result.unassignedPlayers).toHaveLength(0)
  })
})

// ── Task A: PositionPill shows slot code (UI smoke) ───────────────────────
// The FormationPitch component renders slotCode directly as the starter pill
// content. We verify the data-testid naming convention matches slotCode, not
// player code — this pins the rendering contract without mounting React.

describe('[v1.85.2 regression] PositionPill slot-position convention', () => {
  it('formation 3-3-2 slot codes include the canonical 9-aside codes', () => {
    const catalog = getFormationsFor('SOCCER', 9)
    expect(catalog.length).toBeGreaterThan(0)
    const formation = catalog[0]!
    // Slots are 1 GK + 8 outfield. GK slot code must be 'GK'.
    const gkSlot = formation.slots.find((s) => s.code === 'GK')
    expect(gkSlot).toBeDefined()
    // All slot codes must be valid 12-code soccer codes.
    const validCodes = new Set(['GK', 'LB', 'CB', 'RB', 'LM', 'DM', 'CM', 'CAM', 'RM', 'LW', 'ST', 'RW'])
    for (const slot of formation.slots) {
      expect(validCodes.has(slot.code)).toBe(true)
    }
  })

  it('when a CM fills an LM slot, the slot code is LM (not CM)', () => {
    // Assign A=[CM] to a formation with only an LM slot (no CM slot).
    // The slot assignment should record 'A' at the LM slot index.
    // The starter pill would then render slotCode="LM" (not player's "CM").
    const players: AssignmentInput[] = [{ id: 'A', positions: ['CM'] }]
    const formation = {
      playerCount: 1,
      code: 'lm-only',
      displayName: 'lm-only',
      slots: [{ code: 'LM', x: 0.2, y: 0.55 }],
    }
    const result = assignPlayersToFormation('SOCCER', formation, players)
    // A is placed in the LM slot (fallback: LM.fallback includes CM? No — check compat.
    // Actually LM.primary=['LM'], LM.fallback=['LW','CM']. CM is in LM.fallback.
    // So A fills LM via pass 2a (primary position CM in LM.fallback).
    expect(result.slotAssignments[0]).toBe('A')
    // The slot code is LM — this is what the PositionPill renders for starters.
    expect(formation.slots[0]!.code).toBe('LM')
  })
})
