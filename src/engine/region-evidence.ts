import Delaunator from 'delaunator';
import type {Mask,RenderSpec,Vec} from '../types';
import {applyBasis,avoidFoldedTriangles,mlsBasis,normalize,sourceAlignment,spansPlane,type Controls} from './math';
import {sampleMask} from './contour-evidence';
import {BoundedCache} from './cache';

const kinds=['face','hair','body','clothing','accessories'] as const;
const cache=new BoundedCache<Mask[]>(2,192*240*5*2);
function fingerprint(mask:Mask|undefined){if(!mask)return '';let hash=2166136261;const data=mask.data;for(let i=0;i<data.length;i++)hash=Math.imul(hash^data[i],16777619);return [mask.width,mask.height,hash>>>0].join(':');}
export function regionEvidenceKey(spec:RenderSpec,controls:Controls):string{
 return JSON.stringify([spec.template.id,controls.sources.map(s=>s.fitVersion),controls.ids,controls.q,controls.uv,spec.recipe.warp,spec.recipe.aspect,spec.recipe.frameScale,spec.recipe.frameOffsetY,controls.sources.map(s=>[s.id,s.width,s.height,s.shapeWeight,kinds.map(k=>fingerprint(s.analysisMasks?.[k]))])]);
}

/** Warp cached class masks into output coordinates. No detector runs here.
 * Geometry and mask changes invalidate this field; texture sliders do not. */
export function regionEvidence(spec:RenderSpec,controls:Controls,key=regionEvidenceKey(spec,controls)):Mask[]|undefined{
 const eligible=controls.sources.map(s=>kinds.every(k=>!!s.analysisMasks?.[k]));if(!eligible.some(Boolean))return;
 const hit=cache.get(key);if(hit)return hit;
 const width=192,height=240,count=width*height,values=kinds.map(()=>new Float32Array(count)),coverage=new Float32Array(count),weights=normalize(controls.sources.map((s,i)=>eligible[i]?s.shapeWeight:0));
 if(!weights.some(Boolean))return;
 const samplers=controls.sources.map((source,s)=>{
  const masks=kinds.map(k=>source.analysisMasks?.[k]);if(!eligible[s]||!weights[s])return undefined;
  const mw=masks[0]!.width,mh=masks[0]!.height,sameSize=masks.every(m=>m!.width===mw&&m!.height===mh),weight=weights[s]/255;
  return (index:number,u:number,v:number)=>{
   if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||v<0||u>1||v>1)return;
   coverage[index]+=weights[s];
   if(!sameSize){for(let k=0;k<kinds.length;k++)values[k][index]+=weights[s]*sampleMask(masks[k],u,v);return;}
   const px=u*mw-.5,py=v*mh-.5,ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy;
   const left=Math.max(0,ix),right=Math.min(mw-1,ix+1),top=Math.max(0,iy)*mw,bottom=Math.min(mh-1,iy+1)*mw;
   const a=(1-fx)*(1-fy)*weight,b=fx*(1-fy)*weight,c=(1-fx)*fy*weight,d=fx*fy*weight;
   for(let k=0;k<kinds.length;k++){const data=masks[k]!.data;values[k][index]+=data[top+left]*a+data[top+right]*b+data[bottom+left]*c+data[bottom+right]*d;}
  };
 });
 const accumulate=(index:number,uvs:Vec[])=>{for(let s=0;s<samplers.length;s++)samplers[s]?.(index,uvs[s][0],uvs[s][1]);};
 const {q,uv}=controls;
 if(![q,...uv].every(spansPlane)){const align=controls.sources.map(s=>sourceAlignment(s,spec.recipe.aspect,spec.recipe.frameScale,spec.recipe.frameOffsetY));for(let y=0;y<height;y++)for(let x=0;x<width;x++)accumulate(y*width+x,align.map(a=>a.inverse([(x+.5)/width*spec.recipe.aspect,(y+.5)/height])));}
 else if(spec.recipe.warp==='mls'){
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const basis=mlsBasis(q,[(x+.5)/width*spec.recipe.aspect,(y+.5)/height]);accumulate(y*width+x,uv.map(p=>applyBasis(basis,p)));}
 }else{
  const minX=Math.min(0,...q.map(p=>p[0])),maxX=Math.max(spec.recipe.aspect,...q.map(p=>p[0])),minY=Math.min(0,...q.map(p=>p[1])),maxY=Math.max(1,...q.map(p=>p[1])),pad=Math.max(maxX-minX,maxY-minY)*2;
  const currentLayout=spec.template.id==='face-controls'||controls.sources.some(s=>(s.fitVersion??0)>=3);
  const outer:Vec[]=[[minX-pad,minY-pad],[maxX+pad,minY-pad],[maxX+pad,maxY+pad],[minX-pad,maxY+pad]],domain=[...q,...outer],mapped=uv.map(ps=>[...ps,...outer.map(v=>applyBasis(mlsBasis(q,v),ps))]),triangles=avoidFoldedTriangles(domain,mapped,Delaunator.from(domain).triangles,q.length,currentLayout),visited=new Uint8Array(count);
  for(let i=0;i<triangles.length;i+=3){const ia=triangles[i],ib=triangles[i+1],ic=triangles[i+2],a=domain[ia],b=domain[ib],c=domain[ic],den=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);if(Math.abs(den)<1e-14)continue;
   const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0])/spec.recipe.aspect*width)),x1=Math.min(width-1,Math.ceil(Math.max(a[0],b[0],c[0])/spec.recipe.aspect*width)),y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1])*height)),y1=Math.min(height-1,Math.ceil(Math.max(a[1],b[1],c[1])*height));
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const at=y*width+x;if(visited[at])continue;const px=(x+.5)/width*spec.recipe.aspect,py=(y+.5)/height,w0=((b[0]-px)*(c[1]-py)-(b[1]-py)*(c[0]-px))/den,w1=((c[0]-px)*(a[1]-py)-(c[1]-py)*(a[0]-px))/den,w2=1-w0-w1;
    if(w0< -1e-8||w1< -1e-8||w2< -1e-8)continue;visited[at]=1;
    for(let s=0;s<samplers.length;s++){const ps=mapped[s];samplers[s]?.(at,ps[ia][0]*w0+ps[ib][0]*w1+ps[ic][0]*w2,ps[ia][1]*w0+ps[ib][1]*w1+ps[ic][1]*w2);}
   }
  }
 }
 const masks=values.map(data=>({width,height,data:Uint8Array.from(data,(value,i)=>Math.round(255*value/Math.max(1e-9,coverage[i])))}));cache.set(key,masks,count*kinds.length);return masks;
}
