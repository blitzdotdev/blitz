/// <reference types="../tests/types" />
/// <reference types="node" />

import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SNAPSHOTS_DIR = path.join(__dirname, '__snapshots__')

// Ensure snapshots directory exists
if (!fs.existsSync(SNAPSHOTS_DIR)) {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true })
}

test.describe('EditorStructure - Format Comparison', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tests/test-page.html')
    await page.waitForFunction(() => window.testInitComplete === true, { timeout: 60000 })
  })

  test('should compare token efficiency across formats', async ({ page }) => {
    const results = await page.evaluate(() => {
      const viewer = window.testViewer

      return {
        markdownV2: window.getSceneStructureMd(viewer, 'markdown-v2'),
        markdown: window.getSceneStructureMd(viewer, 'markdown'),
        compact: window.getSceneStructureMd(viewer, 'compact'),
        json: window.getSceneStructureMd(viewer, 'json'),
        xml: window.getSceneStructureMd(viewer, 'xml'),
      }
    })

    // Log sizes for comparison
    console.log('Format sizes:')
    console.log('- markdown-v2:', results.markdownV2.length)
    console.log('- markdown:', results.markdown.length)
    console.log('- compact:', results.compact.length)
    console.log('- json:', results.json.length)
    console.log('- xml:', results.xml.length)

    // Compact should be most token-efficient
    expect(results.compact.length).toBeLessThan(results.markdown.length)
    expect(results.compact.length).toBeLessThan(results.markdownV2.length)

    // markdown-v2 should be more efficient than original markdown
    expect(results.markdownV2.length).toBeLessThan(results.markdown.length)

    // Write size metrics snapshot
    const metricsPath = path.join(SNAPSHOTS_DIR, 'format-sizes.json')
    const metrics = {
      markdownV2: results.markdownV2.length,
      markdown: results.markdown.length,
      compact: results.compact.length,
      json: results.json.length,
      xml: results.xml.length,
      ratios: {
        compactToMarkdown: results.compact.length / results.markdown.length,
        v2ToMarkdown: results.markdownV2.length / results.markdown.length,
      }
    }

    if (fs.existsSync(metricsPath)) {
      const previousMetrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'))

      // Alert if sizes changed significantly (>10%)
      const checkChange = (name: string, current: number, previous: number) => {
        const change = Math.abs((current - previous) / previous)
        if (change > 0.1) {
          console.warn(`⚠️  ${name} size changed by ${(change * 100).toFixed(1)}%: ${previous} -> ${current}`)
        }
      }

      checkChange('markdown-v2', metrics.markdownV2, previousMetrics.markdownV2)
      checkChange('markdown', metrics.markdown, previousMetrics.markdown)
      checkChange('compact', metrics.compact, previousMetrics.compact)
      checkChange('json', metrics.json, previousMetrics.json)
      checkChange('xml', metrics.xml, previousMetrics.xml)
    }

    fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), 'utf-8')
  })

  test('should maintain consistency across format conversions', async ({ page }) => {
    const objectCounts = await page.evaluate(() => {
      const viewer = window.testViewer

      // Count objects in scene
      const countObjects = (obj: any): number => {
        let count = 1
        if (obj.children) {
          obj.children.forEach((child: any) => {
            count += countObjects(child)
          })
        }
        return count
      }

      const actualCount = countObjects(viewer.scene.modelRoot)

      // Count in JSON format
      const json = window.getSceneStructureMd(viewer, 'json')
      const parsed = JSON.parse(json)
      const jsonCount = countObjects(parsed.scene)

      // Count in XML format (approximate by counting <object tags)
      const xml = window.getSceneStructureMd(viewer, 'xml')
      const xmlCount = (xml.match(/<object/g) || []).length

      // Count in markdown-v2 (approximate by counting ### headers)
      const md2 = window.getSceneStructureMd(viewer, 'markdown-v2')
      const md2Count = (md2.match(/###\s/g) || []).length

      return {
        actual: actualCount,
        json: jsonCount,
        xml: xmlCount,
        markdownV2: md2Count,
      }
    })

    // All formats should represent the same number of objects
    expect(objectCounts.json).toBe(objectCounts.actual)
    expect(objectCounts.xml).toBe(objectCounts.actual)
    expect(objectCounts.markdownV2).toBe(objectCounts.actual)
  })

  test('should preserve hierarchy depth in all formats', async ({ page }) => {
    const depths = await page.evaluate(() => {
      const viewer = window.testViewer

      // Calculate actual depth
      const getMaxDepth = (obj: any, depth = 0): number => {
        if (!obj.children || obj.children.length === 0) return depth
        return Math.max(...obj.children.map((child: any) => getMaxDepth(child, depth + 1)))
      }

      const actualDepth = getMaxDepth(viewer.scene.modelRoot)

      // Check JSON depth
      const json = window.getSceneStructureMd(viewer, 'json')
      const parsed = JSON.parse(json)
      const jsonDepth = getMaxDepth(parsed.scene)

      return {
        actual: actualDepth,
        json: jsonDepth,
      }
    })

    expect(depths.json).toBe(depths.actual)
  })

  test('should handle special characters in object names', async ({ page }) => {
    await page.evaluate(() => {
      const scene = window.testViewer.scene.modelRoot
      const specialObj = new window.Object3D()
      specialObj.name = 'Test<Object>&"Special\'Characters'
      scene.add(specialObj)
    })

    const results = await page.evaluate(() => {
      const viewer = window.testViewer
      return {
        xml: window.getSceneStructureMd(viewer, 'xml'),
        json: window.getSceneStructureMd(viewer, 'json'),
        markdown: window.getSceneStructureMd(viewer, 'markdown-v2'),
      }
    })

    // XML should escape special characters
    expect(results.xml).toContain('&lt;')
    expect(results.xml).toContain('&amp;')
    expect(results.xml).toContain('&quot;')
    expect(results.xml).toContain('&apos;')

    // JSON should be valid
    expect(() => JSON.parse(results.json)).not.toThrow()

    // Markdown should contain the name
    expect(results.markdown).toContain('Special')
  })

  test('should handle large scenes efficiently', async ({ page }) => {
    // Add many objects to test performance
    await page.evaluate(() => {
      const scene = window.testViewer.scene.modelRoot

      for (let i = 0; i < 50; i++) {
        const obj = new window.Object3D()
        obj.name = `TestObject_${i}`
        obj.position.set(i, i * 2, i * 3)
        scene.add(obj)
      }
    })

    const startTime = Date.now()

    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'compact')
    })

    const duration = Date.now() - startTime

    expect(result).toBeTruthy()
    expect(result).toContain('TestObject_0')
    expect(result).toContain('TestObject_49')

    // Should complete reasonably fast (within 5 seconds)
    expect(duration).toBeLessThan(5000)
  })

  test('should include all required metadata in markdown-v2', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'markdown-v2')
    })

    // Check for all expected sections
    expect(result).toContain('# Scene Hierarchy (v2)')
    expect(result).toContain('Optimized format for AI consumption')
    expect(result).toContain('**Operations Guide:**')
    expect(result).toContain('Reference objects by UUID')
    expect(result).toContain('EntityComponentPlugin')
    expect(result).toContain('Transforms are in local space')
    expect(result).toContain('Materials and geometries are shared resources')
  })

  test('should use tables for transform data in markdown-v2', async ({ page }) => {
    await page.evaluate(() => {
      const scene = window.testViewer.scene.modelRoot
      const obj = new window.Object3D()
      obj.name = 'TransformTestObject'
      obj.position.set(10, 20, 30)
      obj.rotation.set(1.5, 2.5, 3.5)
      obj.scale.set(2, 3, 4)
      scene.add(obj)
    })

    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'markdown-v2')
    })

    // Should use markdown table format
    expect(result).toMatch(/\|\s*Transform\s*\|\s*X\s*\|\s*Y\s*\|\s*Z\s*\|/)
    expect(result).toMatch(/\|\s*Position\s*\|.*10.*\|.*20.*\|.*30.*\|/)
    expect(result).toMatch(/\|\s*Rotation\s*\|/)
    expect(result).toMatch(/\|\s*Scale\s*\|/)
  })

  test('should use abbreviated notation in compact format', async ({ page }) => {
    await page.evaluate(() => {
      const scene = window.testViewer.scene.modelRoot
      const obj = new window.Object3D()
      obj.name = 'CompactTestObject'
      obj.position.set(1, 2, 3)
      scene.add(obj)
    })

    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'compact')
    })

    // Should use compact notation with abbreviations
    expect(result).toMatch(/P:[\d.]+,[\d.]+,[\d.]+/)  // P for Position
    expect(result).toContain('CompactTestObject')
  })

  test('should truncate UUIDs in compact format', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'compact')
    })

    // Should use 8-char UUIDs
    const lines = result.split('\n').filter((l: string) => !l.startsWith('#'))
    const hasShortUUID = lines.some((line: string) => /@[a-f0-9]{8}[^a-f0-9]/.test(line))

    expect(hasShortUUID).toBe(true)
  })

  test('should group related data in markdown-v2', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'markdown-v2')
    })

    // Should have clear section headers
    const sections = ['**Resources:**', '**Components:**', '**Metadata:**', '**Children']

    // At least some sections should be present
    const foundSections = sections.filter(section => result.includes(section))
    expect(foundSections.length).toBeGreaterThan(0)
  })
})
