import {useLayoutEffect,useRef,useState} from 'react';
export function EditableName({name,editing,onEdit,onDone,onSave}:{name:string;editing:boolean;onEdit:()=>void;onDone:()=>void;onSave:(value:string)=>void}){
 const [value,setValue]=useState(name),input=useRef<HTMLInputElement>(null),cancelled=useRef(false);
 useLayoutEffect(()=>{if(editing){cancelled.current=false;setValue(name);input.current?.select();}},[editing,name]);
 const finish=()=>{if(cancelled.current)return;cancelled.current=true;if(value.trim()&&value.trim()!==name)onSave(value.trim());onDone();};
 return editing?<input autoFocus ref={input} className="inline-name" aria-label={`Rename ${name}`} value={value} onChange={e=>setValue(e.target.value)} onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} onBlur={finish} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')finish();if(e.key==='Escape'){cancelled.current=true;onDone();}}}/>:<span className="editable-name" onDoubleClick={e=>{e.stopPropagation();onEdit();}}>{name}</span>;
}
