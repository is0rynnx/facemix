import { useEffect,useRef,useState } from 'react';

import {useViewportGestures} from './useViewportGestures';

import { assets } from '../data';
import {pointLabel} from '../default-template';
import {usesControl,faceContourIds} from '../landmark-policy';

import { useStudio } from '../store';

import type { Landmark,Mask,Source,Vec } from '../types';

export type EditorTool='move'|'add'|'foreground'|'background'|'exclude'|'restore'|'polygon';

interface Props {maskOverlay?:Mask;maskKind?:'subjectMask'|'exclusionMask';maskDisplay?:'removed'|'included';problemPoints?:string[];source:Source;onZoomChange?:(n:number)=>void;pan?:Vec;onPanChange?:(p:Vec)=>void;imageURL?:string;zoom:number;tool:EditorTool;brush:number;showLabels:boolean;showLines:boolean;showMask?:boolean;region?:string;onSourceMenu?:(id:string,x:number,y:number)=>void;onMaskChange?:(mask:Mask)=>void;}

export function SourceCanvas({maskOverlay,maskKind,maskDisplay='removed',problemPoints=[],source,imageURL,zoom,onZoomChange,pan:sharedPan,onPanChange,tool,brush,showLabels,showLines,showMask=false,region='all',onSourceMenu,onMaskChange}:Props){

 const canvas=useRef<HTMLCanvasElement>(null),holder=useRef<HTMLDivElement>(null),image=useRef<HTMLImageElement | undefined>(undefined),transform=useRef({x:0,y:0,w:1,h:1});

 const [dimensions,setDimensions]=useState([320,450]),[ownPan,setOwnPan]=useState<Vec>([0,0]),[cursor,setCursor]=useState<Vec>(),[polygon,setPolygon]=useState<Vec[]>([]),[box,setBox]=useState<[Vec,Vec]>();

 const drag=useRef<{start:Vec;positions:Landmark[];pan?:Vec;mask?:Mask;last?:Vec;box?:{base:string[]}} | undefined>(undefined);

 const selected=useStudio(s=>s.selectedPoints),template=useStudio(s=>s.project.template),recipe=useStudio(s=>s.project.recipe),url=imageURL??assets.get(source.id)?.url;

 const maskFrame=useRef<number|undefined>(undefined),pendingMask=useRef<{mask:Mask;apply:(m:Mask)=>void}|undefined>(undefined);
 const flushMask=()=>{if(maskFrame.current!==undefined){if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(maskFrame.current);else clearTimeout(maskFrame.current);maskFrame.current=undefined;}const pending=pendingMask.current;pendingMask.current=undefined;if(pending)pending.apply({...pending.mask,data:new Uint8Array(pending.mask.data)});};
 useEffect(()=>()=>flushMask(),[]);
 const coloredMask=useRef<{mask:Mask;display:string;canvas:HTMLCanvasElement}|undefined>(undefined);
 const synthetic=source.id==='output',pan=sharedPan??ownPan,setPan=onPanChange??setOwnPan;
 useViewportGestures(holder,zoom,pan,onZoomChange,setPan,()=>{flushMask();drag.current=undefined;setBox(undefined);});

 useEffect(()=>{image.current=undefined;if(!url)return;const img=new Image();img.onload=()=>{image.current=img;setDimensions(d=>d.slice());};img.src=url;return()=>{img.onload=null;};},[url]);
 useEffect(()=>{flushMask();drag.current=undefined;setPolygon([]);setBox(undefined);setCursor(undefined);},[source.id,maskKind,tool]);

 useEffect(()=>{const observer=new ResizeObserver(entries=>{const r=entries[0].contentRect;setDimensions([r.width,r.height]);});if(holder.current)observer.observe(holder.current);return()=>observer.disconnect();},[]);

 useEffect(()=>{

  const c=canvas.current;if(!c)return;const ratio=Math.min(2,devicePixelRatio||1),w=dimensions[0],h=dimensions[1];c.width=Math.round(w*ratio);c.height=Math.round(h*ratio);const ctx=c.getContext('2d')!;ctx.scale(ratio,ratio);ctx.clearRect(0,0,w,h);

  const scale=Math.min(w/source.width,h/source.height)*zoom,iw=source.width*scale,ih=source.height*scale,x=(w-iw)/2+pan[0]*w,y=(h-ih)/2+pan[1]*h;transform.current={x,y,w:iw,h:ih};

  if(image.current)ctx.drawImage(image.current,x,y,iw,ih);

  const mask=maskOverlay??source[maskKind??(tool==='exclude'||tool==='restore'?'exclusionMask':'subjectMask')];

  if(showMask&&mask){if(coloredMask.current?.mask!==mask||coloredMask.current.display!==maskDisplay){const overlay=document.createElement('canvas');overlay.width=mask.width;overlay.height=mask.height;const rgba=new Uint8ClampedArray(mask.width*mask.height*4);for(let i=0;i<mask.data.length;i++){rgba[i*4]=maskDisplay==='included'?55:230;rgba[i*4+1]=maskDisplay==='included'?142:74;rgba[i*4+2]=maskDisplay==='included'?240:110;rgba[i*4+3]=Math.round((maskDisplay==='included'?mask.data[i]:255-mask.data[i])*.55);}overlay.getContext('2d')!.putImageData(new ImageData(rgba,mask.width,mask.height),0,0);coloredMask.current={mask,display:maskDisplay,canvas:overlay};}ctx.drawImage(coloredMask.current.canvas,x,y,iw,ih);}

  const points=new Map(source.landmarks.map(p=>[p.id,p]));const visible=(id:string)=>(points.get(id)?.enabled||points.get(id)?.autoDisabled||selected.includes(id))&&(selected.includes(id)||usesControl(template.points.find(d=>d.id===id)??{region:'outline'},recipe))&&(region==='all'||template.points.find(d=>d.id===id)?.region===region);

  if(showLines&&!showMask){ctx.lineWidth=.8;ctx.strokeStyle='rgba(115,180,255,.50)';for(const contour of template.contours){ctx.beginPath();let started=false;for(const id of (contour.name==='Face outline'?faceContourIds(contour.ids,template.points):contour.ids)){const p=points.get(id);if(!p||!p.enabled||!visible(id)){started=false;continue;}if(!started){ctx.moveTo(x+p.x*iw,y+p.y*ih);started=true;}else ctx.lineTo(x+p.x*iw,y+p.y*ih);}if(contour.closed)ctx.closePath();ctx.stroke();}}

  if(!showMask)for(const p of source.landmarks){if(!visible(p.id))continue;const px=x+p.x*iw,py=y+p.y*ih,active=selected.includes(p.id),problem=problemPoints.includes(p.id);ctx.beginPath();ctx.arc(px,py,problem?4:active?3.4:1.8,0,Math.PI*2);ctx.lineWidth=2.2;ctx.strokeStyle='#151515dd';ctx.stroke();ctx.lineWidth=active||problem?1.4:.8;ctx.strokeStyle=p.autoDisabled?'#f3b475':!p.enabled?'#999':problem?'#ff735a':active?'#fff':p.locked?'#f6be62':p.confidence<.7?'#f3b475':'#9bcaff';ctx.stroke();if(showLabels||problem){ctx.font='10px ui-monospace,monospace';ctx.fillStyle=problem?'#ff9985':'#fff';ctx.strokeStyle='#111';ctx.lineWidth=3;ctx.strokeText(pointLabel(p.id),px+6,py-5);ctx.fillText(pointLabel(p.id),px+6,py-5);}}

  if(polygon.length){ctx.strokeStyle='#9bcaff';ctx.fillStyle='rgba(115,180,255,.18)';ctx.lineWidth=1.5;ctx.beginPath();polygon.forEach((p,i)=>i?ctx.lineTo(x+p[0]*iw,y+p[1]*ih):ctx.moveTo(x+p[0]*iw,y+p[1]*ih));if(cursor)ctx.lineTo(x+cursor[0]*iw,y+cursor[1]*ih);ctx.stroke();polygon.forEach(p=>{ctx.fillStyle='#fff';ctx.fillRect(x+p[0]*iw-2,y+p[1]*ih-2,4,4);});}


  if(box){ctx.fillStyle='rgba(55,142,240,.12)';ctx.strokeStyle='#378ef0';ctx.lineWidth=1;const a=box[0],b=box[1];ctx.fillRect(x+a[0]*iw,y+a[1]*ih,(b[0]-a[0])*iw,(b[1]-a[1])*ih);ctx.strokeRect(x+a[0]*iw,y+a[1]*ih,(b[0]-a[0])*iw,(b[1]-a[1])*ih);}
  if(cursor&&showMask&&tool!=='polygon'){ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.beginPath();ctx.arc(x+cursor[0]*iw,y+cursor[1]*ih,brush*iw/2,0,Math.PI*2);ctx.stroke();}

  if(cursor&&!showMask&&zoom<2&&tool==='move'&&image.current){const selectedPoint=source.landmarks.find(p=>selected.includes(p.id));if(selectedPoint){const m=76,px=x+selectedPoint.x*iw,py=y+selectedPoint.y*ih,corners=[[10,10],[w-m-10,10],[10,h-m-10],[w-m-10,h-m-10]],best=corners.sort((a,b)=>Math.hypot(b[0]+m/2-px,b[1]+m/2-py)-Math.hypot(a[0]+m/2-px,a[1]+m/2-py))[0],mx=best[0],my=best[1];ctx.save();ctx.beginPath();ctx.arc(mx+m/2,my+m/2,m/2,0,Math.PI*2);ctx.clip();ctx.drawImage(image.current,selectedPoint.x*source.width-25,selectedPoint.y*source.height-25,50,50,mx,my,m,m);ctx.strokeStyle='#378ef0';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(mx+m/2-7,my+m/2);ctx.lineTo(mx+m/2+7,my+m/2);ctx.moveTo(mx+m/2,my+m/2-7);ctx.lineTo(mx+m/2,my+m/2+7);ctx.stroke();ctx.restore();}}

 },[source.width,source.height,source.landmarks,source.subjectMask,source.exclusionMask,url,dimensions,pan,zoom,selected,template,recipe.earControls,showLabels,showLines,showMask,tool,brush,cursor,polygon,box,region,problemPoints,maskKind,maskDisplay,maskOverlay]);

 const position=(e:React.PointerEvent):Vec=>{const rect=canvas.current!.getBoundingClientRect(),t=transform.current;return [((e.clientX-rect.left)*dimensions[0]/(rect.width||dimensions[0])-t.x)/t.w,((e.clientY-rect.top)*dimensions[1]/(rect.height||dimensions[1])-t.y)/t.h];};

 const paint=(p:Vec)=>{const d=drag.current;if(!d?.mask)return;const mask=d.mask,data=mask.data,value=tool==='foreground'||tool==='restore'?255:0;

  const begin=d.last??p,steps=Math.max(1,Math.ceil(Math.hypot((p[0]-begin[0])*mask.width,(p[1]-begin[1])*mask.height)/Math.max(1,brush*mask.width/5))),radius=Math.max(1,brush*mask.width/2),radiusY=radius*mask.height/mask.width*source.width/source.height;

  for(let step=0;step<=steps;step++){const cx=(begin[0]+(p[0]-begin[0])*step/steps)*mask.width,cy=(begin[1]+(p[1]-begin[1])*step/steps)*mask.height;for(let y=Math.max(0,Math.floor(cy-radiusY));y<Math.min(mask.height,cy+radiusY);y++)for(let x=Math.max(0,Math.floor(cx-radius));x<Math.min(mask.width,cx+radius);x++){const distance=Math.hypot((x-cx)/radius,(y-cy)/radiusY);if(distance>1)continue;const k=Math.min(1,(1-distance)/.18);const i=y*mask.width+x;data[i]=Math.round(data[i]*(1-k)+value*k);}}

  d.last=p;pendingMask.current={mask,apply:next=>{if(onMaskChange)onMaskChange(next);else useStudio.getState().updateSource(source.id,{[maskKind??(tool==='exclude'||tool==='restore'?'exclusionMask':'subjectMask')]:next},false);}};if(maskFrame.current===undefined)maskFrame.current=typeof requestAnimationFrame==='function'?requestAnimationFrame(flushMask):setTimeout(flushMask,16) as unknown as number;

 };

 const completePolygon=()=>{if(polygon.length<3)return;const key=maskKind??(tool==='exclude'||tool==='restore'?'exclusionMask':'subjectMask'),previous=source[key],width=previous?.width??512,height=previous?.height??Math.round(512*source.height/source.width),data=new Uint8Array(previous?.data??new Uint8Array(width*height).fill(255));

  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const px=x/width,py=y/height;let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>py)!==(b[1]>py)&&px<(b[0]-a[0])*(py-a[1])/(b[1]-a[1])+a[0])inside=!inside;}if(inside)data[y*width+x]=0;}

  if(onMaskChange){useStudio.getState().checkpoint();onMaskChange({width,height,data});}else useStudio.getState().updateSource(source.id,{[key]:{width,height,data}});setPolygon([]);

 };

 return <div ref={holder} className={`source-canvas tool-${tool}`}>

  <canvas ref={canvas} tabIndex={0} aria-label={`${source.name} ${showMask?'mask':'landmark'} editor`}

   onContextMenu={e=>{if(e.shiftKey)return;e.preventDefault();e.stopPropagation();onSourceMenu?.(source.id,e.clientX,e.clientY);}} onPointerLeave={()=>{if(!drag.current)setCursor(undefined);}}

   onPointerDown={e=>{if(e.button===2)return;e.preventDefault();if(!synthetic)useStudio.setState({selectedSource:source.id});if(e.altKey||e.button===1){e.preventDefault();e.stopPropagation();drag.current={start:[e.clientX,e.clientY],positions:[],pan};e.currentTarget.setPointerCapture(e.pointerId);return;}

    const p=position(e);setCursor(p);e.currentTarget.focus();

    if(p.some(v=>!Number.isFinite(v))||((tool==='add'||showMask||tool==='polygon')&&p.some(v=>v<0||v>1)))return;

    if(tool==='polygon'){setPolygon(v=>[...v,p]);return;}


    if(tool==='add'&&!synthetic){useStudio.getState().addPoint(source.id,p);return;}

    if(showMask){const key=maskKind??(tool==='exclude'||tool==='restore'?'exclusionMask':'subjectMask'),previous=source[key],width=previous?.width??512,height=previous?.height??Math.round(512*source.height/source.width);useStudio.getState().checkpoint();drag.current={start:p,positions:[],mask:{width,height,data:new Uint8Array(previous?.data??new Uint8Array(width*height).fill(255))}};paint(p);e.currentTarget.setPointerCapture(e.pointerId);return;}

    const t=transform.current;const candidates=source.landmarks.filter(l=>(l.enabled||l.autoDisabled||selected.includes(l.id))&&(selected.includes(l.id)||usesControl(template.points.find(d=>d.id===l.id)??{region:'outline'},recipe))&&(region==='all'||template.points.find(d=>d.id===l.id)?.region===region)).map(l=>({p:l,d:Math.hypot((l.x-p[0])*t.w,(l.y-p[1])*t.h)})).sort((a,b)=>a.d-b.d);const hit=candidates[0]?.d<13?candidates[0].p:undefined;

    if(hit){const selection=e.shiftKey?[...new Set([...selected,hit.id])]:selected.includes(hit.id)?selected:[hit.id];useStudio.getState().selectPoints(selection);useStudio.getState().checkpoint();drag.current={start:p,positions:source.landmarks.filter(l=>selection.includes(l.id)).map(l=>({...l}))};e.currentTarget.setPointerCapture(e.pointerId);}else{const base=e.shiftKey?selected:[];useStudio.getState().selectPoints(base);drag.current={start:p,positions:[],box:{base}};setBox([p,p]);e.currentTarget.setPointerCapture(e.pointerId);}

   }}

   onPointerMove={e=>{const p=position(e);setCursor(p);const d=drag.current;if(!d)return;if(d.pan){setPan([d.pan[0]+(e.clientX-d.start[0])/dimensions[0],d.pan[1]+(e.clientY-d.start[1])/dimensions[1]]);return;}if(d.box){setBox([d.start,p]);const ids=source.landmarks.filter(l=>(l.enabled||l.autoDisabled||d.box!.base.includes(l.id))&&(d.box!.base.includes(l.id)||usesControl(template.points.find(t=>t.id===l.id)??{region:'outline'},recipe))&&(region==='all'||template.points.find(t=>t.id===l.id)?.region===region)&&l.x>=Math.min(d.start[0],p[0])&&l.x<=Math.max(d.start[0],p[0])&&l.y>=Math.min(d.start[1],p[1])&&l.y<=Math.max(d.start[1],p[1])).map(l=>l.id);useStudio.getState().selectPoints([...new Set([...d.box.base,...ids])]);return;}if(d.mask){paint(p);return;}const updates:Record<string,Vec>={};for(const point of d.positions)if(!point.locked)updates[point.id]=[point.x+p[0]-d.start[0],point.y+p[1]-d.start[1]];useStudio.getState().movePoints(source.id,updates,false);}}

   onPointerUp={e=>{flushMask();setBox(undefined);drag.current=undefined;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{flushMask();setBox(undefined);drag.current=undefined;}} onLostPointerCapture={()=>{flushMask();setBox(undefined);drag.current=undefined;}}

   onDoubleClick={()=>{if(tool==='polygon')completePolygon();}}

   onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();useStudio.getState().selectPoints(source.landmarks.filter(p=>!p.locked).map(p=>p.id));}if(e.key==='Enter'&&tool==='polygon')completePolygon();if(e.key==='Escape'){setPolygon([]);}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&!showMask){e.preventDefault();const amount=(e.shiftKey?10:1)/source.width,updates:Record<string,Vec>={};for(const p of source.landmarks.filter(p=>selected.includes(p.id)&&!p.locked))updates[p.id]=[p.x+(e.key==='ArrowRight'?amount:e.key==='ArrowLeft'?-amount:0),p.y+(e.key==='ArrowDown'?amount*source.width/source.height:e.key==='ArrowUp'?-amount*source.width/source.height:0)];useStudio.getState().movePoints(source.id,updates);}}}/>

  {tool==='polygon'&&polygon.length>0&&<div className="canvas-action"><button disabled={polygon.length<3} onClick={completePolygon}>Remove polygon area</button><button onClick={()=>setPolygon([])}>Cancel polygon</button></div>}


 </div>;

}
