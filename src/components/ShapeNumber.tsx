import {useEffect,useRef,useState} from 'react';

/** Keep incomplete numeric input local so the user can type a minus sign or clear it. */
export function ShapeNumber({id,label,value,onStart,onChange,disabled=false}:{id:string;label:string;value:number;onStart:()=>void;onChange:(n:number)=>void;disabled?:boolean}){
 const [text,setText]=useState(String(value)),focused=useRef(false);
 useEffect(()=>{if(!focused.current)setText(String(value));},[value]);
 return <input id={id} aria-label={`${label} value`} type="number" disabled={disabled} min={-100} max={100} step={1} value={text} onFocus={()=>{focused.current=true;onStart();}} onChange={e=>{const next=e.target.value;setText(next);if(next!==''&&Number.isFinite(Number(next)))onChange(Math.max(-100,Math.min(100,Number(next))));}} onBlur={()=>{focused.current=false;setText(String(value));}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>;
}
