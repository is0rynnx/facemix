/// <reference lib="webworker" />

import { buildMesh,regionalInfluence,geometrySignature } from '../engine/math';

import { GPUCompositor, type ImageAsset } from '../engine/gpu';

import { renderCPU } from '../engine/cpu-renderer';

import type { RenderSpec } from '../types';
import {BoundedCache} from '../engine/cache';

const assets=new Map<string,ImageAsset>();let gpu:GPUCompositor|undefined;let pending:{job:number;spec:RenderSpec}|undefined;let running=false,epoch=0;

const meshes=new BoundedCache<Awaited<ReturnType<typeof buildMesh>>>(4,300000);

self.onmessage=e=>{

 const data=e.data;

 if(data.type==='asset'){const previous=assets.get(data.id);if(previous)gpu?.releaseAsset(previous);previous?.bitmap?.close();previous?.original?.close();assets.set(data.id,{blob:data.blob});return;}

 if(data.type==='remove'){const asset=assets.get(data.id);if(asset)gpu?.releaseAsset(asset);asset?.bitmap?.close();asset?.original?.close();assets.delete(data.id);return;}

 if(data.type==='cancel'){epoch++;pending=undefined;return;}

 if(data.type==='render'){pending=data;epoch++;if(!running)void process();}

};

async function process(){

 running=true;

 while(pending){const {job,spec}=pending;pending=undefined;const myEpoch=epoch,start=performance.now(),cancelled=()=>myEpoch!==epoch;

  try{

   const key=JSON.stringify([geometrySignature(spec),spec.recipe.warp==='triangles'?null:[spec.quality,spec.size]]);

   const mesh=meshes.get(key)??await buildMesh(spec,cancelled);

   if(cancelled())continue;meshes.set(key,mesh,mesh.vertices.length*Math.max(1,mesh.uvs.length));mesh.controls.sources=spec.sources.filter(s=>s.enabled).slice().sort((a,b)=>a.id.localeCompare(b.id));

   const regions=['eyes','brows','nose','mouth','outline','hair','ears','neck','clothing'] as const;

   const appearanceError=regions.find(r=>regionalInfluence(mesh.controls.sources,r,'appearance',spec.recipe).every(w=>w<=0));

   if(appearanceError)throw new Error(`${appearanceError}: all appearance influences are zero.`);

   if(mesh.controls.diagnostics.some(d=>d.kind==='error')){self.postMessage({type:'error',job,revision:spec.revision,message:mesh.controls.diagnostics.map(d=>d.message).join(' '),diagnostics:mesh.controls.diagnostics});continue;}

   mesh.controls.diagnostics=mesh.controls.diagnostics.filter(d=>!d.message.startsWith('GPU fallback:'));

   let result;

   try{gpu??=new GPUCompositor();result=await gpu.render(spec,mesh,assets,cancelled);}catch(error){if(cancelled())continue;gpu=undefined;mesh.controls.diagnostics.push({kind:'warning',message:`GPU fallback: ${String(error)}`});result=await renderCPU(spec,mesh,assets,cancelled);}

   if(cancelled()){result.bitmap?.close();continue;}

   if(spec.recipe.flipOutput){const bm=result.bitmap??await createImageBitmap(result.blob!),c=new OffscreenCanvas(result.width,result.height),ctx=c.getContext('2d')!;ctx.translate(c.width,0);ctx.scale(-1,1);ctx.drawImage(bm,0,0);bm.close();result=result.blob?{...result,blob:await c.convertToBlob({type:'image/png'})}:{...result,bitmap:c.transferToImageBitmap()};}
   if(cancelled()){result.bitmap?.close();continue;}
   self.postMessage({type:'result',job,revision:spec.revision,...result,ms:performance.now()-start,vertices:mesh.vertices.length,diagnostics:mesh.controls.diagnostics},result.bitmap?[result.bitmap]:[]);

  }catch(error){if(!cancelled())self.postMessage({type:'error',job,revision:spec.revision,message:String(error),diagnostics:[]});}

 }

 running=false;

}
