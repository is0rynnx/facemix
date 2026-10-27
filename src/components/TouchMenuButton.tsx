import {MoreHorizontal} from 'lucide-react';

export function TouchMenuButton({label,onOpen,className=''}:{label:string;onOpen:(x:number,y:number)=>void;className?:string}){
 return <button type="button" className={`touch-menu-button ${className}`} aria-label={label} title={label} aria-haspopup="menu" onKeyDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();const rect=e.currentTarget.getBoundingClientRect();onOpen(rect.left,rect.bottom+4);}}><MoreHorizontal size={16}/></button>;
}
