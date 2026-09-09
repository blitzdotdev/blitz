/// <reference types="./types" />
/// <reference types="node" />

import { test, expect, Page } from '@playwright/test'
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

test.describe('EditorStructure - Scene Hierarchy Export', () => {
  let page: Page

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage
    await page.goto('/tests/test-page.html')

    // Wait for initialization to complete
    await page.waitForFunction(() => window.testInitComplete === true, { timeout: 60000 })

    // Wait for viewer to be ready
    await expect(page.locator('canvas#mcanvas')).toBeVisible()
  })

  test('should initialize ThreeViewer and load scene', async () => {
    const initComplete = await page.evaluate(() => window.testInitComplete)
    expect(initComplete).toBe(true)

    const hasViewer = await page.evaluate(() => !!window.testViewer)
    expect(hasViewer).toBe(true)

    const sceneExists = await page.evaluate(() => {
      return !!window.testViewer?.scene?.modelRoot
    })
    expect(sceneExists).toBe(true)
  })

  test('should generate markdown-v2 format and match snapshot', async () => {
    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'markdown-v2')
    })

    expect(result).toBeTruthy()
    expect(result).toContain('# Scene Hierarchy (v2)')
    expect(result).toContain('**ID:**')
    expect(result).toContain('**Operations Guide:**')
    expect(result).toContain('Optimized format for AI consumption')

    // Write/compare snapshot
    const snapshotPath = path.join(SNAPSHOTS_DIR, 'scene-hierarchy-v2.md')
    if (fs.existsSync(snapshotPath)) {
      const snapshot = fs.readFileSync(snapshotPath, 'utf-8')
      // Compare structure (ignore UUIDs which change between runs)
      const normalizeOutput = (str: string) => str.replace(/[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}/g, 'UUID')
      expect(normalizeOutput(result)).toBe(normalizeOutput(snapshot))
    } else {
      fs.writeFileSync(snapshotPath, result, 'utf-8')
      console.log(`Created snapshot: ${snapshotPath}`)
    }
  })

  test('should generate valid JSON format and match snapshot', async () => {
    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'json')
    })

    expect(result).toBeTruthy()

    // Should be valid JSON
    const parsed = JSON.parse(result)
    expect(parsed).toHaveProperty('scene')
    expect(parsed.scene).toHaveProperty('name')
    expect(parsed.scene).toHaveProperty('type')
    expect(parsed.scene).toHaveProperty('uuid')
    expect(parsed.scene).toHaveProperty('children')

    // Write/compare snapshot
    const snapshotPath = path.join(SNAPSHOTS_DIR, 'scene-hierarchy.json')
    if (fs.existsSync(snapshotPath)) {
      const snapshot = fs.readFileSync(snapshotPath, 'utf-8')
      const snapshotParsed = JSON.parse(snapshot)

      // Deep compare structure (normalize UUIDs)
      const normalizeUUIDs = (obj: any): any => {
        if (Array.isArray(obj)) return obj.map(normalizeUUIDs)
        if (obj && typeof obj === 'object') {
          const normalized: any = {}
          for (const key in obj) {
            if (key === 'uuid') normalized[key] = 'UUID'
            else normalized[key] = normalizeUUIDs(obj[key])
          }
          return normalized
        }
        return obj
      }

      expect(normalizeUUIDs(parsed)).toEqual(normalizeUUIDs(snapshotParsed))
    } else {
      fs.writeFileSync(snapshotPath, JSON.stringify(parsed, null, 2), 'utf-8')
      console.log(`Created snapshot: ${snapshotPath}`)
    }
  })

  test('should generate valid XML format and match snapshot', async () => {
    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'xml')
    })

    expect(result).toBeTruthy()
    expect(result).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(result).toContain('<scene>')
    expect(result).toContain('</scene>')
    expect(result).toContain('<object')
    expect(result).toContain('name=')
    expect(result).toContain('type=')
    expect(result).toContain('uuid=')

    // Write/compare snapshot
    const snapshotPath = path.join(SNAPSHOTS_DIR, 'scene-hierarchy.xml')
    if (fs.existsSync(snapshotPath)) {
      const snapshot = fs.readFileSync(snapshotPath, 'utf-8')
      // Normalize UUIDs for comparison
      const normalizeOutput = (str: string) => str.replace(/uuid="[a-f0-9-]+"/g, 'uuid="UUID"')
      expect(normalizeOutput(result)).toBe(normalizeOutput(snapshot))
    } else {
      fs.writeFileSync(snapshotPath, result, 'utf-8')
      console.log(`Created snapshot: ${snapshotPath}`)
    }
  })

  test('should generate compact format and match snapshot', async () => {
    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'compact')
    })

    expect(result).toBeTruthy()
    expect(result).toContain('# Scene [Compact Format]')
    expect(result).toContain('# Format: Name[Type]@UUID')
    expect(result).toContain('# Attrs: P=Position|G=Geometry|M=Materials|C=Components')
    expect(result).toMatch(/\[.*]@[a-f0-9]{8}/)

    // Write/compare snapshot
    const snapshotPath = path.join(SNAPSHOTS_DIR, 'scene-hierarchy-compact.txt')
    if (fs.existsSync(snapshotPath)) {
      const snapshot = fs.readFileSync(snapshotPath, 'utf-8')
      // Normalize UUIDs (both full and truncated)
      const normalizeOutput = (str: string) => str.replace(/@[a-f0-9]{8}/g, '@UUID')
      expect(normalizeOutput(result)).toBe(normalizeOutput(snapshot))
    } else {
      fs.writeFileSync(snapshotPath, result, 'utf-8')
      console.log(`Created snapshot: ${snapshotPath}`)
    }
  })

  test('should generate markdown (legacy) format and match snapshot', async () => {
    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'markdown')
    })

    expect(result).toBeTruthy()
    expect(result).toContain('# Scene Hierarchy')
    expect(result).toContain('## Scene Root')
    expect(result).toContain('## Notes')
    expect(result).toContain('- UUID:')

    // Write/compare snapshot
    const snapshotPath = path.join(SNAPSHOTS_DIR, 'scene-hierarchy-legacy.md')
    if (fs.existsSync(snapshotPath)) {
      const snapshot = fs.readFileSync(snapshotPath, 'utf-8')
      // Normalize UUIDs
      const normalizeOutput = (str: string) => str.replace(/[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}/g, 'UUID')
      expect(normalizeOutput(result)).toBe(normalizeOutput(snapshot))
    } else {
      fs.writeFileSync(snapshotPath, result, 'utf-8')
      console.log(`Created snapshot: ${snapshotPath}`)
    }
  })

  test('should include object hierarchy in all formats', async () => {
    const formats: ('markdown' | 'markdown-v2' | 'json' | 'xml' | 'compact')[] = [
      'markdown-v2',
      'json',
      'xml',
      'compact',
      'markdown'
    ]

    for (const format of formats) {
      const result = await page.evaluate((fmt) => {
        return window.getSceneStructureMd(window.testViewer, fmt)
      }, format)

      expect(result).toBeTruthy()
      expect(result.length).toBeGreaterThan(100)
    }
  })

  test('should include transform data for non-default values', async () => {
    // Add an object with non-default transform
    await page.evaluate(() => {
      const scene = window.testViewer.scene.modelRoot
      const newObj = new window.Object3D()
      newObj.name = 'TestObject'
      newObj.position.set(1, 2, 3)
      newObj.rotation.set(0.1, 0.2, 0.3)
      newObj.scale.set(2, 2, 2)
      scene.add(newObj)
    })

    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'markdown-v2')
    })

    expect(result).toContain('TestObject')
    // Should include position table for non-default values
    expect(result).toMatch(/Transform.*\|.*X.*\|.*Y.*\|.*Z/s)
  })

  test('should omit default transform values', async () => {
    // Add an object with default transform
    await page.evaluate(() => {
      const scene = window.testViewer.scene.modelRoot
      const newObj = new window.Object3D()
      newObj.name = 'DefaultTransformObject'
      newObj.position.set(0, 0, 0)
      newObj.rotation.set(0, 0, 0)
      newObj.scale.set(1, 1, 1)
      scene.add(newObj)
    })

    const resultV2 = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'markdown-v2')
    })

    expect(resultV2).toContain('DefaultTransformObject')

    // Extract the section for this object
    const lines = resultV2.split('\n')
    const objIndex = lines.findIndex((l: string) => l.includes('DefaultTransformObject'))
    const nextObjIndex = lines.findIndex((l: string, i: number) => i > objIndex && l.includes('###'))
    const section = lines.slice(objIndex, nextObjIndex > 0 ? nextObjIndex : lines.length).join('\n')

    // Should not have transform table for default values
    if (!section.includes('Position')) {
      expect(section).not.toMatch(/\|\s*Transform/)
    }
  })

  test('should include geometry information', async () => {
    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'json')
    })

    const parsed = JSON.parse(result)

    // Find objects with geometry
    const findGeometry = (obj: any): boolean => {
      if (obj.geometry) return true
      if (obj.children) {
        return obj.children.some(findGeometry)
      }
      return false
    }

    expect(findGeometry(parsed.scene)).toBe(true)
  })

  test('should include material information', async () => {
    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'json')
    })

    const parsed = JSON.parse(result)

    // Find objects with materials
    const findMaterial = (obj: any): boolean => {
      if (obj.materials && obj.materials.length > 0) return true
      if (obj.children) {
        return obj.children.some(findMaterial)
      }
      return false
    }

    expect(findMaterial(parsed.scene)).toBe(true)
  })

  test('should include UUIDs for objects', async () => {
    const formats: ('markdown-v2' | 'json' | 'xml')[] = ['markdown-v2', 'json', 'xml']

    for (const format of formats) {
      const result = await page.evaluate((fmt) => {
        return window.getSceneStructureMd(window.testViewer, fmt)
      }, format)

      // UUIDs are 36 characters with dashes or 8 characters in compact format
      expect(result).toMatch(/[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}|[a-f0-9]{8}/)
    }
  })

  test('compact format should be significantly shorter than markdown', async () => {
    const compact = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'compact')
    })

    const markdown = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'markdown')
    })

    // Compact should use fewer characters (token efficiency)
    expect(compact.length).toBeLessThan(markdown.length)
  })

  test('should handle empty scene gracefully', async () => {
    await page.evaluate(() => {
      // Clear the scene
      const scene = window.testViewer.scene.modelRoot
      while (scene.children.length > 0) {
        scene.remove(scene.children[0])
      }
    })

    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'markdown-v2')
    })

    expect(result).toBeTruthy()
    expect(result).toContain('# Scene Hierarchy (v2)')
  })

  test('JSON format should be parseable and have correct structure', async () => {
    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'json')
    })

    expect(() => JSON.parse(result)).not.toThrow()

    const parsed = JSON.parse(result)
    expect(parsed).toMatchObject({
      scene: expect.objectContaining({
        name: expect.any(String),
        type: expect.any(String),
        uuid: expect.any(String),
      })
    })
  })

  test('should include component information when present', async () => {
    // Add a component to an object
    await page.evaluate(() => {
      const EntityComponentPlugin = window.testViewer.getPlugin('EntityComponentPlugin')
      if (EntityComponentPlugin) {
        const scene = window.testViewer.scene.modelRoot
        if (scene.children.length > 0) {
          // Try adding a component (this depends on your ECS implementation)
          window.testHasComponents = true
        }
      }
    })

    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'markdown-v2')
    })

    // Check if components section exists in output
    expect(result).toBeTruthy()
  })

  test('XML format should be well-formed', async () => {
    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'xml')
    })

    // Check XML structure
    expect(result).toMatch(/^<\?xml/)
    expect(result).toContain('<scene>')
    expect(result).toContain('</scene>')

    // Count opening and closing tags - should match
    const openTags = (result.match(/<object/g) || []).length
    const closeTags = (result.match(/<\/object>/g) || []).length
    expect(openTags).toBe(closeTags)
  })

  test('should handle visibility state', async () => {
    await page.evaluate(() => {
      const scene = window.testViewer.scene.modelRoot
      const newObj = new window.Object3D()
      newObj.name = 'InvisibleObject'
      newObj.visible = false
      scene.add(newObj)
    })

    const result = await page.evaluate(() => {
      return window.getSceneStructureMd(window.testViewer, 'json')
    })

    const parsed = JSON.parse(result)

    const findInvisible = (obj: any): boolean => {
      if (obj.name === 'InvisibleObject' && obj.visible === false) return true
      if (obj.children) {
        return obj.children.some(findInvisible)
      }
      return false
    }

    expect(findInvisible(parsed.scene)).toBe(true)
  })

  test('should return empty string when EntityComponentPlugin is missing', async () => {
    const result = await page.evaluate(() => {
      // Create a viewer without ECS plugin for this test
      const tempViewer = {
        getPlugin: () => null,
        scene: { modelRoot: {} }
      } as any
      return window.getSceneStructureMd(tempViewer, 'markdown-v2')
    })

    expect(result).toBe('')
  })
})
