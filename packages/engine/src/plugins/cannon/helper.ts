// https://github.com/pmndrs/cannon-es-debugger/blob/master/src/cannon-es-debugger.ts

import {
    Box,
    ConvexPolyhedron,
    Cylinder,
    Heightfield,
    Quaternion as CannonQuaternion,
    Shape,
    Sphere,
    Trimesh,
    Vec3 as CannonVector3,
} from 'cannon-es'
import {
    BoxGeometry,
    BufferGeometry,
    CylinderGeometry,
    Float32BufferAttribute,
    LineMaterial2,
    Mesh,
    PlaneGeometry,
    SphereGeometry,
    Vector3 as ThreeVector3,
    Wireframe,
    WireframeGeometry3
} from "threepipe";

type ComplexShape = Shape & {geometryId?: number}

export function cannonDebugger() {
    const scale = 1

    const _tempVec0 = new CannonVector3()
    const _tempVec1 = new CannonVector3()
    const _tempVec2 = new CannonVector3()
    const _tempQuat0 = new CannonQuaternion()
    const _sphereGeometry = new SphereGeometry(1)
    const _boxGeometry = new BoxGeometry(1, 1, 1)
    const _planeGeometry = new PlaneGeometry(10, 10, 10, 10)
    // const _material = new MeshBasicMaterial({color: color ?? 0x00ff00, wireframe: true})
    const _material = new LineMaterial2({
        color: 0x00ff00,
        linewidth: 3, // in world units with size attenuation, pixels otherwise
        vertexColors: false,
        worldUnits: false,

        dashed: false,
        alphaToCoverage: true,

        toneMapped: false,
        transparent: true,
        depthTest: true,
        depthWrite: false,

        allowOverride: false,
    })
    _material.userData.renderToGBuffer = false
    _material.userData.renderToDepth = false

// Move the planeGeometry forward a little bit to prevent z-fighting
    _planeGeometry.translate(0, 0, 0.0001)

    function createConvexPolyhedronGeometry(shape: ConvexPolyhedron): BufferGeometry {
        const geometry = new BufferGeometry()

        // Add vertices
        const positions = []
        for (let i = 0; i < shape.vertices.length; i++) {
            const vertex = shape.vertices[i]
            positions.push(vertex.x, vertex.y, vertex.z)
        }
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))

        // Add faces
        const indices = []
        for (let i = 0; i < shape.faces.length; i++) {
            const face = shape.faces[i]
            const a = face[0]
            for (let j = 1; j < face.length - 1; j++) {
                const b = face[j]
                const c = face[j + 1]
                indices.push(a, b, c)
            }
        }

        geometry.setIndex(indices)
        geometry.computeBoundingSphere()
        geometry.computeVertexNormals()
        return geometry
    }

    function createTrimeshGeometry(shape: Trimesh): BufferGeometry {
        const geometry = new BufferGeometry()
        const positions = []
        const v0 = _tempVec0
        const v1 = _tempVec1
        const v2 = _tempVec2

        for (let i = 0; i < shape.indices.length / 3; i++) {
            shape.getTriangleVertices(i, v0, v1, v2)
            positions.push(v0.x, v0.y, v0.z)
            positions.push(v1.x, v1.y, v1.z)
            positions.push(v2.x, v2.y, v2.z)
        }

        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
        geometry.computeBoundingSphere()
        geometry.computeVertexNormals()
        return geometry
    }

    function createHeightfieldGeometry(shape: Heightfield): BufferGeometry {
        const geometry = new BufferGeometry()
        const s = shape.elementSize || 1 // assumes square heightfield, else i*x, j*y
        const positions = shape.data.flatMap((row, i) => row.flatMap((z, j) => [i * s, j * s, z]))
        const indices = []

        for (let xi = 0; xi < shape.data.length - 1; xi++) {
            for (let yi = 0; yi < shape.data[xi].length - 1; yi++) {
                const stride = shape.data[xi].length
                const index = xi * stride + yi
                indices.push(index + 1, index + stride, index + stride + 1)
                indices.push(index + stride, index + 1, index)
            }
        }

        geometry.setIndex(indices)
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
        geometry.computeBoundingSphere()
        geometry.computeVertexNormals()
        return geometry
    }

    function createMesh(shape: Shape): Mesh {
        let mesh = new Mesh()
        const {SPHERE, BOX, PLANE, CYLINDER, CONVEXPOLYHEDRON, TRIMESH, HEIGHTFIELD} = Shape.types

        switch (shape.type) {
            case SPHERE: {
                mesh = new Wireframe(new WireframeGeometry3(_sphereGeometry), _material)
                break
            }
            case BOX: {
                mesh = new Wireframe(new WireframeGeometry3(_boxGeometry), _material)
                break
            }
            case PLANE: {
                mesh = new Wireframe(new WireframeGeometry3(_planeGeometry), _material)
                break
            }
            case CYLINDER: {
                const geometry = new CylinderGeometry(
                    (shape as Cylinder).radiusTop,
                    (shape as Cylinder).radiusBottom,
                    (shape as Cylinder).height,
                    (shape as Cylinder).numSegments
                )
                mesh = new Wireframe(new WireframeGeometry3(geometry), _material)
                ;(shape as ComplexShape).geometryId = geometry.id
                break
            }
            case CONVEXPOLYHEDRON: {
                const geometry = createConvexPolyhedronGeometry(shape as ConvexPolyhedron)
                mesh = new Wireframe(new WireframeGeometry3(geometry), _material)
                ;(shape as ComplexShape).geometryId = geometry.id
                break
            }
            case TRIMESH: {
                const geometry = createTrimeshGeometry(shape as Trimesh)
                mesh = new Wireframe(new WireframeGeometry3(geometry), _material)
                ;(shape as ComplexShape).geometryId = geometry.id
                break
            }
            case HEIGHTFIELD: {
                const geometry = createHeightfieldGeometry(shape as Heightfield)
                mesh = new Wireframe(new WireframeGeometry3(geometry), _material)
                ;(shape as ComplexShape).geometryId = geometry.id
                break
            }
        }
        return mesh
    }

    function scaleMesh(mesh: Mesh, shape: Shape | ComplexShape): void {
        const {SPHERE, BOX, PLANE, CYLINDER, CONVEXPOLYHEDRON, TRIMESH, HEIGHTFIELD} = Shape.types
        switch (shape.type) {
            case SPHERE: {
                const {radius} = shape as Sphere
                mesh.scale.set(radius * scale, radius * scale, radius * scale)
                break
            }
            case BOX: {
                mesh.scale.copy((shape as Box).halfExtents as unknown as ThreeVector3)
                mesh.scale.multiplyScalar(2 * scale)
                break
            }
            case PLANE: {
                break
            }
            case CYLINDER: {
                mesh.scale.set(1 * scale, 1 * scale, 1 * scale)
                break
            }
            case CONVEXPOLYHEDRON: {
                mesh.scale.set(1 * scale, 1 * scale, 1 * scale)
                break
            }
            case TRIMESH: {
                mesh.scale.copy((shape as Trimesh).scale as unknown as ThreeVector3).multiplyScalar(scale)
                break
            }
            case HEIGHTFIELD: {
                mesh.scale.set(1 * scale, 1 * scale, 1 * scale)
                break
            }
        }
    }

    function typeMatch(mesh: Mesh|undefined, shape: Shape | ComplexShape): boolean {
        if (!mesh) return false
        const {geometry} = mesh
        return (
            geometry instanceof SphereGeometry && shape.type === Shape.types.SPHERE ||
            geometry instanceof BoxGeometry && shape.type === Shape.types.BOX ||
            geometry instanceof PlaneGeometry && shape.type === Shape.types.PLANE ||
            // geometry.id === (shape as ComplexShape).geometryId && shape.type === Shape.types.BOX ||
            // geometry.id === (shape as ComplexShape).geometryId && shape.type === Shape.types.SPHERE ||
            // geometry.id === (shape as ComplexShape).geometryId && shape.type === Shape.types.PLANE ||
            geometry.id === (shape as ComplexShape).geometryId && shape.type === Shape.types.CONVEXPOLYHEDRON ||
            geometry.id === (shape as ComplexShape).geometryId && shape.type === Shape.types.TRIMESH ||
            geometry.id === (shape as ComplexShape).geometryId && shape.type === Shape.types.HEIGHTFIELD
        )
    }

    function updateMesh(mesh: Mesh|undefined, shape: Shape | ComplexShape) {
        if (!typeMatch(mesh, shape)) {
            mesh = createMesh(shape)
        }
        mesh && scaleMesh(mesh, shape)
        return mesh
    }


    return {
        createConvexPolyhedronGeometry,
        createTrimeshGeometry,
        createHeightfieldGeometry,
        createMesh,
        scaleMesh,
        typeMatch,
        updateMesh,
    }
}

export const CannonDebugger = cannonDebugger();
