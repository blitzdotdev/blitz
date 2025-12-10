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
})

// Define a collection that loads data using TanStack Query
export const libAssetCollection = createCollection(
    queryCollectionOptions({
        queryClient,
        schema: libAssetSchema,
        queryKey: ['libAssets'],
        queryFn: async ({signal}) => {
            const response = await fetch('http://localhost:8787/assets/v1/list', {
                signal
            })
            if(!response.ok){
                console.error('Error fetching HDRI list:', response.statusText, await response.text());
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const {assets} = await response.json()
            return assets
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
