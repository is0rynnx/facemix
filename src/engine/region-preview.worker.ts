import {buildControls} from './math';
import {regionPartition} from './regions';
import {REGIONS} from '../types';
import type {RegionPreviewRequest} from '../region-preview-manager';

// Keep mask warping off the UI thread. The caller sends only the newest
// pending request, so slider changes cannot build an unbounded work queue.
self.onmessage=({data}:{data:RegionPreviewRequest})=>{
 if(data.type!=='preview')return;
 const {id,spec,region}=data;
 try{
  const width=128,height=160,partition=regionPartition(spec,buildControls(spec)),index=REGIONS.indexOf(region),pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;pixels[i]=20;pixels[i+1]=115;pixels[i+2]=230;pixels[i+3]=Math.round(partition([(x+.5)/width,(y+.5)/height])[index]*170);}
  self.postMessage({type:'result',id,width,height,data:pixels},[pixels.buffer]);
 }catch(error){self.postMessage({type:'error',id,error:String(error)});}
};
self.postMessage({type:'ready'});
