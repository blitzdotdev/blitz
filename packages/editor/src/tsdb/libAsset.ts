import {queryCollectionOptions} from "@tanstack/query-db-collection";
import z from "zod";
import {createCollection} from "@tanstack/react-db";
import {queryClient} from "./client.ts";

export const libAssetSchema = z.object({
    id: z.string(),
    name: z.string(),
    fileUrl: z.url(),
    thumbnailUrl: z.url(),
    type: z.string(),
    // files: z.record(z.string(), z.any()).optional(),
})
export const libAssetInfoSchema = z.object({
    id: z.string(),
    // name: z.string(),
    fileUrl: z.url(),
    // thumbnailUrl: z.url(),
    type: z.string(),
    polyhavenFiles: z.record(z.string(), z.any()).optional(),
}).loose();

// Define a collection that loads data using TanStack Query

export async function fetchQueryFunc(queryUrl: string, {
    signal, queryKey,
}: {signal: AbortSignal, queryKey: string[]}) {
    const response = await fetch(queryUrl, {
        signal
    })
    if (!response.ok) {
        console.error(`Error fetching ${queryKey}:`, response.statusText, await response.text());
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const json = await response.json()
    return json
}

// const queryKey = 'libAssets'
// const queryUrl = 'http://localhost:8787/assets/v1/list'
const basePath = 'https://blitz-asset-library-proxy.blitzapp.workers.dev'
export const libAssetEndpoints = {
    list: {key: 'libAssets', url: `${basePath}/assets/v1/list`, schema: libAssetSchema},
    info: {key: 'libAssetInfo', url: `${basePath}/assets/v1/info/`, schema: libAssetInfoSchema},
}
export const libAssetCollection = createCollection(
    queryCollectionOptions({
        queryClient,
        schema: libAssetEndpoints.list.schema,
        queryKey: [libAssetEndpoints.list.key],
        queryFn: async ({queryKey, signal}) => {
            return (await fetchQueryFunc(libAssetEndpoints.list.url, {signal, queryKey})).assets;
        },
        getKey: (item) => item.id,
        // onUpdate: async ({ transaction }) => {
        //     const { original, modified } = transaction.mutations[0]
        //     await fetch(`/api/hdris/${original.id}`, {
        //         method: 'PUT',
        //         body: JSON.stringify(modified),
        //     })
        // },
        syncMode: 'on-demand', // ← Enable query-driven sync
    })
)
