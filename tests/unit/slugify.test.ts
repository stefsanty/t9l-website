import { describe, it, expect } from 'vitest'
import { slugify } from '@/lib/data'

describe('slugify', () => {
  it('lowercases and replaces spaces with single dash', () => {
    expect(slugify('Mariners FC')).toBe('mariners-fc')
    expect(slugify('Hygge SC')).toBe('hygge-sc')
    expect(slugify('FC Torpedo')).toBe('fc-torpedo')
  })

  it('strips diacritics via NFD normalization', () => {
    expect(slugify('Pelé')).toBe('pele')
    expect(slugify('Núñez')).toBe('nunez')
  })

  it('removes non-alphanumeric characters except dashes', () => {
    expect(slugify('FC Torpedo!?')).toBe('fc-torpedo')
    expect(slugify("O'Brien")).toBe('obrien')
  })

  it('collapses internal whitespace into a single dash', () => {
    expect(slugify('Ian   Noseda')).toBe('ian-noseda')
  })

  it('matches CLAUDE.md documented examples', () => {
    expect(slugify('Ian Noseda')).toBe('ian-noseda')
    expect(slugify('Mariners FC')).toBe('mariners-fc')
  })
})
