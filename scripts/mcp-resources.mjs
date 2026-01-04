
// ============================================
// MCP Resources Definition
// ============================================

export const mcpResources = [
    {
        uri: 'kite3d://scene/hierarchy',
        name: 'Scene Hierarchy',
        description: 'Current scene object hierarchy',
        mimeType: 'application/json'
    },
    {
        uri: 'kite3d://editor/state',
        name: 'Editor State',
        description: 'Current editor state including selection and mode',
        mimeType: 'application/json'
    },
    {
        uri: 'kite3d://project/info',
        name: 'Project Info',
        description: 'Information about the current project',
        mimeType: 'application/json'
    }
];
