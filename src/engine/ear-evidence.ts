import type {AnalysisMasks,Landmark,Vec} from '../types';
import type {DetectedPoint} from './fitting';
import {farSideContour,sampleMask} from './contour-evidence';

/** The segmenter has no ear class. Use only a bounded skin protrusion next to
 * the visible face. A covered or far-side ear cannot supply an automatic pin. */
export function reviewEarEvidence(points:Landmark[],current:DetectedPoint[],width:number,height:number,masks?:AnalysisMasks):Landmark[]{
 if(!masks?.face||![33,263].every(i=>current[i]))return points;
 const a=current[33],b=current[263],dx=(b.x-a.x)*width,dy=(b.y-a.y)*height,span=Math.hypot(dx,dy);if(span<8)return points;
 const ex:Vec=[dx/span,dy/span],ey:Vec=[-ex[1],ex[0]],origin:Vec=[a.x*width,a.y*height];
 const frame=(p:Landmark):Vec=>{const x=p.x*width-origin[0],y=p.y*height-origin[1];return [(x*ex[0]+y*ex[1])/span,(x*ey[0]+y*ey[1])/span];};
 const photo=(u:number,v:number):Vec=>[(origin[0]+span*(u*ex[0]+v*ey[0]))/width,(origin[1]+span*(u*ex[1]+v*ey[1]))/height];
 const byId=new Map(points.map(p=>[p.id,p])),result=new Map<string,Landmark>();
 for(const [side,ids,outline]of [[-1,['p45','p44'],['p18','p28','p21']],[1,['p42','p43'],['p19','p29','p20']]] as const){
  const controls=ids.map(id=>byId.get(id)),edge=outline.map(id=>byId.get(id));if(controls.every(p=>!p))continue;
  const editable=controls.filter((p):p is Landmark=>!!p&&!p.authored&&!p.locked&&(p.enabled||!!p.autoDisabled));if(!editable.length)continue;
  const reject=()=>{for(const p of editable)result.set(p.id,{...p,enabled:false,autoDisabled:true,confidence:.25,review:'Ear boundary is covered or unclear. Place this control manually to use it.'});};
  if(edge.some(p=>!p?.enabled)||farSideContour(outline[0],current,width,height)){reject();continue;}
  const curve=edge.map(p=>frame(p!)).sort((a,b)=>a[1]-b[1]),top=curve[0][1]-.12,bottom=curve.at(-1)![1]+.04;
  if(bottom-top<.1||bottom-top>1.1){reject();continue;}
  const edgeU=(v:number)=>{let i=1;while(i<curve.length-1&&curve[i][1]<v)i++;const t=Math.max(0,Math.min(1,(v-curve[i-1][1])/Math.max(1e-6,curve[i][1]-curve[i-1][1])));return curve[i-1][0]+t*(curve[i][0]-curve[i-1][0]);};
  const rows=48,cols=32,grid=new Uint8Array(rows*cols),samples:Vec[]=[],step=.36/cols;
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
   const v=top+(y+.5)/rows*(bottom-top),u=edgeU(v)+side*(.035+(x+.5)*step),p=photo(u,v);samples.push([u,v]);
   const skin=sampleMask(masks.face,...p),cover=Math.max(sampleMask(masks.hair,...p),sampleMask(masks.clothing,...p),sampleMask(masks.accessories,...p),sampleMask(masks.body,...p));grid[y*cols+x]=skin>.6&&cover<.3?1:0;
  }
  let best:number[]=[];const seen=new Uint8Array(grid.length);
  for(let start=0;start<grid.length;start++){if(!grid[start]||seen[start])continue;const component=[start];seen[start]=1;for(let i=0;i<component.length;i++){const at=component[i],x=at%cols,y=Math.floor(at/cols);for(const next of [x>0?at-1:-1,x<cols-1?at+1:-1,y>0?at-cols:-1,y<rows-1?at+cols:-1])if(next>=0&&grid[next]&&!seen[next]){seen[next]=1;component.push(next);}}if(component.length>best.length)best=component;}
  const ys=best.map(i=>Math.floor(i/cols)),xs=best.map(i=>i%cols),extent=best.length?(Math.max(...ys)-Math.min(...ys)+1)/rows*(bottom-top):0;
  // Reject crop edges, broad face strips, and isolated skin specks.
  if(best.length<12||extent<.14||extent>.75||Math.max(...xs)>=cols-2||!best.some(i=>i%cols<3)){reject();continue;}
  const outer=best.reduce((a,b)=>side*samples[b][0]>side*samples[a][0]?b:a),low=best.reduce((a,b)=>samples[b][1]>samples[a][1]?b:a);
  const proposed=[photo(...samples[outer]),photo(...samples[low])];
  if(proposed.some(p=>p.some(v=>v<=0||v>=1))||Math.hypot((proposed[0][0]-proposed[1][0])*width,(proposed[0][1]-proposed[1][1])*height)<span*.06){reject();continue;}
  for(let i=0;i<ids.length;i++){const p=controls[i];if(p&&editable.includes(p))result.set(p.id,{...p,x:proposed[i][0],y:proposed[i][1],enabled:true,autoDisabled:undefined,confidence:.6,review:'Skin boundary supports this ear estimate. Check before use.'});}
 }
 return points.map(p=>result.get(p.id)??p);
}
