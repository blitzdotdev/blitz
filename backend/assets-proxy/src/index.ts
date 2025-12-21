import {Context, Hono} from "hono";
import {cors} from "hono/cors";
import {AssetType, AssetTypeName, types} from "./types";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use('*', cors({
    origin: '*', // Allow all origins
    // allowMethods: ['GET', 'POST', 'PUT', 'DELETE'], // Allow specific methods
    // allowHeaders: ['Content-Type', 'Authorization'], // Allow specific headers
}));

app.get("/message", (c) => {
    return c.text("Hello Hono!");
});


// todo https://3dassets.one/about-site
// https://ambientcg.com/

const basePath = 'https://asset-cdn.threepipe.org'

const assets = {
    polyhaven: {
        assetInfo: (dat: any, key: string, type: string, c: Context)=> {
            const origin = (new URL(c.req.url)).origin;
            const re = {
                ...dat,
                name: dat.name || ('Unnamed ' + type),
                id: '@polyhaven/' + key,
                type: type,
                thumbnailUrl: dat.thumbnail_url || null,
                // fileUrl: type === 'hdri' ? 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/' + key + '_1k.hdr' :
                fileUrl: type === 'hdri' ? `${origin}/assets/v1/file/@polyhaven/${key}/hdri/1k/hdr/${key}_1k.hdr` :
                    type === 'material' ? `${origin}/assets/v1/file/@polyhaven/${key}/gltf/1k/gltf/${key}_1k.phmatgltf` :
                    type === 'model' ? `${origin}/assets/v1/file/@polyhaven/${key}/gltf/1k/gltf/${key}_1k.gltf` :
                        null
            } as AssetType
            return re;
        },
        list: async (type: string, c: Context) => {
            if(type === 'material') type = 'texture'
            const allowed = ['hdri', 'texture', 'model'];
            if (!allowed.includes(type)) {
                return []
            }
            // todo they dont have pagination?
            const url = `https://api.polyhaven.com/assets?type=${type + 's'}`;
            // const url = `/cache/polyhaven/${type}.json`;
            const res = await fetch(url);
            if (!res.ok) {
                console.error(`Polyhaven API error: ${await res.text()}`);
                throw new Error(`Failed to fetch asset list from Polyhaven: ${res.statusText}`);
            }
            const data = await res.json();
            const results = [];
            for (const [key, dat] of Object.entries(data as Record<string, any>)) {
                const re = assets.polyhaven.assetInfo(dat, key, type === 'texture' ? 'material' : type, c);
                results.push(re);
            }
            return results;
        },

        info: async (id: string, c: Context) => {
            const url = `https://api.polyhaven.com/info/${id}`;
            const res = await fetch(url);
            if (!res.ok) {
                console.error(`Polyhaven API error: ${await res.text()}`);
                throw new Error(`Failed to fetch asset info from Polyhaven: ${res.statusText}`);
            }
            const data = await res.json() as any;
            if(!data || typeof data.type !== 'number') throw new Error('Invalid asset data from Polyhaven');
            const type = ['hdri', 'texture', 'model'][data.type];
            if(!type) throw new Error('Unknown asset type from Polyhaven');
            const assetInfo = assets.polyhaven.assetInfo(data, id, type === 'texture' ? 'material' : type, c);

            const url2 = `https://api.polyhaven.com/files/${id}`; // to get download links
            const res2 = await fetch(url2);
            if (res2.ok) {
                const data2 = await res2.json() as any;
                assetInfo.polyhavenFiles = data2;
            }
            return assetInfo;
        },
        file: async (id: string)=>{

        }
    }
} as const

app.get("/assets/v1/list/:type?", async (c) => {
    const {type} = c.req.param();
    if (type && !types.includes(type as any)) {
        return c.json({error: "Invalid asset type"}, 400);
    }
    const sources = Object.keys(assets);
    const promises: Promise<AssetType[]>[] = [];
    for (const source of sources) {
        const assetSource = assets[source as keyof typeof assets];
        if(type) {
            promises.push(assetSource.list(type as AssetTypeName, c));
        }else {
            for (const t of types) {
                promises.push(assetSource.list(t, c));
            }
        }
    }
    const results = await Promise.allSettled(promises);
    const merged: AssetType[] = [];
    for (const res of results) {
        if (res.status === 'fulfilled') {
            merged.push(...res.value);
        } else {
            console.error('Error fetching assets:', res.reason);
        }
    }
    return c.json({assets: merged});
});

app.get("/assets/v1/info/:id{.*}", async (c) => {
    const {id} = c.req.param();

    if(typeof id !== 'string' || id.length === 0) {
        return c.json({error: "Invalid asset id"}, 400);
    }

    if(id.startsWith('@polyhaven/')) {
        const assetId = id.substring('@polyhaven/'.length);
        const info = await assets.polyhaven.info(assetId, c).catch(e=>null)
        return info ? c.json({asset: info}) : c.json({error: "Not found"}, 400);
    }

    return c.json({error: "Not found"}, 404);
});

// /assets/v1/file/@polyhaven/cobblestone_pavement/gltf/1k/gltf/cobblestone_pavement_1k.gltf
// /assets/v1/file/@polyhaven/cobblestone_pavement/gltf/1k/gltf/textures/cobblestone_pavement_nor_gl_1k.jpg

app.get("/assets/v1/file/:path{.*}", async (c) => {
    const {path} = c.req.param();
    const parts = path.split('/');
    if(parts.length < 2) {
        return c.json({error: "Invalid asset id"}, 400);
    }

    const id = parts[0] + '/' + parts[1];

    if(typeof id !== 'string' || id.length === 0) {
        return c.json({error: "Invalid asset id"}, 400);
    }

    if(id.startsWith('@polyhaven/')) {
        const assetId = id.substring('@polyhaven/'.length);
        const info = await assets.polyhaven.info(assetId, c).catch(e=>null)

        if(parts.length < 4) {
            return c.json({error: "Invalid file path"}, 400);
        }
        let next = 2
        const format = parts[next++];
        const size = parts[next++];
        let type = parts[next++]
        let filename = parts.slice(next).join('/');
        filename = filename.replace(/phmatgltf$/, 'gltf') // fix for polyhaven typo

        // const assetType = ['hdri', 'texture', 'model'][info.type] || null;

        if(!info ||
            !info.polyhavenFiles ||
            !info.polyhavenFiles[format] ||
            !info.polyhavenFiles[format][size] ||
            !info.polyhavenFiles[format][size][type]
        ) {
            return c.json({error: "Not found"}, 400);
        }

        const data = info.polyhavenFiles[format][size][type]

        let urlData: {
            url: string
            md5?: string
            size?: number
        } | null = null
        if(filename === `${assetId}_${size}.${type}`){
            urlData = data
        }else if(data.include && data.include[filename]){
            urlData = data.include[filename]
        }

        return urlData && urlData.url ?
            // todo cors, headers etc
            fetch(urlData.url) :
            c.json({error: "Not found"}, 400);
    }

    return c.json({error: "Not found"}, 404);
});

export default app;
