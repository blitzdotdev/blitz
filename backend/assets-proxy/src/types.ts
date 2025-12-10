
export const types = ['hdri', 'model', 'material'] as const;
export type AssetTypeName = (typeof types)[number];
export type AssetType = {
    id: `@polyhaven/${string}` | string;
    name: string;
    type: AssetTypeName;
    thumbnailUrl: string | null;
    fileUrl: string | null;

    [key: string]: any;
}
