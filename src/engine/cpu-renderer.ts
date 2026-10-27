import { normalize,regionalInfluence,regionsGeometry,type WarpMesh } from './math';

import { colorGains,getBitmap,type ImageAsset } from './gpu';

import { REGIONS,type Mask,type RenderSpec } from '../types';

import {cropCoverage,regionalWeightMaps,sampleWeight} from './regions';

const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));

function maskSample(mask:Mask|undefined,u:number,v:number){if(!mask)return 1;const x=u*mask.width-.5,y=v*mask.height-.5,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;let a=0;for(let j=0;j<2;j++)for(let i=0;i<2;i++)a+=mask.data[clamp(iy+j,0,mask.height-1)*mask.width+clamp(ix+i,0,mask.width-1)]/255*(i?fx:1-fx)*(j?fy:1-fy);return a;}

function kernel(x:number){x=Math.abs(x);return x<1?1.5*x*x*x-2.5*x*x+1:x<2?-.5*x*x*x+2.5*x*x-4*x+2:0;}

export async function renderCPU(spec:RenderSpec,mesh:WarpMesh,assets:Map<string,ImageAsset>,cancelled:()=>boolean,tile?:{x:number;y:number;w:number;h:number}):Promise<{blob?:Blob;bitmap?:ImageBitmap;width:number;height:number;backend:string}>{

 const fullW=Math.round(spec.size*Math.min(1,spec.recipe.aspect)),fullH=Math.round(spec.size/Math.max(1,spec.recipe.aspect));

 if(!tile&&spec.quality==='final'&&Math.max(fullW,fullH)>1024){const output=new OffscreenCanvas(fullW,fullH),ctx=output.getContext('2d')!;for(let y=0;y<fullH;y+=1024)for(let x=0;x<fullW;x+=1024){if(cancelled())throw new Error('cancelled');const result=await renderCPU(spec,mesh,assets,cancelled,{x,y,w:Math.min(1024,fullW-x),h:Math.min(1024,fullH-y)});ctx.drawImage(result.bitmap!,x,y);result.bitmap!.close();}return {blob:await output.convertToBlob({type:'image/png'}),width:fullW,height:fullH,backend:'CPU fallback / tiled'};}

 const w=tile?.w??fullW,h=tile?.h??fullH,sum=new Float32Array(w*h*4),globalWeights=normalize(mesh.controls.sources.map(s=>s.appearanceWeight));

 const regionWeights=REGIONS.map(r=>regionalInfluence(mesh.controls.sources,r,'appearance',spec.recipe)),regional=Object.keys(spec.recipe.regionSources??{}).length>0||mesh.controls.sources.some(s=>REGIONS.some(r=>s.regionWeights[r].appearance!==1));

 if(regionWeights.some(row=>!row.some(v=>v>0)))throw new Error('All appearance influences are zero in at least one region.');

 const weightMaps=regionalWeightMaps(spec,mesh.controls),coverageSum=new Float32Array(w*h),coverageMax=new Float32Array(w*h),background=spec.recipe.background==='source'?new Float32Array(w*h*4):undefined;

 const gains=spec.recipe.colorMatch?await colorGains(mesh.controls.sources,assets):mesh.controls.sources.map(()=>[1,1,1]);

 const linear=(v:number)=>spec.recipe.blend==='linear'?(v<=.04045?v/12.92:((v+.055)/1.055)**2.4):v;

 for(let s=0;s<mesh.controls.sources.length;s++){

  const source=mesh.controls.sources[s],asset=assets.get(source.id);if(!asset)continue;const bm=await getBitmap(asset,source,spec.quality==='final'||spec.size>1024),c=new OffscreenCanvas(bm.width,bm.height),ctx=c.getContext('2d')!;ctx.drawImage(bm,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data,mask=source.subjectMask??asset.mask,ex=source.exclusionMask??asset.exclusion,gain=gains[s];

  const screen=mesh.vertices.map(p=>[p[0]/spec.recipe.aspect*fullW-(tile?.x??0),p[1]*fullH-(tile?.y??0)]),visited=new Uint8Array(w*h),backgroundSource=background&&source.id===(spec.recipe.backgroundSourceId??mesh.controls.sources[0].id),cubic=spec.quality==='final';

  const sample=(u:number,v:number)=>{const px=u*bm.width-.5,py=v*bm.height-.5,x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0,offset=cubic?-1:0,xw=cubic?[kernel(-1-fx),kernel(fx),kernel(1-fx),kernel(2-fx)]:[1-fx,fx],yw=cubic?[kernel(-1-fy),kernel(fy),kernel(1-fy),kernel(2-fy)]:[1-fy,fy];let r=0,g=0,b=0,a=0,total=0;for(let iy=0;iy<yw.length;iy++)for(let ix=0;ix<xw.length;ix++){const weight=xw[ix]*yw[iy],at=(clamp(y0+iy+offset,0,bm.height-1)*bm.width+clamp(x0+ix+offset,0,bm.width-1))*4;const alpha=pixels[at+3]/255;r+=pixels[at]*alpha*weight;g+=pixels[at+1]*alpha*weight;b+=pixels[at+2]*alpha*weight;a+=pixels[at+3]*weight;total+=weight;}return [clamp(a>1e-8?r/a:0,0,1),clamp(a>1e-8?g/a:0,0,1),clamp(a>1e-8?b/a:0,0,1),clamp(a/total/255,0,1)];};

  for(let t=0;t<mesh.triangles.length;t+=3){

   const a=mesh.triangles[t],b=mesh.triangles[t+1],d=mesh.triangles[t+2],pa=screen[a],pb=screen[b],pc=screen[d],den=(pb[0]-pa[0])*(pc[1]-pa[1])-(pb[1]-pa[1])*(pc[0]-pa[0]);if(Math.abs(den)<1e-10)continue;

   const left=Math.max(0,Math.floor(Math.min(pa[0],pb[0],pc[0]))),right=Math.min(w-1,Math.ceil(Math.max(pa[0],pb[0],pc[0]))),top=Math.max(0,Math.floor(Math.min(pa[1],pb[1],pc[1]))),bottom=Math.min(h-1,Math.ceil(Math.max(pa[1],pb[1],pc[1])));

   for(let y=top;y<=bottom;y++){

    const yy=y+.5,intersections:number[]=[];for(const [a,b]of[[pa,pb],[pb,pc],[pc,pa]])if(Math.abs(b[1]-a[1])>1e-12&&yy>=Math.min(a[1],b[1])&&yy<=Math.max(a[1],b[1]))intersections.push(a[0]+(yy-a[1])*(b[0]-a[0])/(b[1]-a[1]));

    if(intersections.length<2)continue;const rowLeft=Math.max(left,Math.ceil(Math.min(...intersections)-.5000001)),rowRight=Math.min(right,Math.floor(Math.max(...intersections)-.4999999));

    for(let x=rowLeft;x<=rowRight;x++){

    const index=y*w+x;if(visited[index])continue;const aa=((pb[0]-x-.5)*(pc[1]-y-.5)-(pb[1]-y-.5)*(pc[0]-x-.5))/den,bb=((pc[0]-x-.5)*(pa[1]-y-.5)-(pc[1]-y-.5)*(pa[0]-x-.5))/den,cc=1-aa-bb;if(aa< -1e-7||bb< -1e-7||cc< -1e-7)continue;visited[index]=1;

    const uv=mesh.uvs[s],u=aa*uv[a][0]+bb*uv[b][0]+cc*uv[d][0],v=aa*uv[a][1]+bb*uv[b][1]+cc*uv[d][1];if(u<0||v<0||u>1||v>1)continue;

    let alpha=spec.recipe.removeBackground?maskSample(mask,u,v):1;

    if(mask&&spec.recipe.removeBackground&&spec.recipe.feather>0){let value=alpha*4;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)if(i||j)value+=maskSample(mask,u+i*spec.recipe.feather/mask.width,v+j*spec.recipe.feather/mask.height);alpha=value/12;}

    const subjectAlpha=alpha,rgba=sample(u,v),coverage=cropCoverage(u,v,source.width,source.height,spec.recipe.cropFeather??0)*maskSample(ex,u,v);alpha*=coverage*rgba[3];

    let weight=spec.inspectSourceId?(source.id===spec.inspectSourceId?1:0):globalWeights[s];

    if(regional&&!spec.inspectSourceId)weight=sampleWeight(weightMaps[s],(x+.5+(tile?.x??0))/fullW,(y+.5+(tile?.y??0))/fullH);

    coverageSum[index]+=coverage*weight;if(weight>0)coverageMax[index]=Math.max(coverageMax[index],coverage);

    const out=index*4,foreground=[0,0,0];let foregroundWeight=0;
    if(mask&&spec.recipe.removeBackground&&spec.recipe.decontaminate>0&&subjectAlpha>.03&&subjectAlpha<.97){
     for(const radius of [2,4,8])for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){if(!i&&!j)continue;const uu=u+i*radius/mask.width,vv=v+j*radius/mask.height;if(uu<0||vv<0||uu>1||vv>1)continue;const m=maskSample(mask,uu,vv),weight=Math.max(0,m-subjectAlpha)**2;if(weight<=0)continue;const neighbor=sample(uu,vv),k=weight*neighbor[3];for(let channel=0;channel<3;channel++)foreground[channel]+=neighbor[channel]*k;foregroundWeight+=k;}
    }
    for(let k=0;k<3;k++){

     let color=rgba[k];if(backgroundSource)background![out+k]=color;

     if(foregroundWeight>0){const amount=spec.recipe.decontaminate*(1-subjectAlpha);color=color*(1-amount)+foreground[k]/foregroundWeight*amount;}

     sum[out+k]+=linear(clamp(color*gain[k],0,1))*alpha*weight;

    }

    sum[out+3]+=alpha*weight;if(backgroundSource)background![out+3]=rgba[3];

   }

   }

   if(t%300===0){await new Promise(r=>setTimeout(r,0));if(cancelled())throw new Error('cancelled');}

  }

  if((spec.quality==='final'||spec.size>1024)&&asset.original){asset.original.close();asset.original=undefined;}

 }

 const result=new Uint8ClampedArray(w*h*4),hex=spec.recipe.backgroundColor,bg=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);

 for(let i=0;i<sum.length;i+=4){const raw=sum[i+3],a=clamp(spec.recipe.fillMissing&&coverageSum[i/4]>1e-8?raw/coverageSum[i/4]*coverageMax[i/4]:raw,0,1);for(let k=0;k<3;k++){let color=raw>1e-8?sum[i+k]/raw:0;if(spec.recipe.blend==='linear')color=color<=.0031308?color*12.92:1.055*color**(1/2.4)-.055;if(spec.recipe.background==='solid')color=color*a+bg[k]*(1-a);else if(background)color=color*a+background[i+k]*(1-a);result[i+k]=Math.round(color*255);}result[i+3]=Math.round((spec.recipe.background==='solid'?1:background?a+background[i+3]*(1-a):a)*255);}

 const canvas=new OffscreenCanvas(w,h);canvas.getContext('2d')!.putImageData(new ImageData(result,w,h),0,0);return spec.quality==='final'&&!tile?{blob:await canvas.convertToBlob({type:'image/png'}),width:w,height:h,backend:'CPU fallback'}:{bitmap:canvas.transferToImageBitmap(),width:w,height:h,backend:'CPU fallback'};

}
