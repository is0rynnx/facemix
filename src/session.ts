import type {Project,Vec} from './types';

export interface EditorSession{
 projectId:string;workspace:'mix'|'landmarks'|'masks'|'compare';inspector:'mix'|'regions'|'shape'|'landmarks'|'mask'|'finish';
 selectedSource:string;selectedPoints:string[];zoom:number;pan:Vec;showLabels:boolean;showLines:boolean;pointRegion:string;
 tool:'move'|'add'|'foreground'|'background'|'exclude'|'restore'|'polygon';brush:number;maskTarget:string;wipe:number;
 isolatedSource:string;inspectSource:string;compareVariant:string;
}
export interface SaveSnapshot{project:Project;editor:EditorSession}
export function isEditorSession(value:unknown):value is EditorSession{
 if(!value||typeof value!=='object')return false;const view=value as Partial<EditorSession>;
 return typeof view.projectId==='string'&&['mix','landmarks','masks','compare'].includes(view.workspace??'')&&['mix','regions','shape','landmarks','mask','finish'].includes(view.inspector??'')&&['move','add','foreground','background','exclude','restore','polygon'].includes(view.tool??'')&&Array.isArray(view.selectedPoints)&&view.selectedPoints.every(id=>typeof id==='string')&&Array.isArray(view.pan)&&view.pan.length===2&&view.pan.every(Number.isFinite)&&[view.zoom,view.brush,view.wipe].every(value=>typeof value==='number'&&Number.isFinite(value))&&[view.selectedSource,view.pointRegion,view.maskTarget,view.isolatedSource,view.inspectSource,view.compareVariant].every(value=>typeof value==='string')&&typeof view.showLabels==='boolean'&&typeof view.showLines==='boolean';
}
export type SaveStatus='saving'|'saved'|'error';
const writes=new Set<Promise<boolean>>();
export async function settledSaves():Promise<void>{while(writes.size)await Promise.all([...writes]);}

/** Start a requested commit immediately. Coalesce continuous edits. */
export function createSaveQueue(write:(snapshot:SaveSnapshot)=>Promise<void>,onStatus:(status:SaveStatus)=>void,delay=400){
 let pending:SaveSnapshot|undefined,timer:ReturnType<typeof setTimeout>|undefined,chain=Promise.resolve(true),revision=0,lastSnapshot:SaveSnapshot|undefined,lastEditor='',writtenProject:Project|undefined,failed=false;
 const flush=():Promise<boolean>=>{
  clearTimeout(timer);timer=undefined;if(!pending)return chain;
  const snapshot=pending,version=revision;pending=undefined;
  try{chain=write(snapshot).then(()=>{if(version===revision){writtenProject=snapshot.project;failed=false;onStatus('saved');}return true;},()=>{if(version===revision){failed=true;onStatus('error');}return false;});}
  catch{if(version===revision){failed=true;onStatus('error');}chain=Promise.resolve(false);}
  const current=chain;writes.add(current);void current.then(()=>writes.delete(current));
  return chain;
 };
 return {schedule(snapshot:SaveSnapshot){const editor=JSON.stringify(snapshot.editor);if(!failed&&lastSnapshot?.project===snapshot.project&&lastEditor===editor)return;lastSnapshot=snapshot;lastEditor=editor;pending=snapshot;revision++;onStatus('saving');clearTimeout(timer);timer=setTimeout(()=>void flush(),delay);},flush,hasUnsavedProject:()=>!!lastSnapshot&&lastSnapshot.project!==writtenProject};
}
