import{useEffect,useRef}from'react';
import{buildControls}from'../engine/math';
import{regionEvidenceKey}from'../engine/region-evidence';
import{RegionPreviewManager}from'../region-preview-manager';
import{useStudio}from'../store';
import type{Project,Region,RenderSpec}from'../types';

export function RegionOverlay({project,region}:{project:Project;region:Region}){
 const canvas=useRef<HTMLCanvasElement>(null),manager=useRef<RegionPreviewManager|undefined>(undefined);
 const spec:RenderSpec={revision:project.revision,sources:project.sources,template:project.template,recipe:project.recipe,size:256,quality:'preview'},controls=buildControls(spec),key=JSON.stringify([regionEvidenceKey(spec,controls),project.recipe.regionFeather,project.recipe.regionMasks]);
 useEffect(()=>{
  const instance=new RegionPreviewManager();manager.current=instance;
  instance.onResult=data=>{
   if(canvas.current){const c=canvas.current;c.width=data.width;c.height=data.height;c.getContext('2d')?.putImageData(new ImageData(data.data,data.width,data.height),0,0);}
  };
  instance.onError=()=>useStudio.getState().notify('Region preview unavailable. Turn the preview off and on to retry.');
  return()=>{instance.dispose();manager.current=undefined;};
 },[]);
 useEffect(()=>{const c=canvas.current;c?.getContext('2d')?.clearRect(0,0,c.width,c.height);manager.current?.preview(spec,region);},[key,region]);
 return <canvas style={{transform:project.recipe.flipOutput?'scaleX(-1)':undefined}} className="region-overlay" ref={canvas} aria-label={`${region} influence area`}/>;
}
