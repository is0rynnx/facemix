import {buildControls} from './math';
import {regionPartition} from './regions';
import {REGIONS,type Region,type RenderSpec} from '../types';

// Keep mask warping off the UI thread. The caller sends only the newest
// pending request, so slider changes cannot build an unbounded work queue.
self.onmessage=({data}:{data:{id:number;spec:RenderSpec;region:Region}})=>{
 const {id,spec,region}=data;
 try{
  const width=128,height=160,partition=regionPartition(spec,buildControls(spec)),index=REGIONS.indexOf(region),pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;pixels[i]=20;pixels[i+1]=115;pixels[i+2]=230;pixels[i+3]=Math.round(partition([(x+.5)/width,(y+.5)/height])[index]*170);}
  self.postMessage({id,width,height,data:pixels},[pixels.buffer]);
 }catch(error){self.postMessage({id,error:String(error)});}
};
