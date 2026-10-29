import {assets} from './data';
import type {RenderOutput,RenderSpec} from './types';

type Request={job:number;spec:RenderSpec};
type WorkerFactory=(retry:boolean)=>Worker;
const createWorker:WorkerFactory=retry=>{
 const url=new URL('workers/render.worker.js',new URL(import.meta.env.BASE_URL,location.href));
 if(retry)url.searchParams.set('retry',String(Date.now()));
 return new Worker(url);
};

/** Restore the current render after a worker failure. Photo data stays in the
 * main asset store, and is registered again in the replacement worker. */
export class RenderManager{
 worker?:Worker;job=0;registered=new Map<string,Blob>();
 onResult?:(result:RenderOutput)=>void;
 onError?:(message:string,diagnostics:RenderOutput['diagnostics'])=>void;
 private latest?:Request;
 private disposed=false;
 private recovered=false;
 private cpu=false;
 private startup?:ReturnType<typeof setTimeout>;
 private retry?:ReturnType<typeof setTimeout>;
 constructor(private factory:WorkerFactory=createWorker){}

 private start(){
  if(this.worker||this.disposed)return;
  const worker=this.factory(this.recovered);this.worker=worker;
  worker.onmessage=e=>{
   const m=e.data;
   if(this.worker!==worker||this.disposed){m.bitmap?.close();return;}
   if(m.type==='ready'){clearTimeout(this.startup);this.startup=undefined;return;}
   if(m.job!==this.job){m.bitmap?.close();return;}
   clearTimeout(this.startup);this.startup=undefined;
   if(m.type==='result')this.onResult?.(m);
   else if(m.type==='error')this.onError?.(m.message,m.diagnostics??[]);
  };
  worker.onerror=e=>{e.preventDefault?.();if(this.worker===worker)this.failed(e.message);};
  worker.onmessageerror=()=>{if(this.worker===worker)this.failed('The browser could not read the render result.');};
  this.startup=setTimeout(()=>{if(this.worker===worker)this.failed('The renderer did not respond.');},15000);
  worker.postMessage({type:'configure',forceCPU:this.cpu});
 }

 private send(){
  if(this.disposed||!this.latest||this.retry)return;
  try{
   this.start();const worker=this.worker!,{spec}=this.latest,needed=new Set(spec.sources.map(s=>s.id));
   for(const id of this.registered.keys())if(!needed.has(id)){worker.postMessage({type:'remove',id});this.registered.delete(id);}
   for(const source of spec.sources){const asset=assets.get(source.id);if(asset&&this.registered.get(source.id)!==asset.blob){worker.postMessage({type:'asset',id:source.id,blob:asset.blob});this.registered.set(source.id,asset.blob);}}
   worker.postMessage({type:'render',...this.latest});
  }catch(error){this.failed(error instanceof Error?error.message:String(error));}
 }

 private failed(message?:string){
  this.stopWorker();if(this.disposed||!this.latest)return;
  if(!this.recovered){this.recovered=true;this.cpu=true;this.retry=setTimeout(()=>{this.retry=undefined;this.send();},100);return;}
  this.onError?.(message?`Rendering stopped: ${message}`:'Rendering stopped. Try the change again. If it fails, save the project and reopen it.',[]);
 }
 private stopWorker(){clearTimeout(this.startup);this.startup=undefined;const worker=this.worker;this.worker=undefined;worker?.terminate();this.registered.clear();}
 render(spec:RenderSpec){if(this.disposed)return;this.latest={job:++this.job,spec};this.send();}
 cancel(){this.job++;this.latest=undefined;clearTimeout(this.retry);this.retry=undefined;try{this.worker?.postMessage({type:'cancel'});}catch{this.stopWorker();}}
 dispose(){this.disposed=true;this.latest=undefined;clearTimeout(this.retry);this.retry=undefined;this.stopWorker();}
}
