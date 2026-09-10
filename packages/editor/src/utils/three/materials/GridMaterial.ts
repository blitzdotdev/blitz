import {glsl, ShaderMaterial, Vector2, Vector4} from "threepipe";

export class GridMaterial extends ShaderMaterial {
    constructor() {
        super({
            uniforms: {
                vSize: {value: new Vector2(100, 100)},
                color: {value: new Vector4(1, 1, 1, 1)},
                gridSize: {value: 1},
            },
            vertexShader: glsl`
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPosition;
                }
            `,
            // todo try this - https://discussions.unity.com/t/how-to-make-an-infinite-grid-that-becomes-transparent-as-its-getting-away-from-the-camera/683283/7
            fragmentShader: glsl`
                uniform vec4 color;
                uniform float gridSize;
                uniform vec2 vSize;
                varying vec3 vWorldPosition;
                void main() {
                    vec2 gridPos = mod(vWorldPosition.xz, gridSize);
                    float lineThickness = gridSize * 0.1;

                    // Calculate if we are on a line
                    float isLineX = 1. - step(0.0, mod(gridPos.x, gridSize) - lineThickness) - step(gridSize - lineThickness, mod(gridPos.x, gridSize));
                    float isLineY = 1. - step(0.0, mod(gridPos.y, gridSize) - lineThickness) - step(gridSize - lineThickness, mod(gridPos.y, gridSize));
                    float isLine = max(isLineX, isLineY);

                    vec3 gridColor = mix(color.xyz, vec3(0.0), isLine);
                    gl_FragColor = vec4(gridColor, isLine);
                    #include <colorspace_fragment>

                }
            `,
        })
        this.transparent = true
    }
}
