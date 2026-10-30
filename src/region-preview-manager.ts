import type {Region,RenderSpec} from './types';

export type RegionPreviewRequest={type:'preview';id:number;spec:RenderSpec;region:Region};
export type RegionPreviewResult={type:'result';id:number;width:number;height:number;data:Uint8ClampedArray};
type WorkerFactory=(retry:boolean)=>Worker;
const createWorker:WorkerFactory=retry=>{
 const url=new URL('workers/region-preview.worker.js?v=1.7.0',new URL(import.meta.env.BASE_URL,location.href));
 if(retry)url.searchParams.set('retry',String(Date.now()));
 return new Worker(url);
};

/** Keep one running request and the newest pending selection. Recover the
 * newest selection after failure without moving mask work onto the UI thread. */
export class RegionPreviewManager{
 onResult?:(result:RegionPreviewResult)=>void;
 onError?:()=>void;
 private worker?:Worker;
 private ready=false;
 private disposed=false;
 private recovered=false;
 private stopped=false;
 private serial=0;
 private latest?:RegionPreviewRequest;
 private active?:RegionPreviewRequest;
 private startup?:ReturnType<typeof setTimeout>;
 private deadline?:ReturnType<typeof setTimeout>;
 private retry?:ReturnType<typeof setTimeout>;
 constructor(private factory:WorkerFactory=createWorker){}

 preview(spec:RenderSpec,region:Region){
  if(this.disposed)return;
  this.latest={type:'preview',id:++this.serial,spec,region};
  if(this.stopped){this.stopped=false;this.recovered=false;}
  this.send();
 }
 private send(){
  if(this.disposed||this.stopped||this.retry||this.active||!this.latest)return;
  try{
   if(!this.worker)this.start();
   if(!this.ready)return;
   const worker=this.worker!;this.active=this.latest;
   this.deadline=setTimeout(()=>{if(this.worker===worker)this.failed();},45000);
   worker.postMessage(this.active);
  }catch{this.failed();}
 }
 private start(){
  const worker=this.factory(this.recovered);this.worker=worker;
  this.startup=setTimeout(()=>{if(this.worker===worker)this.failed();},15000);
  worker.onmessage=({data})=>{
   if(this.worker!==worker||this.disposed)return;
   if(data.type==='ready'){clearTimeout(this.startup);this.startup=undefined;this.ready=true;this.send();return;}
   if(!this.active||data.id!==this.active.id)return;
   if(data.type==='error'){this.failed();return;}
   if(data.type!=='result'||!Number.isInteger(data.width)||!Number.isInteger(data.height)||data.width<=0||data.height<=0||!(data.data instanceof Uint8ClampedArray)||data.data.length!==data.width*data.height*4){this.failed();return;}
   clearTimeout(this.deadline);this.deadline=undefined;this.active=undefined;this.recovered=false;
   if(data.id===this.latest?.id){this.latest=undefined;this.onResult?.(data);}
   this.send();
  };
  worker.onerror=e=>{e.preventDefault?.();if(this.worker===worker)this.failed();};
  worker.onmessageerror=()=>{if(this.worker===worker)this.failed();};
 }
 private failed(){
  this.stopWorker();if(this.disposed||!this.latest)return;
  if(!this.recovered){this.recovered=true;this.retry=setTimeout(()=>{this.retry=undefined;this.send();},100);return;}
  this.stopped=true;this.latest=undefined;this.onError?.();
 }
 private stopWorker(){
  clearTimeout(this.startup);clearTimeout(this.deadline);this.startup=undefined;this.deadline=undefined;
  const worker=this.worker;this.worker=undefined;this.ready=false;this.active=undefined;worker?.terminate();
 }
 dispose(){this.disposed=true;this.latest=undefined;clearTimeout(this.retry);this.retry=undefined;this.stopWorker();}
}
