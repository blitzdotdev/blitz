import {
    BufferGeometry,
    Camera,
    Group,
    IMaterial,
    Mesh,
    MeshBasicMaterial,
    PhysicalMaterial,
    Scene,
    shaderReplaceString,
    WebGLRenderer
} from "../../../../threepipe/lib";

export class MeshUVOverride extends MeshBasicMaterial {
    uvChannel: 0 | 1 | 2 | 3 = 0

    constructor(parameters?: any) {
        super(parameters)
        this.reset()
    }

    customProgramCacheKey() {
        // Return different cache key for each UV channel to force shader recompilation
        return `uv-channel-${this.uvChannel}`
    }

    onBeforeCompile(shader: any) {
        if (!shader.defines) shader.defines = {}
        shader.defines.USE_UV = ''
        shader.vertexUv1s = true
        shader.vertexUv2s = true
        shader.vertexUv3s = true

        // Add varying to pass UV coordinates from vertex to fragment shader
        shader.vertexShader = shaderReplaceString(shader.vertexShader,
            '#include <common>',
            `\n#ifdef USE_UV1
    varying vec2 vUv1;
#endif
#ifdef USE_UV2
    varying vec2 vUv2;
#endif
#ifdef USE_UV3
    varying vec2 vUv3;
#endif
            `, {append: true}
        )

        shader.vertexShader = shaderReplaceString(shader.vertexShader,
            '#include <uv_vertex>',
            `\n#ifdef USE_UV1
    vUv1 = (uv1);
#endif
#ifdef USE_UV2
    vUv2 = (uv2);
#endif
#ifdef USE_UV3
    vUv3 = (uv3);
#endif
`, {append: true}
        )

        // Modify fragment shader to display UV coordinates as colors
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
            'uniform float opacity;',
            `
#define vUv0 vUv
#ifdef USE_UV1
    varying vec2 vUv1;
#endif
#ifdef USE_UV2
    varying vec2 vUv2;
#endif
#ifdef USE_UV3
    varying vec2 vUv3;
#endif
            `, {append: true}
        )

        // Replace the final color output with UV visualization
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
            '#include <opaque_fragment>',
            `#ifdef USE_UV
    // Display UV coordinates as colors: U->Red, V->Green
    gl_FragColor = vec4( fract(vUv${this.uvChannel}.x), fract(vUv${this.uvChannel}.y), 0.0, diffuseColor.a );
#else
    // No UVs available, show magenta to indicate missing UVs
    gl_FragColor = vec4( 1.0, 0.0, 1.0, diffuseColor.a );
#endif`
        )
    }

    onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: any, group: Group) {
        super.onBeforeRender(renderer, scene, camera, geometry, object, group)

        if (!object.material || !(object as Mesh).isMesh) {
            this.visible = false
            return
        }
        this.visible = true
        const material = object.material as IMaterial & Partial<PhysicalMaterial>

        // Copy opacity and transparency
        if (material.opacity !== undefined) this.opacity = material.opacity
        if (material.transparent !== undefined) this.transparent = material.transparent

        // Copy maps for alpha testing
        if (material.alphaMap !== undefined) this.alphaMap = material.alphaMap
        if (material.alphaTest !== undefined) this.alphaTest = material.alphaTest < 1e-4 ? 1e-4 : material.alphaTest
        if (material.alphaHash !== undefined) this.alphaHash = material.alphaHash

        // Copy side and wireframe
        if (material.side !== undefined) this.side = material.side
        if (material.wireframe !== undefined) this.wireframe = material.wireframe
        if (material.wireframeLinewidth !== undefined) this.wireframeLinewidth = material.wireframeLinewidth

        // @ts-ignore todo add to type
        renderer.resetCurrentMaterial && renderer.resetCurrentMaterial()
    }

    onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, object: any, group: Group) {
        super.onAfterRender(renderer, scene, camera, geometry, object, group)
        this.reset()
    }

    reset() {
        this.visible = true
        this.color.setHex(0xffffff)
        this.opacity = 1
        this.transparent = false

        this.alphaMap = null
        this.alphaTest = 0

        this.side = 0 // FrontSide
        this.wireframe = false
        this.wireframeLinewidth = 1
    }
}
