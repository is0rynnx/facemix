import {create} from 'zustand';

import {assets,ensureAsset,readLibraryData,registerAsset,writeLibraryData} from './data';

import {regionDefaults,type Source} from './types';

export interface LibraryEntry {addedAt?:number;lastUsed?:number;id:string;name:string;collections:string[];url?:string;thumbnail?:string;mask?:string;preparation?:string;source?:Source;provenance?:string;}

export interface LibraryData {version:1;catalogVersion?:number;removed?:string[];removedCollections?:string[];collections:{id:string;name:string;parent?:string}[];entries:LibraryEntry[];}

const empty=():LibraryData=>({version:1,collections:[],entries:[]});

export type LibrarySort='name'|'recent'|'added';
export interface LibraryClipboard {ids:string[];mode:'copy'|'cut';folder:string;}
export type LibraryDestination=string|{folderId:string};
interface LibraryState {clipboard?:LibraryClipboard;copy:(ids:string[],mode:'copy'|'cut',folder:string)=>void;paste:(folder:string)=>Promise<void>;markUsed:(ids:string[])=>Promise<void>;data:LibraryData;past:LibraryData[];loaded:boolean;error:string;load:()=>Promise<void>;change:(fn:(d:LibraryData)=>LibraryData,history?:boolean)=>Promise<void>;undo:()=>Promise<void>;saveSources:(sources:Source[],collection:LibraryDestination)=>Promise<void>;}

let loading:Promise<void>|undefined;

export const useLibrary=create<LibraryState>((set,get)=>({data:empty(),past:[],loaded:false,error:'',

 load:()=>loading??= (async()=>{let saved:LibraryData|undefined;try{saved=await readLibraryData<LibraryData>();const bundled=await(await fetch(new URL('library/catalog.json',new URL(import.meta.env.BASE_URL,location.href)))).json() as LibraryData;

 const privacy=await(await fetch(new URL('library/privacy.json',new URL(import.meta.env.BASE_URL,location.href)))).json();
 const clean=saved?{...saved,entries:saved.entries.filter(e=>!privacy.retiredIds?.includes(e.id)),collections:saved.collections.filter(c=>!privacy.retiredCollections?.includes(c.id))}:saved;
 const data=mergeCatalog(clean,bundled);await writeLibraryData(data);for(const entry of data.entries)if(entry.source&&!entry.url)await ensureAsset(entry.source.id);set({data,loaded:true});}catch(error){if(saved){for(const entry of saved.entries)if(entry.source&&!entry.url)await ensureAsset(entry.source.id);set({data:saved,loaded:true,error:'The bundled library is unavailable. Saved photos are available.'});}else set({loaded:true,error:String(error)});}})(),

 change:async (fn,history=true)=>{const previous=get().data,data=fn(previous);if(data===previous)return;const ids=new Set(data.entries.map(e=>e.id)),folders=new Set(data.collections.map(c=>c.id));data.removed=[...new Set([...(data.removed??[]),...previous.entries.filter(e=>!ids.has(e.id)).map(e=>e.id)])];data.removedCollections=[...new Set([...(data.removedCollections??[]),...previous.collections.filter(c=>!folders.has(c.id)).map(c=>c.id)])];set({data,error:'',past:history?[...get().past.slice(-19),previous]:get().past});try{await writeLibraryData(data);}catch{set({error:'Library storage is full. Save a project file.'});}},

 undo:async()=>{const data=get().past.at(-1);if(!data)return;set({data,past:get().past.slice(0,-1),error:''});await writeLibraryData(data);},

 copy:(ids,mode,folder)=>set({clipboard:{ids:[...new Set(ids)],mode,folder}}),
 paste:async folder=>{const clipboard=get().clipboard;if(!clipboard||!get().data.collections.some(c=>c.id===folder))return;await get().change(d=>pasteLibrary(d,clipboard,folder));if(clipboard.mode==='cut')set({clipboard:undefined});},
 markUsed:async ids=>{const now=Date.now();await get().change(d=>({...d,entries:d.entries.map(e=>ids.includes(e.id)?{...e,lastUsed:now}:e)}),false);},
 saveSources:async(sources,collection)=>{await get().load();await get().change(d=>{const exists=typeof collection==='string'?d.collections.find(c=>c.name===collection):d.collections.find(c=>c.id===collection.folderId);if(typeof collection!=='string'&&!exists)throw new Error('The import folder no longer exists.');const collectionId=exists?.id??crypto.randomUUID();const entries=d.entries.map(e=>({...e,collections:e.collections.slice()}));for(const source of sources){const existing=entries.find(e=>e.source?.id===source.id);if(existing){existing.collections=[...new Set([...existing.collections,collectionId])];existing.source=structuredClone(source);existing.name=source.name;}else entries.push({id:crypto.randomUUID(),addedAt:Date.now(),name:source.name,collections:[collectionId],source:structuredClone(source),provenance:source.provenance??'Your local photo'});}return {...d,collections:exists?d.collections:[...d.collections,{id:collectionId,name:collection as string}],entries};});}

}));

