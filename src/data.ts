import { zip, unzipSync, strToU8, strFromU8, type Zippable } from 'fflate';

import { defaultRecipe,type Project,type Source,type Template } from './types';

export const assets=new Map<string,{blob:Blob;url:string}>();

export function registerAsset(id:string,blob:Blob){const previous=assets.get(id);if(previous)URL.revokeObjectURL(previous.url);assets.set(id,{blob,url:URL.createObjectURL(blob)});void putAsset(id,blob);}

let database:Promise<IDBDatabase>|undefined;

function db(){return database??=new Promise((resolve,reject)=>{const r=indexedDB.open('facemix-studio-v1',2);r.onupgradeneeded=()=>{for(const name of ['projects','assets','library'])if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}

export async function readLibraryData<T>():Promise<T|undefined>{const database=await db();return new Promise((resolve,reject)=>{const r=database.transaction('library').objectStore('library').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}

export async function writeLibraryData(data:unknown){const database=await db();return new Promise<void>((resolve,reject)=>{const tx=database.transaction('library','readwrite');tx.objectStore('library').put(data,'current');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}

export async function ensureAsset(id:string){if(assets.has(id))return assets.get(id);const database=await db(),blob=await new Promise<Blob|undefined>(resolve=>{const r=database.transaction('assets').objectStore('assets').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(undefined);});if(blob){assets.set(id,{blob,url:URL.createObjectURL(blob)});return assets.get(id);}}

async function putAsset(id:string,blob:Blob){try{const database=await db();database.transaction('assets','readwrite').objectStore('assets').put(blob,id);}catch{ /* portable project export remains available */ }}

export async function autosave(project:Project){const database=await db();await new Promise<void>((resolve,reject)=>{const tx=database.transaction('projects','readwrite');tx.objectStore('projects').put(project,'current');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}

export async function restore():Promise<Project|undefined>{await removeRetiredAssets();const database=await db();const project=await new Promise<Project|undefined>((resolve,reject)=>{const r=database.transaction('projects').objectStore('projects').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});if(!project||project.schemaVersion!==1)return;project.recipe={...defaultRecipe(),...project.recipe};for(const v of project.variants)v.recipe={...defaultRecipe(),...v.recipe};for(const s of [...project.sources,...project.variants.flatMap(v=>v.sources)]){if(s.status==='preparing'){s.status='manual';s.note='Preparation stopped. Detect landmarks to continue.';}delete (s as unknown as Record<string,unknown>).faceMesh;if(s.originalAssetId)await ensureAsset(s.originalAssetId);if(assets.has(s.id))continue;const blob=await new Promise<Blob|undefined>(resolve=>{const r=database.transaction('assets').objectStore('assets').get(s.id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(undefined);});if(blob)assets.set(s.id,{blob,url:URL.createObjectURL(blob)});else{s.status='error';s.note='Original photo missing. Import this source again.';}}return project;}

/** Remove retired library items. Keep images used by the user's current project. */
export async function removeRetiredAssets(){
 if(typeof location==='undefined')return;
 const database=await db();
 const get=(store:string,key:IDBValidKey)=>new Promise<any>(resolve=>{const r=database.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(undefined);});
 if(await get('library','privacy-version')===5)return;
 const response=await fetch(new URL('library/privacy.json',new URL(import.meta.env.BASE_URL,location.href)));if(!response.ok)return;
 const policy=await response.json();if(!Array.isArray(policy.imageHashes))return;
 const originals=await new Promise<[IDBValidKey,Blob][]>((resolve,reject)=>{const items:[IDBValidKey,Blob][]=[];const r=database.transaction('assets').objectStore('assets').openCursor();r.onsuccess=()=>{const c=r.result;if(!c)return resolve(items);items.push([c.key,c.value]);c.continue();};r.onerror=()=>reject(r.error);});
 const ids=new Set<string>();for(const [id,blob] of originals){const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');if(policy.imageHashes.includes(digest))ids.add(String(id));}
 const project=await get('projects','current'),library=await get('library','current');
 const referenced=new Set<string>(project?[...project.sources,...project.variants.flatMap((v:Project['variants'][number])=>v.sources)].flatMap((s:Source)=>s.originalAssetId?[s.id,s.originalAssetId]:[s.id]):[]);
 if(library){library.entries=library.entries.filter((e:{id:string;source?:Source})=>!policy.retiredIds.includes(e.id)&&!ids.has(e.source?.id??''));library.collections=library.collections.filter((c:{id:string})=>!policy.retiredCollections.includes(c.id));}
 await new Promise<void>((resolve,reject)=>{const tx=database.transaction(['assets','library'],'readwrite');for(const id of ids){if(referenced.has(id))continue;tx.objectStore('assets').delete(id);const cached=assets.get(id);if(cached)URL.revokeObjectURL(cached.url);assets.delete(id);}if(library)tx.objectStore('library').put(library,'current');tx.objectStore('library').put(5,'privacy-version');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
}

export function download(blob:Blob,name:string){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),30000);}

function packSources(sources:Source[],files:Zippable,prefix:string){return sources.map(s=>{const copy={...s} as Record<string,unknown>;for(const layer of ['subjectMask','exclusionMask'] as const){const mask=s[layer];if(mask){const file=`${prefix}/${s.id}-${layer}.bin`;files[file]=[mask.data,{level:6}];copy[layer]={width:mask.width,height:mask.height,file};}}if(s.analysisMasks){copy.analysisMasks=Object.fromEntries(Object.entries(s.analysisMasks).map(([name,mask])=>{const file=`${prefix}/${s.id}-analysis-${name}.bin`;files[file]=[mask!.data,{level:6}];return [name,{width:mask!.width,height:mask!.height,file}];}));}return copy;});}

export async function projectArchive(project:Project):Promise<Blob>{

 const files:Zippable={};const sources=packSources(project.sources,files,'masks');const variants=project.variants.map(v=>({...v,sources:packSources(v.sources,files,`variants/${v.id}`)}));

 for(const id of new Set([...project.sources,...project.variants.flatMap(v=>v.sources)].flatMap(s=>s.originalAssetId?[s.id,s.originalAssetId]:[s.id]))){const asset=await ensureAsset(id);if(asset)files[`images/${id}`]=[new Uint8Array(await asset.blob.arrayBuffer()),{level:0}];}

 files['project.json']=strToU8(JSON.stringify({...project,sources,variants}));return new Promise((resolve,reject)=>zip(files,{level:6},(error,data)=>error?reject(error):resolve(new Blob([data as BlobPart],{type:'application/zip'}))));

}

export async function readArchive(file:File):Promise<Project>{

 if(file.size>1024*1024*1024)throw new Error('Project is too large for this browser (1 GB limit).');const files=unzipSync(new Uint8Array(await file.arrayBuffer()));if(!files['project.json'])throw new Error('This archive is missing project.json.');const data=JSON.parse(strFromU8(files['project.json']));if(data.schemaVersion!==1||!Array.isArray(data.sources)||data.sources.length>30)throw new Error('Unsupported project version or source count.');

 const hydrate=(sources:Record<string,unknown>[])=>sources.map(s=>{for(const key of ['subjectMask','exclusionMask']){const mask=s[key] as {width:number;height:number;file:string}|undefined;if(mask){const binary=files[mask.file];if(!binary||binary.length!==mask.width*mask.height)throw new Error('Invalid project mask.');s[key]={width:mask.width,height:mask.height,data:binary};}}if(s.analysisMasks){s.analysisMasks=Object.fromEntries(Object.entries(s.analysisMasks as Record<string,{width:number;height:number;file:string}>).map(([key,mask])=>{const binary=files[mask.file];if(!binary||binary.length!==mask.width*mask.height)throw new Error('Invalid analysis mask.');return [key,{width:mask.width,height:mask.height,data:binary}];}));}return s;});data.engineVersion=2;data.recipe={...defaultRecipe(),...data.recipe};data.sources=hydrate(data.sources);for(const variant of data.variants??[]) {variant.sources=hydrate(variant.sources);variant.recipe={...defaultRecipe(),...variant.recipe};}

 for(const s of [...data.sources,...data.variants.flatMap((v:{sources:Source[]})=>v.sources)]){if(s.originalAssetId&&!assets.has(s.originalAssetId)){const original=files[`images/${s.originalAssetId}`];if(!original)throw new Error(`Missing full photo: ${s.name}`);registerAsset(s.originalAssetId,new Blob([original as BlobPart]));}if(assets.has(s.id))continue;const bytes=files[`images/${s.id}`];if(!bytes)throw new Error(`Missing original image: ${s.name}`);registerAsset(s.id,new Blob([bytes as BlobPart]));}return data as Project;

}

export function landmarksCSV(project:Project){const rows=['source_id,source_name,point_id,point_name,x_normalized,y_normalized,enabled,locked'];for(const s of project.sources)for(const p of s.landmarks){const name=project.template.points.find(d=>d.id===p.id)?.name??p.id;rows.push([s.id,JSON.stringify(s.name),p.id,JSON.stringify(name),p.x,p.y,p.enabled,p.locked].join(','));}return new Blob([rows.join('\n')],{type:'text/csv'});}

export function templateJSON(project:Project){return new Blob([JSON.stringify({template:project.template,sources:project.sources.map(s=>({id:s.id,name:s.name,width:s.width,height:s.height,landmarks:s.landmarks}))},null,2)],{type:'application/json'});}

export async function readLandmarks(file:File,project:Project):Promise<Pick<Project,'template'|'sources'>>{

 const text=await file.text();if(file.name.toLowerCase().endsWith('.json')){const data=JSON.parse(text);if(!data.template?.points||!data.sources)throw new Error('Use a FaceMix landmark/template JSON export.');const template=data.template as Template;if(new Set(template.points.map(p=>p.id)).size!==template.points.length)throw new Error('Duplicate point IDs.');return {template,sources:project.sources.map((s,i)=>{const match=data.sources.find((v:Source)=>v.id===s.id||v.name===s.name)??data.sources[i];if(!match?.landmarks?.length)return s;const landmarks=match.landmarks.map((p:Source['landmarks'][number])=>{if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw new Error('Invalid landmark coordinates.');return {...p,authored:true};});return {...s,landmarks};})};}

 const lines=text.trim().split(/\r?\n/),rows=lines.slice(1).map(line=>line.match(/(?:"(?:[^"]|"")*"|[^,]*)(?:,|$)/g)?.map(c=>c.replace(/,$/,'').replace(/^"|"$/g,'').replace(/""/g,'"'))??[]);

 return {template:project.template,sources:project.sources.map(s=>({...s,landmarks:s.landmarks.map(p=>{const row=rows.find(r=>(r[0]===s.id||r[1]===s.name)&&r[2]===p.id);if(!row)return p;const x=Number(row[4]),y=Number(row[5]);if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Invalid CSV coordinates.');return {...p,x,y,enabled:row[6]!=='false',locked:row[7]==='true',authored:true};})}))};

}
