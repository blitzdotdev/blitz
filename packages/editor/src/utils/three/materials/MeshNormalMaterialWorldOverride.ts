import {MeshNormalMaterialOverride, shaderReplaceString, WebGLProgramParametersWithUniforms} from "threepipe";

export class MeshNormalMaterialWorldOverride extends MeshNormalMaterialOverride {
    constructor(parameters: ConstructorParameters<typeof MeshNormalMaterialOverride>[0]) {
        super(parameters)
    }

    onBeforeCompile(shader: WebGLProgramParametersWithUniforms) {
        // Add a varying to pass world-space normal from vertex to fragment shader
        shader.vertexShader = shaderReplaceString(shader.vertexShader,
            '#include <common>',
            `\nvarying vec3 vWorldNormal;`, {append: true}
        )

        shader.vertexShader = shaderReplaceString(shader.vertexShader,
            '#include <beginnormal_vertex>',
            `\n// Transform normal to world space
vec4 worldNormal = modelMatrix * vec4(objectNormal, 0.0);
vWorldNormal = normalize(worldNormal.xyz);`, {append: true}
        )

        // Use world-space normal in fragment shader
        shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
            'uniform float opacity;',
            `\nvarying vec3 vWorldNormal;`, {append: true}
        )

        shader.fragmentShader = shaderReplaceString(shader.fragmentShader,
            'gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );',
            'gl_FragColor = vec4( packNormalToRGB( normalize( vWorldNormal ) ), diffuseColor.a );'
        )
    }
}