export function mergeCatalog(saved:LibraryData|undefined,bundled:LibraryData):LibraryData{

 if(!saved)return bundled;

 const old=new Map(saved.entries.map(e=>[e.id,e])),removed=new Set(saved.removed??[]),removedFolders=new Set(saved.removedCollections??[]),bundledIds=new Set(bundled.entries.map(e=>e.id));
 const updating=(saved.catalogVersion??0)<(bundled.catalogVersion??0);
 const collections=[...bundled.collections.map(c=>updating?c:saved.collections.find(v=>v.id===c.id)??c),...saved.collections.filter(c=>!bundled.collections.some(v=>v.id===c.id))].filter(c=>!removedFolders.has(c.id));
 const entries=[...bundled.entries.filter(e=>!removed.has(e.id)).map(e=>{const prior=old.get(e.id);return prior?{...prior,...e,name:updating?e.name:prior.name,collections:updating?[...new Set([...prior.collections,...e.collections])]:prior.collections}:e;}),...saved.entries.filter(e=>!bundledIds.has(e.id)&&!removed.has(e.id))].map(e=>({...e,collections:e.collections.filter(id=>collections.some(c=>c.id===id))}));
 return {...saved,catalogVersion:bundled.catalogVersion,collections,entries};

}

export function libraryThumbnail(entry:LibraryEntry):string|undefined{const path=entry.thumbnail??entry.url;if(path)return new URL(path,new URL(import.meta.env.BASE_URL,location.href)).href;return entry.source?assets.get(entry.source.id)?.url:undefined;}

export async function libraryPreparation(entry:LibraryEntry):Promise<Source|undefined>{if(!entry.preparation)return entry.source;const response=await fetch(new URL(entry.preparation,new URL(import.meta.env.BASE_URL,location.href)));if(!response.ok)throw new Error('Prepared landmarks could not be loaded.');return response.json();}

export async function libraryBlob(entry:LibraryEntry):Promise<Blob>{if(entry.source){const asset=assets.get(entry.source.id)??await ensureAsset(entry.source.id);if(asset)return asset.blob;}

 if(!entry.url)throw new Error('The original photo is unavailable.');const url=new URL(entry.url,new URL(import.meta.env.BASE_URL,location.href));const response=await fetch(url);if(!response.ok)throw new Error(`Photo could not be loaded (${response.status}).`);return response.blob();}

export async function addFilesToLibrary(files:File[],collection:LibraryDestination){const sources:Source[]=[];for(const file of files){try{const image=await createImageBitmap(file),id=crypto.randomUUID();registerAsset(id,file);sources.push({id,name:file.name.replace(/\.[^.]+$/,''),width:image.width,height:image.height,enabled:true,shapeWeight:1,appearanceWeight:1,weightLocked:false,regionWeights:regionDefaults(),landmarks:[],status:'preparing'});image.close();}catch{}}if(files.length&&!sources.length)throw new Error('No photos could be decoded.');await useLibrary.getState().saveSources(sources,collection);return sources.length;}


export function pasteLibrary(data:LibraryData,clipboard:LibraryClipboard,folder:string):LibraryData{
 if(!data.collections.some(c=>c.id===folder)||(clipboard.mode==='cut'&&clipboard.folder===folder))return data;
 const ids=new Set(clipboard.ids);let changed=false;const entries=data.entries.map(e=>{if(!ids.has(e.id))return e;const previous=clipboard.mode==='cut'?(clipboard.folder==='all'?[]:e.collections.filter(id=>id!==clipboard.folder)):e.collections,collections=[...new Set([...previous,folder])];if(collections.length===e.collections.length&&collections.every(c=>e.collections.includes(c)))return e;changed=true;return {...e,collections};});return changed?{...data,entries}:data;
}
const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
export function sortLibrary(entries:LibraryEntry[],sort:LibrarySort):LibraryEntry[]{return entries.slice().sort((a,b)=>(sort==='recent'?(b.lastUsed??0)-(a.lastUsed??0):sort==='added'?(b.addedAt??0)-(a.addedAt??0):0)||collator.compare(a.name,b.name)||a.id.localeCompare(b.id));}
export function removeLibraryFolder(data:LibraryData,id:string):LibraryData{const ids=new Set([id]);let prior=0;while(prior!==ids.size){prior=ids.size;for(const c of data.collections)if(c.parent&&ids.has(c.parent))ids.add(c.id);}return {...data,collections:data.collections.filter(c=>!ids.has(c.id)),entries:data.entries.map(e=>({...e,collections:e.collections.filter(c=>!ids.has(c))}))};}
