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
    ITexture, UndoManagerPlugin
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

                let obj: IObject3D | undefined;

                switch (type.toLowerCase()) {
                    case 'box':
                    case 'cube':
                        obj = await generator.generate('box', {}) as IObject3D;
                        break;
                    case 'sphere':
                        obj = await generator.generate('sphere', {}) as IObject3D;
                        break;
                    case 'plane':
                        obj = await generator.generate('plane', {}) as IObject3D;
                        break;
                    case 'cylinder':
                        obj = await generator.generate('cylinder', {}) as IObject3D;
                        break;
                    case 'cone':
                        obj = await generator.generate('cone', {}) as IObject3D;
                        break;
                    case 'torus':
                        obj = await generator.generate('torus', {}) as IObject3D;
                        break;
                    case 'empty':
                    case 'group':
                        obj = await generator.generate('empty', {}) as IObject3D;
                        break;
                    default:
                        // Try to generate with the provided type
                        try {
                            obj = await generator.generate(type, {}) as IObject3D;
                        } catch {
                            return { error: `Unknown object type: ${type}` };
                        }
                }

                if (obj) {
                    if (name) obj.name = name;
                    if (position) {
                        obj.position.set(position.x, position.y, position.z);
                    }
                    scene.addObject(obj);
                    return { success: true, object: serializeObject(obj) };
                }
                return { error: 'Failed to create object' };
            }

            case 'deleteObject': {
                const scene = getScene();
                if (!scene) return { error: 'No scene loaded' };

                const identifier = params.identifier as string;
                const obj = findObject(identifier);
                if (!obj) return { error: `Object not found: ${identifier}` };

                const picking = getPicking();
                if (picking?.getSelectedObject() === obj) {
                    picking.setSelectedObject(undefined as any);
                }

                obj.removeFromParent();
                obj.dispose?.();

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

                const identifier = params.identifier as string;
                const newName = params.newName as string | undefined;

                const obj = findObject(identifier);
                if (!obj) return { error: `Object not found: ${identifier}` };

                const clone = obj.clone() as IObject3D;
                clone.name = newName || `${obj.name} (copy)`;

                // Add to same parent
                if (obj.parent) {
                    obj.parent.add(clone);
                } else {
                    scene.addObject(clone);
                }

                clone.setDirty?.();
                return { success: true, object: serializeObject(clone) };
            }

            case 'setObjectParent': {
                const scene = getScene();
                if (!scene) return { error: 'No scene loaded' };

                const identifier = params.identifier as string;
                const parentIdentifier = params.parentIdentifier as string | undefined;
                const keepWorldTransform = params.keepWorldTransform !== false; // Default true

                const obj = findObject(identifier);
                if (!obj) return { error: `Object not found: ${identifier}` };

                let newParent: IObject3D | null = null;
                if (parentIdentifier && parentIdentifier.trim() !== '') {
                    newParent = findObject(parentIdentifier) || null;
                    if (!newParent) return { error: `Parent not found: ${parentIdentifier}` };
                }

                if (keepWorldTransform) {
                    // Store world position/rotation/scale
                    obj.updateWorldMatrix(true, false);
                    const worldPos = obj.getWorldPosition(obj.position.clone());
                    const worldQuat = obj.getWorldQuaternion(obj.quaternion.clone());
                    const worldScale = obj.getWorldScale(obj.scale.clone());

                    // Reparent
                    obj.removeFromParent();
                    if (newParent) {
                        newParent.add(obj);
                    } else {
                        scene.modelRoot.add(obj);
                    }

                    // Restore world transform
                    obj.position.copy(worldPos);
                    obj.quaternion.copy(worldQuat);
                    obj.scale.copy(worldScale);

                    // Convert to local space of new parent
                    if (obj.parent) {
                        obj.parent.worldToLocal(obj.position);
                    }
                } else {
                    obj.removeFromParent();
                    if (newParent) {
                        newParent.add(obj);
                    } else {
                        scene.modelRoot.add(obj);
                    }
                }

                obj.setDirty?.();
                return { success: true, object: serializeObject(obj) };
            }

            case 'getObjectDetails': {
                const identifier = params.identifier as string;
                const includeChildren = params.includeChildren === true;

                const obj = findObject(identifier);
                if (!obj) return { error: `Object not found: ${identifier}` };

                const components = EntityComponentPlugin.ObjectToComponents.get(obj);
                const componentDetails = components ? Array.from(components).map(c => {
                    const props: Record<string, unknown> = {};
                    // Get uiconfig properties if available
                    const uiConfig = (c as any).uiConfig;
                    if (uiConfig && uiConfig.children) {
                        for (const child of uiConfig.children) {
                            if (child.property) {
                                props[child.property] = (c as any)[child.property];
                            }
                        }
                    }
                    return {
                        uuid: c.uuid,
                        name: (c as any).componentName || c.constructor.name,
                        type: c.constructor.name,
                        properties: props,
                    };
                }) : [];

                const result: Record<string, unknown> = {
                    uuid: obj.uuid,
                    name: obj.name,
                    type: obj.type,
                    visible: obj.visible,
                    position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                    rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
                    scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
                    parentName: obj.parent?.name || null,
                    parentUuid: obj.parent?.uuid || null,
                    components: componentDetails,
                    childCount: obj.children.length,
                };

                if (includeChildren) {
                    result.children = obj.children.map(child =>
                        serializeObject(child as IObject3D, true, 0, { skipBones: true })
                    ).filter((c): c is Record<string, unknown> => c !== null);
                }

                return result;
            }

            case 'findObjects': {
                const scene = getScene();
                if (!scene) return { error: 'No scene loaded' };

                const namePattern = params.namePattern as string | undefined;
                const typeFilter = params.type as string | undefined;
                const hasComponent = params.hasComponent as string | undefined;

                const results: Array<Record<string, unknown>> = [];

                // Convert wildcard pattern to regex
                let nameRegex: RegExp | null = null;
                if (namePattern) {
                    const pattern = namePattern.replace(/\*/g, '.*').replace(/\?/g, '.');
                    nameRegex = new RegExp(pattern, 'i');
                }

                scene.traverse((obj: IObject3D) => {
                    // Skip the scene itself and root containers
                    if (obj === scene || obj === scene.modelRoot) return;

                    // Name filter
                    if (nameRegex && !nameRegex.test(obj.name)) return;

                    // Type filter
                    if (typeFilter && obj.type !== typeFilter) return;

                    // Component filter
                    if (hasComponent) {
                        const components = EntityComponentPlugin.ObjectToComponents.get(obj);
                        if (!components) return;
                        const hasMatch = Array.from(components).some(
                            c => (c as any).componentName === hasComponent || c.constructor.name === hasComponent
                        );
                        if (!hasMatch) return;
                    }

                    results.push(serializeObject(obj, false, 0, { skipBones: false }) as Record<string, unknown>);
                });

                return { objects: results, count: results.length };
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
