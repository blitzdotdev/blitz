import type {ProjectConfigSettings} from './runtime/projectFormat.ts'

export const emptyProjectSettings = {
    plugins: [
        {
            "import": "threepipe",
            "className": "SSAAPlugin"
        },
        {
            "import": "threepipe",
            "className": "AssetExporterPlugin"
        },
        {
            "import": "threepipe",
            "className": "TransformAnimationPlugin"
        },
        {
            "import": "threepipe",
            "className": "DepthBufferPlugin"
        },
        {
            "import": "threepipe",
            "className": "NormalBufferPlugin"
        },
        {
            "import": "threepipe",
            "className": "FullScreenPlugin"
        },
        {
            "import": "threepipe",
            "className": "ObjectConstraintsPlugin"
        },
        {
            "import": "threepipe",
            "className": "TransformControlsPlugin"
        },
        {
            "import": "threepipe",
            "className": "AssetExporterPlugin"
        },
        {
            "import": "threepipe",
            "className": "ClearcoatTintPlugin"
        },
        {
            "import": "threepipe",
            "className": "FragmentClippingExtensionPlugin"
        },
        {
            "import": "threepipe",
            "className": "NoiseBumpMaterialPlugin"
        },
        {
            "import": "threepipe",
            "className": "CustomBumpMapPlugin"
        },
        {
            "import": "threepipe",
            "className": "ParallaxMappingPlugin",
            "params": [
                false
            ]
        },
        {
            "import": "threepipe",
            "className": "GLTFKHRMaterialVariantsPlugin"
        },
        {
            "import": "threepipe",
            "className": "VirtualCamerasPlugin"
        },
        {
            "import": "threepipe",
            "className": "RenderTargetPreviewPlugin",
            "params": [
                false
            ]
        },
        {
            "import": "threepipe",
            "className": "HDRiGroundPlugin",
            "params": [
                false,
                true
            ]
        },
        {
            "import": "threepipe",
            "className": "VignettePlugin",
            "params": [
                false
            ]
        },
        {
            "import": "threepipe",
            "className": "ChromaticAberrationPlugin",
            "params": [
                false
            ]
        },
        {
            "import": "threepipe",
            "className": "FilmicGrainPlugin",
            "params": [
                false
            ]
        },
        {
            "import": "threepipe",
            "className": "SSAOPlugin",
            "params": [
                1009,
                1
            ]
        },
        {
            "import": "threepipe",
            "className": "ContactShadowGroundPlugin"
        },
        {
            "import": "threepipe",
            "className": "DeviceOrientationControlsPlugin"
        },
        {
            "import": "threepipe",
            "className": "PointerLockControlsPlugin"
        },
        {
            "import": "threepipe",
            "className": "ThreeFirstPersonControlsPlugin"
        },
        {
            "import": "threepipe",
            "className": "MeshOptSimplifyModifierPlugin",
            "params": [
                false
            ]
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "AnisotropyPlugin",
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "BloomPlugin",
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "SSReflectionPlugin",
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "TemporalAAPlugin",
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "VelocityBufferPlugin",
            params: [1009, false],
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "DepthOfFieldPlugin",
            params: [false],
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "SSContactShadowsPlugin",
            params: [false],
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "OutlinePlugin",
            params: [false],
        },
        {
            "import": "@threepipe/webgi-plugins",
            "className": "SSGIPlugin",
            params: [undefined, 1, false],
        },
        // GLTFDracoExportPlugin, GLTFSpecGlossinessConverterPlugin
        {
            "import": "@threepipe/plugin-gltf-transform",
            "className": "GLTFDracoExportPlugin",
        },
        {
            "import": "@threepipe/plugin-gltf-transform",
            "className": "GLTFSpecGlossinessConverterPlugin",
        },
        // MaterialConfiguratorPlugin, SwitchNodePlugin
        {
            "import": "@threepipe/plugin-configurator",
            "className": "MaterialConfiguratorPlugin",
        },
        {
            "import": "@threepipe/plugin-configurator",
            "className": "SwitchNodePlugin",
        },
        ...['B3DMLoadPlugin', 'CMPTLoadPlugin', 'DeepZoomImageLoadPlugin', 'EnvironmentControlsPlugin', 'GlobeControlsPlugin', 'I3DMLoadPlugin', 'PNTSLoadPlugin', 'TilesRendererPlugin'].map(className => ({
            import: '@threepipe/plugin-3d-tiles-renderer',
            className,
        })),
        {
            import: '@threepipe/plugin-assimpjs',
            className: 'AssimpJsPlugin',
            params: [false],
        },
        {
            import: '@threepipe/plugin-path-tracing',
            className: 'ThreeGpuPathTracerPlugin',
            params: [false],
        },
        {
            import: '@threepipe/plugin-blend-importer',
            className: 'BlendLoadPlugin',
        },
        {
            import: '@threepipe/plugin-network',
            className: 'TransfrSharePlugin',
        },
        {
            import: '@threepipe/plugin-troika-text',
            className: 'TroikaTextPlugin',
        },
        ...[
            'TDSLoadPlugin',
            'ThreeMFLoadPlugin',
            'ColladaLoadPlugin',
            'AMFLoadPlugin',
            'GCodeLoadPlugin',
            'BVHLoadPlugin',
            'VOXLoadPlugin',
            'MDDLoadPlugin',
            'PCDLoadPlugin',
            'TiltLoadPlugin',
            'VRMLLoadPlugin',
            'LDrawLoadPlugin',
            'VTKLoadPlugin',
            'XYZLoadPlugin',
        ].map(className => ({
            import: '@threepipe/plugins-extra-importers',
            className,
        })),
    ],
    dependencies: [{
        key: '@threepipe/webgi-plugins',
        version: '0.6.1',
    }, {
        key: '@threepipe/plugin-gltf-transform',
        version: 'latest',
    }, {
        key: '@threepipe/plugin-configurator',
        version: 'latest',
    }, {
        key: '@threepipe/plugin-3d-tiles-renderer',
        version: 'latest',
    }, {
        key: '@threepipe/plugin-assimpjs',
        version: 'latest',
    }, {
        key: '@threepipe/plugin-path-tracing',
        version: 'latest',
    }, {
        key: '@threepipe/plugin-blend-importer',
        version: 'latest',
    }, {
        key: '@threepipe/plugin-network',
        version: 'latest',
    }, {
        key: '@threepipe/plugin-troika-text',
        version: 'latest',
    }, {
        key: '@threepipe/plugins-extra-importers',
        version: 'latest',
    }],
    scripts: [],
    viewer: {},
} as ProjectConfigSettings
