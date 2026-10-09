import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('requestImagePixelBudget fix', () => {
  /**
   * Regression test for bug: "Image request maxPixels must be a positive integer"
   * 
   * When a profile is created programmatically without requestImagePixelBudget,
   * the adapter would pass undefined to the image request validator.
   * The fix adds a fallback to DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET at the call site.
   */
  it('compiled JS contains fallback for requestImagePixelBudget', () => {
    const code = readFileSync('/home/joe/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js', 'utf-8')
    expect(code).toContain('profile.requestImagePixelBudget ?? DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET')
  })

  it('compiled JS contains fallback for requestImageMaxBytes', () => {
    const code = readFileSync('/home/joe/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js', 'utf-8')
    expect(code).toContain('profile.requestImageMaxBytes ?? DEFAULT_REQUEST_IMAGE_MAX_BYTES')
  })

  it('DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET is defined as 2048 * 2048', () => {
    const code = readFileSync('/home/joe/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js', 'utf-8')
    expect(code).toContain('const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048')
  })

  it('DEFAULT_REQUEST_IMAGE_MAX_BYTES is defined as 1024 * 1024', () => {
    const code = readFileSync('/home/joe/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js', 'utf-8')
    expect(code).toContain('const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024')
  })
})
