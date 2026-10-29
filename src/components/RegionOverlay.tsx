import{useEffect,useRef}from'react';
import{buildControls}from'../engine/math';
import{regionEvidenceKey}from'../engine/region-evidence';
import type{Project,Region,RenderSpec}from'../types';

type Request={id:number;spec:RenderSpec;region:Region};
type Response={id:number;width:number;height:number;data:Uint8ClampedArray;error?:string};

export function RegionOverlay({project,region}:{project:Project;region:Region}){
 const canvas=useRef<HTMLCanvasElement>(null),worker=useRef<Worker|undefined>(undefined),pending=useRef<Request|undefined>(undefined),busy=useRef(false),latest=useRef(0);
 const spec:RenderSpec={revision:project.revision,sources:project.sources,template:project.template,recipe:project.recipe,size:256,quality:'preview'},controls=buildControls(spec),key=JSON.stringify([regionEvidenceKey(spec,controls),project.recipe.regionFeather,project.recipe.regionMasks]);
 const send=()=>{if(worker.current&&!busy.current&&pending.current){busy.current=true;worker.current.postMessage(pending.current);pending.current=undefined;}};
 useEffect(()=>{
  const instance=new Worker(new URL('../engine/region-preview.worker.ts',import.meta.url),{type:'module'});worker.current=instance;
  instance.onmessage=({data}:MessageEvent<Response>)=>{
   busy.current=false;
   if(data.id===latest.current&&!data.error&&canvas.current){const c=canvas.current;c.width=data.width;c.height=data.height;c.getContext('2d')?.putImageData(new ImageData(data.data,data.width,data.height),0,0);}
   send();
  };
  instance.onerror=()=>{busy.current=false;pending.current=undefined;};
  return()=>{instance.terminate();worker.current=undefined;busy.current=false;pending.current=undefined;};
 },[]);
 useEffect(()=>{pending.current={id:++latest.current,spec,region};const c=canvas.current;c?.getContext('2d')?.clearRect(0,0,c.width,c.height);send();},[key,region]);
 return <canvas style={{transform:project.recipe.flipOutput?'scaleX(-1)':undefined}} className="region-overlay" ref={canvas} aria-label={`${region} influence area`}/>;
}
