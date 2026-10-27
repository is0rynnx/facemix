import {useEffect,useRef,useState} from 'react';

import type {ReactNode} from 'react';

import type {Vec} from '../types';

import {useViewportGestures} from './useViewportGestures';

export function ImageViewport({aspect,zoom,pan,onZoom,onPan,children,className=''}:{aspect:number;zoom:number;pan:Vec;onZoom?:(n:number)=>void;onPan?:(p:Vec)=>void;children:ReactNode;className?:string}){

 const host=useRef<HTMLDivElement>(null),[size,setSize]=useState([300,400]),drag=useRef<{x:number;y:number;pan:Vec}|undefined>(undefined);

 useEffect(()=>{const o=new ResizeObserver(([e])=>setSize([e.contentRect.width,e.contentRect.height]));if(host.current)o.observe(host.current);return()=>o.disconnect();},[]);

 useViewportGestures(host,zoom,pan,onZoom,onPan,()=>{drag.current=undefined;});

 const w=Math.min(size[0],size[1]*aspect),h=w/aspect;

 return <div className="result-viewport" ref={host} aria-label="Result view" onPointerDown={e=>{if(onPan&&(e.altKey||e.button===1)){e.preventDefault();drag.current={x:e.clientX,y:e.clientY,pan};e.currentTarget.setPointerCapture(e.pointerId);}}} onPointerMove={e=>{const d=drag.current;if(d)onPan?.([d.pan[0]+(e.clientX-d.x)/size[0],d.pan[1]+(e.clientY-d.y)/size[1]]);}} onPointerUp={e=>{drag.current=undefined;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{drag.current=undefined;}} onLostPointerCapture={()=>{drag.current=undefined;}}><div className={`result-frame ${className}`} style={{width:w,height:h,transform:`translate(${pan[0]*size[0]}px, ${pan[1]*size[1]}px) scale(${zoom})`}}>{children}</div></div>;

}
