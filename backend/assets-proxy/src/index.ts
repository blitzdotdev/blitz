import {Hono} from "hono";
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

const assets = {
    polyhaven: {
        assetInfo: (dat: any, key: string, type: string)=> {
            const re = {
                ...dat,
                name: dat.name || ('Unnamed ' + type),
                id: '@polyhaven/' + key,
                type: type,
                thumbnailUrl: dat.thumbnail_url || null,
                fileUrl: type === 'hdri' ? 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/' + key + '_1k.hdr' :
                    type === 'texture' ? null :
                    type === 'model' ? null : null
            } as AssetType
            return re;
        },
        list: async (type: string) => {
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
                const re = assets.polyhaven.assetInfo(dat, key, type === 'texture' ? 'material' : type);
                results.push(re);
            }
            return results;
        },
        
        info: async (id: string) => {
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
            const assetInfo = assets.polyhaven.assetInfo(data, id, type);

            const url2 = `https://api.polyhaven.com/files/${id}`; // to get download links
            const res2 = await fetch(url2);
            if (res2.ok) {
                const data2 = await res2.json() as any;
                if(data2.hdri){
                }
                assetInfo.files = data2;
            }
            return assetInfo;
        },
        file: async (id: string)=>{

        }
    }
} as Record<string, {
    list: (type: AssetTypeName) => Promise<AssetType[]>
    info: (id: string) => Promise<any>
    assetInfo: (dat: any, key: string, type: string) => AssetType
}>

app.get("/assets/v1/list/:type?", async (c) => {
    const {type} = c.req.param();
    if (type && !types.includes(type as any)) {
        return c.json({error: "Invalid asset type"}, 400);
    }
    const sources = Object.keys(assets);
    const promises: Promise<AssetType[]>[] = [];
    for (const source of sources) {
        const assetSource = assets[source];
        if(type) {
            promises.push(assetSource.list(type as AssetTypeName));
        }else {
            for (const t of types) {
                promises.push(assetSource.list(t));
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
        const info = await assets.polyhaven.info(assetId).catch(e=>null)
        return info ? c.json({asset: info}) : c.json({error: "Not found"}, 400);
    }

    return c.json({error: "Not found"}, 404);
});

export default app;
