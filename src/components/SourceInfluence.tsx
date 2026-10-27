import {useEffect,useRef,useState} from 'react';
import {useStudio} from '../store';
import type {Source} from '../types';

export function SourceInfluence({source,value,editing,onEdit,onDone}:{source:Source;value:number;editing:boolean;onEdit:()=>void;onDone:()=>void}){
 const input=useRef<HTMLInputElement>(null),[text,setText]=useState(String(value)),done=useRef(false);
 useEffect(()=>{if(editing){done.current=false;setText(String(value));input.current?.focus();input.current?.select();}},[editing]);
 const finish=(save:boolean)=>{if(done.current)return;done.current=true;if(save&&text.trim()&&Number.isFinite(Number(text))){const state=useStudio.getState();state.setWeight(source.id,Number(text),state.project.recipe.linked?'both':'appearance');}onDone();};
 return editing?<input ref={input} className="source-percentage-input" aria-label={`${source.name} influence percentage`} type="number" min={0} max={100} step={.1} value={text} onClick={e=>e.stopPropagation()} onChange={e=>setText(e.target.value)} onBlur={()=>finish(true)} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')finish(true);if(e.key==='Escape')finish(false);}}/>:<button className="source-percentage" aria-label={`${source.name} influence value`} title="Edit influence" disabled={source.weightLocked||!source.enabled} onClick={e=>{e.stopPropagation();onEdit();}} onDoubleClick={e=>{e.stopPropagation();onEdit();}} onKeyDown={e=>{if(e.key==='Enter'||e.key==='F2'){e.preventDefault();onEdit();}}}>{value}%</button>;
}
