import {useEffect,useRef,useState} from 'react';
import {Check,X} from 'lucide-react';
import {finishFaceChoice,useFaceSelection} from '../face-selection';

export function FaceChooser(){const request=useFaceSelection(s=>s.request);return request?<FaceDialog key={request.url} request={request}/>:null;}
function FaceDialog({request}:{request:NonNullable<ReturnType<typeof useFaceSelection.getState>['request']>}){
 const [selected,setSelected]=useState(0),dialog=useRef<HTMLDivElement>(null);
 useEffect(()=>{const prior=document.activeElement as HTMLElement;dialog.current?.querySelector<HTMLButtonElement>('.face-choice')?.focus();return()=>prior?.focus?.();},[]);
 return <div className="modal-backdrop"><div ref={dialog} className="face-dialog" role="dialog" aria-modal="true" aria-labelledby="face-choice-title" data-modal="face-picker" onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')finishFaceChoice(null);if(e.key==='Tab'){const nodes=Array.from(dialog.current!.querySelectorAll<HTMLElement>('button,input'));if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}}}}>
  <header><div><h2 id="face-choice-title">Choose a face</h2><p>{request.name}</p></div><button className="icon-button" aria-label="Use manual placement" onClick={()=>finishFaceChoice(null)}><X/></button></header>
  <div className="face-choice-photo"><img src={request.url} alt="Photo with detected faces"/>{request.faces.map((face,i)=>{const [x,y,right,bottom]=face.bounds;return <button key={i} className={`face-choice ${selected===i?'active':''}`} aria-label={`Face ${i+1}`} aria-pressed={selected===i} style={{left:`${x*100}%`,top:`${y*100}%`,width:`${(right-x)*100}%`,height:`${(bottom-y)*100}%`}} onClick={()=>setSelected(i)}><span>{i+1}{selected===i&&<Check/>}</span></button>;})}</div>
  <footer><span>Use the selected face in the full photo.</span><div><button className="secondary" onClick={()=>finishFaceChoice(null)}>Place manually</button><button className="primary" onClick={()=>finishFaceChoice({index:selected,crop:false})}>Use face</button></div></footer>
 </div></div>;
}
