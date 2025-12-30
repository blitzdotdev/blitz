/**
 * MCP Bridge Handler for Kite 3D Editor
 *
 * This module provides handlers for MCP bridge requests,
 * integrating with the ViewerInstanceManager to interact with the editor.
 */

import { ViewerInstanceManager } from '../ViewerInstanceManager.ts';
import { MCPBridgeClient, RequestHandler } from './MCPBridgeClient.ts';
import {
    EntityComponentPlugin,
    PickingPlugin,
    IObject3D,
    Object3DGeneratorPlugin,
    IMaterial,
    ITexture,
    UndoManagerPlugin,
    iObjectCommons,
    Vector3,
    Quaternion
} from 'threepipe';

export interface MCPBridgeHandlerOptions {
    manager: ViewerInstanceManager;
    onChatMessage?: (message: string, type: 'info' | 'warning' | 'error' | 'success') => void;
}

/**
 * Create request handlers for MCP bridge actions
 */
export function createMCPBridgeHandler(options: MCPBridgeHandlerOptions): RequestHandler {
    const { manager, onChatMessage } = options;

    const getViewer = () => manager.get();
    const getScene = () => getViewer()?.scene;
    const getPicking = () => getViewer()?.getPlugin(PickingPlugin);
    const getEntityComponent = () => getViewer()?.getPlugin(EntityComponentPlugin);

    const findObject = (identifier: string): IObject3D | undefined => {
        const scene = getScene();
        if (!scene) return undefined;

        // Try to find by UUID first
        let found: IObject3D | undefined;
        scene.traverse((obj: IObject3D) => {
            if (obj.uuid === identifier || obj.name === identifier) {
                found = obj;
            }
        });
        return found;
    };

    const serializeObject = (
        obj: IObject3D,
        includeChildren = false,
        currentDepth = 0,
        options: { maxDepth?: number; skipBones?: boolean; skipTypes?: string[] } = {}
    ): Record<string, unknown> | null => {
        const { maxDepth, skipBones = true, skipTypes = [] } = options;

        // Skip bones by default
        if (skipBones && obj.type === 'Bone') return null;

        // Skip specified types
        if (skipTypes.includes(obj.type)) return null;

        const components = EntityComponentPlugin.ObjectToComponents.get(obj);
        const result: Record<string, unknown> = {
            uuid: obj.uuid,
            name: obj.name,
            type: obj.type,
            visible: obj.visible,
            position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
            rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
            scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
            components: components ? Array.from(components).map(c => ({
                uuid: c.uuid,
                name: (c as any).componentName || c.constructor.name,
                type: c.constructor.name,
            })) : [],
        };

        if (includeChildren) {
            // Check depth limit
            if (maxDepth !== undefined && currentDepth >= maxDepth) {
                result.childCount = obj.children.length;
                result.children = undefined;
            } else {
                const children = obj.children
                    .map(child => serializeObject(child as IObject3D, true, currentDepth + 1, options))
                    .filter((c): c is Record<string, unknown> => c !== null);
                result.children = children;
            }
        }

        return result;
    };

    return async (action, params) => {
        switch (action) {
            case 'getState':
            case 'getEditorState': {
                const viewer = getViewer();
                const picking = getPicking();
                const selected = picking?.getSelectedObject();
                const isObject = selected && 'isObject3D' in selected && selected.isObject3D;
                return {
                    hasViewer: !!viewer,
                    isRunning: manager.playMode?.isRunningMode ?? false,
                    selectedObject: isObject ? serializeObject(selected as IObject3D) : null,
                    projectPath: manager.loadedProject?.path || null,
                };
            }

            case 'getSceneHierarchy': {
                const scene = getScene();
                if (!scene) return { error: 'No scene loaded' };

                const filterOptions = {
                    maxDepth: params.maxDepth as number | undefined,
                    skipBones: params.skipBones !== false, // Default true
                    skipTypes: params.skipTypes as string[] | undefined,
                };

                const hierarchy = scene.modelRoot.children
                    .map(child => serializeObject(child as IObject3D, true, 0, filterOptions))
                    .filter((c): c is Record<string, unknown> => c !== null);

                return {
                    modelRoot: hierarchy,
                    mainCamera: scene.mainCamera ? {
                        uuid: scene.mainCamera.uuid,
                        name: scene.mainCamera.name,
                        type: scene.mainCamera.type,
                    } : null,
                };
            }

            case 'getSelectedObjects': {
                const picking = getPicking();
                const selected = picking?.getSelectedObject();
                const isObject = selected && 'isObject3D' in selected && selected.isObject3D;
                if (!isObject) return { selectedObjects: [] };
                return {
                    selectedObjects: [serializeObject(selected as IObject3D, true)],
                };
            }

            case 'selectObject': {
                const picking = getPicking();
                if (!picking) return { error: 'Picking not available' };

                const identifier = params.identifier as string;
                const obj = findObject(identifier);
                if (!obj) return { error: `Object not found: ${identifier}` };

                picking.setSelectedObject(obj);
                return { success: true, object: serializeObject(obj) };
            }

            case 'createObject': {
                const viewer = getViewer();
                const scene = getScene();
                if (!viewer || !scene) return { error: 'No scene loaded' };

                const generator = viewer.getPlugin(Object3DGeneratorPlugin);
                if (!generator) return { error: 'Object generator not available' };

                const type = params.type as string;
                const name = params.name as string | undefined;
                const position = params.position as { x: number; y: number; z: number } | undefined;
                const parentUuid = params.parentUuid as string | undefined;

                // Check if the generator supports this type directly
                if (!generator.generators[type]) {
                    return { error: `Unknown object type: ${type}. Available types: ${Object.keys(generator.generators).join(', ')}` };
                }

                // Log all incoming params for debugging
                console.log('[MCP createObject] ALL params received:', JSON.stringify(params));

                // Build geometry/object parameters from input
                const generatorParams: Record<string, unknown> = {};

                // Geometry parameters
                if (params.width !== undefined) generatorParams.width = params.width;
                if (params.height !== undefined) generatorParams.height = params.height;
                if (params.depth !== undefined) generatorParams.depth = params.depth;
                if (params.radius !== undefined) generatorParams.radius = params.radius;
                if (params.radiusTop !== undefined) generatorParams.radiusTop = params.radiusTop;
                if (params.radiusBottom !== undefined) generatorParams.radiusBottom = params.radiusBottom;
                if (params.tube !== undefined) generatorParams.tube = params.tube;
                if (params.radialSegments !== undefined) generatorParams.radialSegments = params.radialSegments;
                if (params.tubularSegments !== undefined) generatorParams.tubularSegments = params.tubularSegments;
                if (params.widthSegments !== undefined) generatorParams.widthSegments = params.widthSegments;
                if (params.heightSegments !== undefined) generatorParams.heightSegments = params.heightSegments;
                if (params.depthSegments !== undefined) generatorParams.depthSegments = params.depthSegments;
                if (params.openEnded !== undefined) generatorParams.openEnded = params.openEnded;

                // Light parameters
                if (params.color !== undefined) generatorParams.color = params.color;
                if (params.intensity !== undefined) generatorParams.intensity = params.intensity;

                // Camera parameters
                if (params.fov !== undefined) generatorParams.fov = params.fov;
                if (params.frustumSize !== undefined) generatorParams.frustumSize = params.frustumSize;

                console.log('[MCP createObject] type:', type, 'generatorParams:', JSON.stringify(generatorParams));

                const obj = generator.generate(type, generatorParams, false, false) as IObject3D | undefined;

                if (obj) {
                    // Log geometry info for debugging
                    if ((obj as any).geometry?.userData?.generationParams) {
                        console.log('[MCP createObject] geometry generationParams:', JSON.stringify((obj as any).geometry.userData.generationParams));
                    }

                    if (name) obj.name = name;
                    if (position) {
                        obj.position.set(position.x, position.y, position.z);
                    }

                    // Handle parenting
                    if (parentUuid) {
                        let parent: IObject3D | undefined;
                        scene.traverse((o: IObject3D) => {
                            if (o.uuid === parentUuid) parent = o;
                        });
                        if (parent) {
                            parent.add(obj);
                        } else {
                            scene.addObject(obj);
                        }
                    } else {
                        scene.addObject(obj);
                    }
                    return { success: true, object: serializeObject(obj) };
                }
                return { error: 'Failed to create object' };
            }

            case 'deleteObject': {
                const scene = getScene();
                if (!scene) return { error: 'No scene loaded' };

                const uuid = params.uuid as string;
                if (!uuid) return { error: 'UUID is required for delete operation' };

                // Find object by UUID only (not by name to avoid duplicates)
                let obj: IObject3D | undefined;
                scene.traverse((o: IObject3D) => {
                    if (o.uuid === uuid) obj = o;
                });
                if (!obj) return { error: `Object not found with UUID: ${uuid}` };

                const picking = getPicking();
                if (picking?.getSelectedObject() === obj) {
                    picking.setSelectedObject(undefined as any);
                }

                // Use iObjectCommons.deleteObject (skip confirmation with shiftKey: true)
                await iObjectCommons.deleteObject(obj, { shiftKey: true });

                return { success: true };
            }

            case 'modifyObject': {
                const identifier = params.identifier as string;
                const properties = params.properties as Record<string, unknown>;

                const obj = findObject(identifier);
                if (!obj) return { error: `Object not found: ${identifier}` };

                if (properties.position) {
                    const pos = properties.position as { x?: number; y?: number; z?: number };
                    if (pos.x !== undefined) obj.position.x = pos.x;
                    if (pos.y !== undefined) obj.position.y = pos.y;
                    if (pos.z !== undefined) obj.position.z = pos.z;
                }

                if (properties.rotation) {
                    const rot = properties.rotation as { x?: number; y?: number; z?: number };
                    if (rot.x !== undefined) obj.rotation.x = rot.x;
                    if (rot.y !== undefined) obj.rotation.y = rot.y;
                    if (rot.z !== undefined) obj.rotation.z = rot.z;
                }

                if (properties.scale) {
                    const scale = properties.scale as { x?: number; y?: number; z?: number };
                    if (scale.x !== undefined) obj.scale.x = scale.x;
                    if (scale.y !== undefined) obj.scale.y = scale.y;
                    if (scale.z !== undefined) obj.scale.z = scale.z;
                }

                if (properties.visible !== undefined) {
                    obj.visible = properties.visible as boolean;
                }

                if (properties.name !== undefined) {
                    obj.name = properties.name as string;
                }

                obj.setDirty?.();

                return { success: true, object: serializeObject(obj) };
            }

            case 'addComponent': {
                const ecp = getEntityComponent();
                if (!ecp) return { error: 'EntityComponentPlugin not available' };

                const objectIdentifier = params.objectIdentifier as string;
                const componentName = params.componentName as string;

                const obj = findObject(objectIdentifier);
                if (!obj) return { error: `Object not found: ${objectIdentifier}` };

                const result = await ecp.addComponent(obj, componentName);
                if (!result?.component) return { error: `Failed to add component: ${componentName}` };

                return {
                    success: true,
                    component: {
                        uuid: result.component.uuid,
                        name: (result.component as any).componentName || componentName,
                    },
                };
            }

            case 'removeComponent': {
                const ecp = getEntityComponent();
                if (!ecp) return { error: 'EntityComponentPlugin not available' };

                const objectIdentifier = params.objectIdentifier as string;
                const componentName = params.componentName as string;

                const obj = findObject(objectIdentifier);
                if (!obj) return { error: `Object not found: ${objectIdentifier}` };

                const components = EntityComponentPlugin.ObjectToComponents.get(obj);
                if (!components) return { error: 'No components on object' };

                const component = Array.from(components).find(
                    c => (c as any).componentName === componentName || c.uuid === componentName
                );
                if (!component) return { error: `Component not found: ${componentName}` };

                ecp.removeComponent(obj, component.uuid);
                return { success: true };
            }

            case 'getAvailableComponents': {
                const ecp = getEntityComponent();
                if (!ecp) return { error: 'EntityComponentPlugin not available' };

                // Get registered component types from the plugin
                const registeredTypes = ecp.componentTypes
                if (!registeredTypes) {
                    return { components: [] };
                }

                const keys = Array.from(registeredTypes.keys());
                return {
                    components: keys/*.map(name => ({
                        name,
                        // className: name,
                    }))*/,
                };
            }

            case 'getProjectFiles': {
                const project = manager.loadedProject;
                if (!project) return { error: 'No project loaded' };

                // Return project info - files would be listed by reading directory
                return {
                    projectPath: project.path,
                    hasProject: true,
                };
            }

            // case 'readFile': {
            //     const path = params.path as string;
            //     const project = manager.loadedProject;
            //     if (!project || !isPackageProject(project)) return { error: 'No project loaded' };
            //
            //     try {
            //         const file = await resolveFile(path, project.path, project.handle);
            //         if (!file || typeof file === 'string') return { error: `File not found: ${path}` };
            //
            //         const content = await file.text();
            //         return { path, content };
            //     } catch (error) {
            //         return { error: `Failed to read file: ${(error as Error).message}` };
            //     }
            // }
            //
            // case 'writeFile': {
            //     const path = params.path as string;
            //     const content = params.content as string;
            //     const project = manager.loadedProject;
            //     if (!project || !isPackageProject(project) || !project.handle) return { error: 'No project loaded' };
            //
            //     try {
            //         const file = new File([content], path.split('/').pop() || 'file.txt', { type: 'text/plain' });
            //         await manager.fsHelper.writeFile(project.handle, path, file, project.path);
            //         return { success: true, path };
            //     } catch (error) {
            //         return { error: `Failed to write file: ${(error as Error).message}` };
            //     }
            // }

            case 'executeCommand': {
                const command = params.command as string;
                const viewer = getViewer();

                switch (command) {
                    case 'undo':
                        viewer?.getPlugin<UndoManagerPlugin>('UndoManagerPlugin')?.undo?.();
                        return { success: true };
                    case 'redo':
                        viewer?.getPlugin<UndoManagerPlugin>('UndoManagerPlugin')?.redo?.();
                        return { success: true };
                    case 'save':
                        // Trigger save through the manager's save mechanism
                        // This would need proper integration with the save workflow
                        return { error: 'Save command not yet implemented via MCP' };
                    case 'play':
                        await manager.playMode?.startRunMode();
                        return { success: true };
                    case 'stop':
                        await manager.playMode?.stopRunMode();
                        return { success: true };
                    case 'refresh':
                        viewer?.setDirty();
                        return { success: true };
                    default:
                        return { error: `Unknown command: ${command}` };
                }
            }

            case 'getMaterials': {
                const viewer = getViewer();
                if (!viewer) return { error: 'No viewer available' };

                const materials: Array<Record<string, unknown>> = [];
                const materials1 = viewer.object3dManager.getMaterials();
                if (materials1) {
                    materials1.forEach((mat: IMaterial) => {
                        materials.push({
                            uuid: mat.uuid,
                            name: mat.name,
                            type: mat.type,
                        });
                    });
                }
                return { materials };
            }

            case 'getTextures': {
                const viewer = getViewer();
                if (!viewer) return { error: 'No viewer available' };

                const textures: Array<Record<string, unknown>> = [];
                const textures1 = viewer.object3dManager.getTextures();
                if (textures1) {
                    textures1.forEach((tex: ITexture) => {
                        textures.push({
                            uuid: tex.uuid,
                            name: tex.name,
                            type: tex.type,
                            width: tex.image?.width || null,
                            height: tex.image?.height || null,
                        });
                    });
                }
                return { textures };
            }

            case 'sendChatMessage': {
                const message = params.message as string;
                const type = (params.type as 'info' | 'warning' | 'error' | 'success') || 'info';

                if (onChatMessage) {
                    onChatMessage(message, type);
                }
                return { success: true };
            }

            case 'getProjectInfo': {
                const project = manager.loadedProject;
                return {
                    hasProject: !!project,
                    projectPath: project?.path || null,
                    isRunning: manager.playMode?.isRunningMode ?? false,
                    needsSave: manager.loadedNeedsSave,
                };
            }

            case 'duplicateObject': {
                const scene = getScene();
                if (!scene) return { error: 'No scene loaded' };

                const uuid = params.uuid as string;
                if (!uuid) return { error: 'UUID is required for duplicate operation' };

                // Find object by UUID only
                let obj: IObject3D | undefined;
                scene.traverse((o: IObject3D) => {
                    if (o.uuid === uuid) obj = o;
                });
                if (!obj) return { error: `Object not found with UUID: ${uuid}` };

                const originalUuid = obj.uuid;

                // Use iObjectCommons.duplicateObject
                const result = await iObjectCommons.duplicateObject(obj, { shiftKey: true }); // shiftKey: true to skip auto-select
                result.action();

                // Find the clone (it was added to the parent)
                const parent = obj.parent;
                const clone = parent?.children.find(c =>
                    c.uuid !== originalUuid && (c as IObject3D).userData?.cloneParent === originalUuid
                ) as IObject3D | undefined;

                if (clone) {
                    return { success: true, object: serializeObject(clone) };
                }
                return { success: true };
            }

            case 'focusObject': {
                const viewer = getViewer();
                const scene = getScene();
                if (!viewer || !scene) return { error: 'No scene loaded' };

                const uuid = params.uuid as string;

                let obj: IObject3D | undefined;
                if (uuid) {
                    scene.traverse((o: IObject3D) => {
                        if (o.uuid === uuid) obj = o;
                    });
                    if (!obj) return { error: `Object not found with UUID: ${uuid}` };
                } else {
                    // Focus on selected object or model root
                    const picking = getPicking();
                    const selected = picking?.getSelectedObject();
                    obj = (selected && 'isObject3D' in selected && selected.isObject3D)
                        ? selected as IObject3D
                        : scene.modelRoot;
                }

                const padding = (params.padding as number) ?? 1.5;
                const duration = (params.duration as number) ?? 500;

                viewer.fitToView(obj, padding, duration, 'linear');

                return { success: true, focusedObject: { uuid: obj.uuid, name: obj.name } };
            }

            case 'setObjectParent': {
                const scene = getScene();
                if (!scene) return { error: 'No scene loaded' };

                const identifier = params.identifier as string;
                const parentIdentifier = params.parentIdentifier as string | undefined;
                const keepWorldTransform = params.keepWorldTransform !== false; // Default true

                const obj = findObject(identifier);
                if (!obj) return { error: `Object not found: ${identifier}` };

                let newParent: IObject3D | undefined;
                if (parentIdentifier) {
                    newParent = findObject(parentIdentifier);
                    if (!newParent) return { error: `Parent not found: ${parentIdentifier}` };
                } else {
                    newParent = scene.modelRoot;
                }

                if (keepWorldTransform) {
                    // Store world position/rotation/scale
                    obj.updateWorldMatrix(true, false);
                    const worldPosition = obj.getWorldPosition(new Vector3());
                    const worldQuaternion = obj.getWorldQuaternion(new Quaternion());
                    const worldScale = obj.getWorldScale(new Vector3());

                    // Move to new parent
                    newParent.add(obj);

                    // Convert world transforms to local transforms in new parent
                    newParent.updateWorldMatrix(true, false);
                    const parentWorldMatrixInverse = newParent.matrixWorld.clone().invert();

                    worldPosition.applyMatrix4(parentWorldMatrixInverse);
                    obj.position.copy(worldPosition);

                    const parentQuaternion = newParent.getWorldQuaternion(new Quaternion());
                    parentQuaternion.invert();
                    obj.quaternion.copy(worldQuaternion.premultiply(parentQuaternion));

                    const parentScale = newParent.getWorldScale(new Vector3());
                    obj.scale.set(worldScale.x / parentScale.x, worldScale.y / parentScale.y, worldScale.z / parentScale.z);
                } else {
                    newParent.add(obj);
                }

                obj.setDirty?.();
                return { success: true, object: serializeObject(obj) };
            }

            case 'getObjectDetails': {
                const identifier = params.identifier as string;
                const includeChildren = params.includeChildren === true;

                const obj = findObject(identifier);
                if (!obj) return { error: `Object not found: ${identifier}` };

                return { object: serializeObject(obj, includeChildren) };
            }

            case 'findObjects': {
                const scene = getScene();
                if (!scene) return { error: 'No scene loaded' };

                const namePattern = params.namePattern as string | undefined;
                const type = params.type as string | undefined;
                const hasComponent = params.hasComponent as string | undefined;

                const results: Array<Record<string, unknown>> = [];

                scene.traverse((obj: IObject3D) => {
                    // Skip bones by default
                    if (obj.type === 'Bone') return;

                    let matches = true;

                    if (namePattern) {
                        const pattern = namePattern.replace(/\*/g, '.*');
                        const regex = new RegExp(pattern, 'i');
                        if (!regex.test(obj.name)) matches = false;
                    }

                    if (type && obj.type !== type) matches = false;

                    if (hasComponent) {
                        const components = EntityComponentPlugin.ObjectToComponents.get(obj);
                        const hasIt = components && Array.from(components).some(
                            c => (c as any).componentName === hasComponent || c.constructor.name === hasComponent
                        );
                        if (!hasIt) matches = false;
                    }

                    if (matches) {
                        results.push(serializeObject(obj, false) as Record<string, unknown>);
                    }
                });

                return { objects: results };
            }

            default:
                return { error: `Unknown action: ${action}` };
        }
    };
}

/**
 * Initialize and connect the MCP Bridge Client with the editor
 */
export function initMCPBridge(options: MCPBridgeHandlerOptions & { wsUrl?: string }): MCPBridgeClient {
    const client = new MCPBridgeClient({
        wsUrl: options.wsUrl,
        autoReconnect: true,
        onConnect: () => {
            console.log('[MCPBridge] Connected to bridge server');
        },
        onDisconnect: () => {
            console.log('[MCPBridge] Disconnected from bridge server');
        },
        onError: (error) => {
            console.error('[MCPBridge] Error:', error);
        },
    });

    const handler = createMCPBridgeHandler(options);
    client.setRequestHandler(handler);

    // Start the connection
    client.connect().catch((error) => {
        console.error('[MCPBridge] Initial connection failed:', error);
        // Auto-reconnect is enabled, so it will retry
    });

    return client;
}
