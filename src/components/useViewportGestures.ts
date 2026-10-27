import {useEffect,useRef} from 'react';
import type {RefObject} from 'react';
import type {Vec} from '../types';

export function zoomAt(zoom:number,pan:Vec,next:number,anchor:Vec):Vec {
 const ratio=next/zoom;
 return [anchor[0]-(anchor[0]-pan[0])*ratio,anchor[1]-(anchor[1]-pan[1])*ratio];
}

/** Wheel values are CSS pixels. Pinch produces Ctrl-wheel in Chrome and Edge. */
export function useViewportGestures(ref:RefObject<HTMLElement|null>,zoom:number,pan:Vec,onZoom?: (n:number)=>void,onPan?: (p:Vec)=>void,onGestureStart?:()=>void){
 const latest=useRef({zoom,pan,onZoom,onPan,onGestureStart});latest.current={zoom,pan,onZoom,onPan,onGestureStart};
 useEffect(()=>{const node=ref.current;if(!node)return;
  const wheel=(e:WheelEvent)=>{const s=latest.current;if(!s.onZoom&&!s.onPan)return;e.preventDefault();e.stopPropagation();const r=node.getBoundingClientRect();if(!r.width||!r.height)return;const unit=e.deltaMode===1?16:e.deltaMode===2?r.height:1;
   if(e.shiftKey&&!e.ctrlKey&&!e.metaKey)s.onPan?.([s.pan[0]-e.deltaX*unit/r.width,s.pan[1]-e.deltaY*unit/r.height]);
   else{if(!s.onZoom)return;const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY,next=Math.max(.5,Math.min(8,s.zoom*Math.exp(-delta*unit*((e.ctrlKey||e.metaKey)?.008:.003))));s.onPan?.(zoomAt(s.zoom,s.pan,next,[(e.clientX-r.left)/r.width-.5,(e.clientY-r.top)/r.height-.5]));s.onZoom(next);}
  };
  const touches=new Map<number,Vec>();
  let gesture:{distance:number;zoom:number;pan:Vec;center:Vec}|undefined;
  const pair=()=>{const [a,b]=[...touches.values()];return {distance:Math.hypot(b[0]-a[0],b[1]-a[1]),center:[(a[0]+b[0])/2,(a[1]+b[1])/2] as Vec};};
  const down=(e:PointerEvent)=>{if(e.pointerType!=='touch')return;touches.set(e.pointerId,[e.clientX,e.clientY]);if(touches.size>=2){if(touches.size===2){const s=latest.current;gesture={...pair(),zoom:s.zoom,pan:s.pan};s.onGestureStart?.();}node.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();}};
  const move=(e:PointerEvent)=>{if(!touches.has(e.pointerId))return;touches.set(e.pointerId,[e.clientX,e.clientY]);if(!gesture)return;e.preventDefault();e.stopPropagation();if(touches.size!==2)return;const r=node.getBoundingClientRect();if(!r.width||!r.height||!gesture.distance)return;const nextPair=pair(),next=Math.max(.5,Math.min(8,gesture.zoom*nextPair.distance/gesture.distance)),p=zoomAt(gesture.zoom,gesture.pan,next,[(gesture.center[0]-r.left)/r.width-.5,(gesture.center[1]-r.top)/r.height-.5]);latest.current.onPan?.([p[0]+(nextPair.center[0]-gesture.center[0])/r.width,p[1]+(nextPair.center[1]-gesture.center[1])/r.height]);latest.current.onZoom?.(next);};
  const up=(e:PointerEvent)=>{touches.delete(e.pointerId);if(gesture){e.preventDefault();e.stopPropagation();if(node.hasPointerCapture(e.pointerId))node.releasePointerCapture(e.pointerId);if(!touches.size)gesture=undefined;}};
  node.addEventListener('wheel',wheel,{passive:false});node.addEventListener('pointerdown',down,true);node.addEventListener('pointermove',move,true);node.addEventListener('pointerup',up,true);node.addEventListener('pointercancel',up,true);
  return()=>{node.removeEventListener('wheel',wheel);node.removeEventListener('pointerdown',down,true);node.removeEventListener('pointermove',move,true);node.removeEventListener('pointerup',up,true);node.removeEventListener('pointercancel',up,true);};
 },[ref]);
}
