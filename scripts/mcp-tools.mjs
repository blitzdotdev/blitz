
// ============================================
// MCP Tools Definition
// ============================================


export const mcpTools = [
    {
        name: 'getSceneHierarchy',
        description: 'Get the current scene hierarchy with all objects and their properties',
        inputSchema: {
            type: 'object',
            properties: {
                maxDepth: {
                    type: 'number',
                    description: 'Maximum depth to traverse (default: unlimited). Use 1-3 for overview.'
                },
                skipBones: {
                    type: 'boolean',
                    description: 'Skip Bone objects in the hierarchy (default: true). Set to false to include skeletal bones.'
                },
                skipTypes: {
                    type: 'array',
                    items: {type: 'string'},
                    description: 'Array of object types to skip (e.g., ["Bone", "SkinnedMesh"])'
                }
            },
            required: []
        }
    },
    {
        name: 'getSelectedObjects',
        description: 'Get information about currently selected objects in the editor',
        inputSchema: {type: 'object', properties: {}, required: []}
    },
    {
        name: 'selectObject',
        description: 'Select an object in the scene by name or UUID',
        inputSchema: {
            type: 'object',
            properties: {
                identifier: {type: 'string', description: 'The name or UUID of the object to select'}
            },
            required: ['identifier']
        }
    },
    {
        name: 'createObject',
        description: 'Create a new 3D object in the scene using the Object3DGeneratorPlugin',
        inputSchema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    description: 'The type of object to create',
                    enum: [
                        // Primitives/Geometry
                        'geometry-plane',
                        'geometry-sphere',
                        'geometry-box',
                        'geometry-circle',
                        'geometry-torus',
                        'geometry-cylinder',
                        'geometry-text',
                        'geometry-line',
                        // Objects
                        'object-empty',
                        'object-group',
                        // Cameras
                        'camera-perspective',
                        'camera-orthographic',
                        // Lights
                        'light-point',
                        'light-ambient',
                        'light-directional',
                        'light-spot',
                        'light-hemisphere',
                        'light-rect-area',
                        // Text
                        'troika-text-plane'
                    ]
                },
                name: {type: 'string', description: 'Optional name for the object'},
                position: {
                    type: 'object',
                    properties: {x: {type: 'number'}, y: {type: 'number'}, z: {type: 'number'}},
                    description: 'Initial position (default: {x: 0, y: 0, z: 0})'
                },
                parentUuid: {type: 'string', description: 'UUID of the parent object to attach to (optional)'},
                // Geometry parameters for primitives
                width: {type: 'number', description: 'Width for box/plane (default: 1)'},
                height: {type: 'number', description: 'Height for box/plane/cylinder (default: 1)'},
                depth: {type: 'number', description: 'Depth for box (default: 1)'},
                radius: {type: 'number', description: 'Radius for sphere/circle/torus (default: 1)'},
                radiusTop: {type: 'number', description: 'Top radius for cylinder (default: 1)'},
                radiusBottom: {type: 'number', description: 'Bottom radius for cylinder (default: 1)'},
                tube: {type: 'number', description: 'Tube radius for torus (default: 0.4)'},
                radialSegments: {type: 'number', description: 'Radial segments for cylinder/torus (default: 32)'},
                tubularSegments: {type: 'number', description: 'Tubular segments for torus (default: 48)'},
                widthSegments: {type: 'number', description: 'Width segments for box/plane/sphere (default: 1-32)'},
                heightSegments: {
                    type: 'number',
                    description: 'Height segments for box/plane/sphere/cylinder (default: 1-16)'
                },
                depthSegments: {type: 'number', description: 'Depth segments for box (default: 1)'},
                openEnded: {type: 'boolean', description: 'Open ended cylinder (default: false)'},
                // Light parameters
                color: {type: 'number', description: 'Color for lights as hex number (e.g., 0xffffff)'},
                intensity: {type: 'number', description: 'Intensity for lights (default: 1-3)'},
                // Camera parameters
                fov: {type: 'number', description: 'Field of view for perspective camera (default: 50)'},
                frustumSize: {type: 'number', description: 'Frustum size for orthographic camera'}
            },
            required: ['type']
        }
    },
    {
        name: 'deleteObject',
        description: 'Delete an object from the scene by UUID',
        inputSchema: {
            type: 'object',
            properties: {
                uuid: {
                    type: 'string',
                    description: 'The UUID of the object to delete (required, name not accepted to avoid duplicates)'
                }
            },
            required: ['uuid']
        }
    },
    {
        name: 'modifyObject',
        description: 'Modify properties of an object (position, rotation, scale, etc.)',
        inputSchema: {
            type: 'object',
            properties: {
                identifier: {type: 'string', description: 'The name or UUID of the object to modify'},
                properties: {
                    type: 'object',
                    description: 'Object containing properties to modify',
                    properties: {
                        position: {
                            type: 'object',
                            properties: {x: {type: 'number'}, y: {type: 'number'}, z: {type: 'number'}}
                        },
                        rotation: {
                            type: 'object',
                            properties: {x: {type: 'number'}, y: {type: 'number'}, z: {type: 'number'}}
                        },
                        scale: {
                            type: 'object',
                            properties: {x: {type: 'number'}, y: {type: 'number'}, z: {type: 'number'}}
                        },
                        visible: {type: 'boolean'},
                        name: {type: 'string'}
                    }
                }
            },
            required: ['identifier', 'properties']
        }
    },
    {
        name: 'duplicateObject',
        description: 'Duplicate an object in the scene',
        inputSchema: {
            type: 'object',
            properties: {
                uuid: {
                    type: 'string',
                    description: 'The UUID of the object to duplicate (required, name not accepted to avoid duplicates)'
                }
            },
            required: ['uuid']
        }
    },
    {
        name: 'setObjectParent',
        description: 'Set the parent of an object (reparenting)',
        inputSchema: {
            type: 'object',
            properties: {
                identifier: {type: 'string', description: 'The name or UUID of the object to reparent'},
                parentIdentifier: {
                    type: 'string',
                    description: 'The name or UUID of the new parent (use null or empty string for scene root)'
                },
                keepWorldTransform: {
                    type: 'boolean',
                    description: 'Keep the world position/rotation/scale (default: true)'
                }
            },
            required: ['identifier']
        }
    },
    {
        name: 'getObjectDetails',
        description: 'Get detailed information about a specific object including all component properties',
        inputSchema: {
            type: 'object',
            properties: {
                identifier: {type: 'string', description: 'The name or UUID of the object'},
                includeChildren: {type: 'boolean', description: 'Include children hierarchy (default: false)'}
            },
            required: ['identifier']
        }
    },
    {
        name: 'findObjects',
        description: 'Search for objects in the scene by name pattern or type',
        inputSchema: {
            type: 'object',
            properties: {
                namePattern: {
                    type: 'string',
                    description: 'Name pattern to search for (case-insensitive, supports * wildcard)'
                },
                type: {type: 'string', description: 'Object type to filter by (e.g., "Mesh", "Light", "Camera")'},
                hasComponent: {type: 'string', description: 'Filter objects that have a specific component'}
            },
            required: []
        }
    },
    {
        name: 'addComponent',
        description: 'Add a component/script to an object',
        inputSchema: {
            type: 'object',
            properties: {
                objectIdentifier: {type: 'string', description: 'The name or UUID of the object'},
                componentName: {type: 'string', description: 'The name of the component to add'},
                properties: {type: 'object', description: 'Initial properties for the component'}
            },
            required: ['objectIdentifier', 'componentName']
        }
    },
    {
        name: 'removeComponent',
        description: 'Remove a component from an object',
        inputSchema: {
            type: 'object',
            properties: {
                objectIdentifier: {type: 'string', description: 'The name or UUID of the object'},
                componentName: {type: 'string', description: 'The name of the component to remove'}
            },
            required: ['objectIdentifier', 'componentName']
        }
    },
    {
        name: 'getAvailableComponents',
        description: 'Get a list of available components/scripts that can be added to objects',
        inputSchema: {type: 'object', properties: {}, required: []}
    },
    {
        name: 'getProjectFiles',
        description: 'Get a list of files in the current project',
        inputSchema: {
            type: 'object',
            properties: {
                path: {type: 'string', description: 'Optional subdirectory path to list'}
            },
            required: []
        }
    },
    {
        name: 'executeCommand',
        description: 'Execute an editor command (undo, redo, save, play, stop, etc.)',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'The command to execute',
                    enum: ['undo', 'redo', 'save', 'play', 'stop', 'pause', 'refresh']
                }
            },
            required: ['command']
        }
    },
    {
        name: 'getMaterials',
        description: 'Get a list of materials in the scene',
        inputSchema: {type: 'object', properties: {}, required: []}
    },
    {
        name: 'getTextures',
        description: 'Get a list of textures in the scene',
        inputSchema: {type: 'object', properties: {}, required: []}
    },
    {
        name: 'sendChatMessage',
        description: 'Send a message to be displayed in the editor chat/log',
        inputSchema: {
            type: 'object',
            properties: {
                message: {type: 'string', description: 'The message to display'},
                type: {
                    type: 'string',
                    description: 'Message type: info, warning, error, success',
                    enum: ['info', 'warning', 'error', 'success']
                }
            },
            required: ['message']
        }
    },
    {
        name: 'getEditorState',
        description: 'Get the current editor state including selection and mode',
        inputSchema: {type: 'object', properties: {}, required: []}
    },
    {
        name: 'getProjectInfo',
        description: 'Get information about the current project',
        inputSchema: {type: 'object', properties: {}, required: []}
    },
    {
        name: 'focusObject',
        description: 'Focus the camera on an object (fit to view)',
        inputSchema: {
            type: 'object',
            properties: {
                uuid: {
                    type: 'string',
                    description: 'The UUID of the object to focus on. If not provided, focuses on selected object or model root.'
                },
                padding: {type: 'number', description: 'Padding multiplier for the view fit (default: 1.5)'},
                duration: {type: 'number', description: 'Animation duration in milliseconds (default: 500)'}
            },
            required: []
        }
    }
];
