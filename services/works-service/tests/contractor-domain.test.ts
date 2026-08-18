import { describe, it, expect } from 'vitest'
import { isValidRating, ratingBand, isEligibleForWork, RATING_MIN, RATING_MAX } from '../src/modules/contractor/domain.js'

describe('contractor domain — isValidRating', () => {
  it('accepts boundary values 1 and 5', () => {
    expect(isValidRating(1)).toBe(true)
    expect(isValidRating(5)).toBe(true)
  })
  it('accepts mid-range integers', () => {
    expect(isValidRating(3)).toBe(true)
  })
  it('rejects 0 and 6', () => {
    expect(isValidRating(0)).toBe(false)
    expect(isValidRating(6)).toBe(false)
  })
  it('rejects non-integers', () => {
    expect(isValidRating(3.5)).toBe(false)
    expect(isValidRating(NaN)).toBe(false)
  })
  it('RATING_MIN is 1 and RATING_MAX is 5', () => {
    expect(RATING_MIN).toBe(1)
    expect(RATING_MAX).toBe(5)
  })
})

describe('contractor domain — ratingBand', () => {
  it('maps 5 to excellent', () => expect(ratingBand(5)).toBe('excellent'))
  it('maps 4.5 to excellent', () => expect(ratingBand(4.5)).toBe('excellent'))
  it('maps 4 to good', () => expect(ratingBand(4)).toBe('good'))
  it('maps 3 to average', () => expect(ratingBand(3)).toBe('average'))
  it('maps 2 to below_average', () => expect(ratingBand(2)).toBe('below_average'))
  it('maps 1 to poor', () => expect(ratingBand(1)).toBe('poor'))
})

describe('contractor domain — isEligibleForWork', () => {
  it('null rating is eligible (unrated contractors can bid)', () => {
    expect(isEligibleForWork(null)).toBe(true)
  })
  it('rating >= minRating is eligible', () => {
    expect(isEligibleForWork(3, 2)).toBe(true)
    expect(isEligibleForWork(2, 2)).toBe(true)
  })
  it('rating < minRating is ineligible', () => {
    expect(isEligibleForWork(1, 2)).toBe(false)
  })
  it('default minRating is 2', () => {
    expect(isEligibleForWork(1)).toBe(false)
    expect(isEligibleForWork(2)).toBe(true)
  })
})
