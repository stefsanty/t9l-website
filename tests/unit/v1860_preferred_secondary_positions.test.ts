import { describe, it, expect } from 'vitest'
import { validatePreferredSecondary } from '@/lib/positions'
import { assignPlayersToFormation } from '@/lib/formations'
import type { AssignmentInput } from '@/lib/formations'

// ── validatePreferredSecondary ──────────────────────────────────────────────

describe('[v1.86.0] validatePreferredSecondary', () => {
  it('valid soccer codes return ok', () => {
    const r = validatePreferredSecondary(['GK'], ['CB'], 'SOCCER')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preferred).toEqual(['GK'])
    expect(r.secondary).toEqual(['CB'])
  })

  it('invalid code returns error', () => {
    const r = validatePreferredSecondary(['BADCODE'], [], 'SOCCER')
    expect(r.ok).toBe(false)
  })

  it('futsal codes accepted for FUTSAL league', () => {
    const r = validatePreferredSecondary(['GK'], ['ALA', 'PIVOT'], 'FUTSAL')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preferred).toEqual(['GK'])
    expect(r.secondary).toEqual(['ALA', 'PIVOT'])
  })

  it('soccer code rejected for FUTSAL league', () => {
    const r = validatePreferredSecondary(['CB'], [], 'FUTSAL')
    expect(r.ok).toBe(false)
  })

  it('codes in preferred are removed from secondary (dedup across sets)', () => {
    const r = validatePreferredSecondary(['CM', 'ST'], ['ST', 'LW'], 'SOCCER')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preferred).toEqual(['CM', 'ST'])
    // ST appears in preferred → stripped from secondary
    expect(r.secondary).toEqual(['LW'])
  })

  it('empty preferred + empty secondary is valid (no position recorded)', () => {
    const r = validatePreferredSecondary([], [], 'SOCCER')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preferred).toEqual([])
    expect(r.secondary).toEqual([])
  })

  it('null/undefined inputs treated as empty', () => {
    const r = validatePreferredSecondary(null, undefined, 'SOCCER')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preferred).toEqual([])
    expect(r.secondary).toEqual([])
  })

  it('dedupes within preferred', () => {
    const r = validatePreferredSecondary(['CM', 'CM'], [], 'SOCCER')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.preferred).toEqual(['CM'])
  })
})

// ── assignPlayersToFormation with preferred/secondary fields ────────────────

describe('[v1.86.0] assignPlayersToFormation — preferred/secondary AssignmentInput', () => {
  it('preferred fills slot.primary (pass 1a); unplaced player secondary fills via pass 1b', () => {
    // A: preferred=[GK]         → GK slot (pass 1a)
    // B: preferred=[DM]         → DM slot (pass 1a)
    // C: preferred=[CB], secondary=[LM] → no CB slot → not placed in 1a
    //    → pass 1b: C.secondary=[LM] matches LM slot → C→LM
    // CM slot stays empty (no players have CM preferred or secondary here)
    const formation = {
      playerCount: 4,
      code: 'test-pref-sec',
      displayName: 'test',
      slots: [
        { code: 'GK', x: 0.5, y: 0.06 },
        { code: 'DM', x: 0.5, y: 0.42 },
        { code: 'CM', x: 0.5, y: 0.55 },
        { code: 'LM', x: 0.2, y: 0.55 },
      ],
    }
    const players: AssignmentInput[] = [
      { id: 'A', positions: [], preferredPositions: ['GK'], secondaryPositions: [] },
      { id: 'B', positions: [], preferredPositions: ['DM'], secondaryPositions: [] },
      { id: 'C', positions: [], preferredPositions: ['CB'], secondaryPositions: ['LM'] },
    ]
    const result = assignPlayersToFormation('SOCCER', formation, players)
    expect(result.slotAssignments[0]).toBe('A') // GK→A preferred (1a)
    expect(result.slotAssignments[1]).toBe('B') // DM→B preferred (1a)
    expect(result.slotAssignments[2]).toBeNull() // CM: no preferred/secondary match
    expect(result.slotAssignments[3]).toBe('C') // LM→C secondary (1b)
    expect(result.unassignedPlayers).toHaveLength(0)
  })

  it('preferred=[] secondary=[GK] — no preferred but secondary fills slot (pass 1b)', () => {
    const formation = {
      playerCount: 1,
      code: 'sec-only',
      displayName: 'sec-only',
      slots: [{ code: 'GK', x: 0.5, y: 0.06 }],
    }
    const players: AssignmentInput[] = [
      { id: 'A', positions: [], preferredPositions: [], secondaryPositions: ['GK'] },
    ]
    const result = assignPlayersToFormation('SOCCER', formation, players)
    // A has no preferred but GK as secondary → should fill via 1b
    expect(result.slotAssignments[0]).toBe('A')
    expect(result.unassignedPlayers).toHaveLength(0)
  })

  it('preferred wins over secondary when both could fill same slot', () => {
    // A=[CM preferred], B=[LM preferred, CM secondary]
    // Formation has one CM slot. Pass 1a should give it to A (primary→primary).
    // B ends up unassigned (no LM slot).
    const formation = {
      playerCount: 1,
      code: 'cm-only',
      displayName: 'cm-only',
      slots: [{ code: 'CM', x: 0.5, y: 0.55 }],
    }
    const players: AssignmentInput[] = [
      { id: 'A', positions: [], preferredPositions: ['CM'], secondaryPositions: [] },
      { id: 'B', positions: [], preferredPositions: ['LM'], secondaryPositions: ['CM'] },
    ]
    const result = assignPlayersToFormation('SOCCER', formation, players)
    expect(result.slotAssignments[0]).toBe('A') // A's preferred wins
    expect(result.unassignedPlayers).toContain('B')
  })

  it('backward compat: positions[] without preferred/secondary uses index-split', () => {
    // Legacy shape: positions=['GK'] → preferred=['GK'], secondary=[]
    const formation = {
      playerCount: 1,
      code: 'legacy',
      displayName: 'legacy',
      slots: [{ code: 'GK', x: 0.5, y: 0.06 }],
    }
    const players: AssignmentInput[] = [
      { id: 'A', positions: ['GK'] }, // no preferredPositions — uses legacy path
    ]
    const result = assignPlayersToFormation('SOCCER', formation, players)
    expect(result.slotAssignments[0]).toBe('A')
  })

  it('player with empty preferred AND empty secondary goes to playersWithoutPositions', () => {
    const formation = {
      playerCount: 1,
      code: 'gk-only',
      displayName: 'gk-only',
      slots: [{ code: 'GK', x: 0.5, y: 0.06 }],
    }
    const players: AssignmentInput[] = [
      { id: 'A', positions: [], preferredPositions: [], secondaryPositions: [] },
    ]
    const result = assignPlayersToFormation('SOCCER', formation, players)
    expect(result.playersWithoutPositions).toContain('A')
    expect(result.slotAssignments[0]).toBeNull()
  })
})
