import {useEffect,useRef,useState} from 'react';
import {useStudio} from '../store';
import type {Source} from '../types';

/** The label becomes an input only during a rename. Source IDs never change. */
export function SourceName({source,editing,onEdit,onDone}:{source:Source;editing:boolean;onEdit:()=>void;onDone:()=>void}){
 const [value,setValue]=useState(source.name),input=useRef<HTMLInputElement>(null),cancelled=useRef(false);
 useEffect(()=>{if(editing){setValue(source.name);cancelled.current=false;input.current?.focus();input.current?.select();}},[editing]);
 const commit=()=>{if(!cancelled.current){const name=value.trim().slice(0,120);if(name&&name!==source.name)useStudio.getState().updateSource(source.id,{name});}onDone();};
 return editing?<input ref={input} className="source-rename" aria-label={`Rename ${source.name}`} value={value} maxLength={120} onClick={e=>e.stopPropagation()} onChange={e=>setValue(e.target.value)} onBlur={commit} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')commit();if(e.key==='Escape'){cancelled.current=true;onDone();}}}/>:<span className="source-name-label" tabIndex={0} title={`${source.name}. Double-click to rename.`} onDoubleClick={e=>{e.stopPropagation();onEdit();}} onKeyDown={e=>{if(e.key==='F2'){e.preventDefault();onEdit();}}}>{source.name}</span>;
}
