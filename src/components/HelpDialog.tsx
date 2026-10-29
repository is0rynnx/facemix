import {Changelog} from './Changelog';
import {useEffect,useRef} from 'react';
import {Github,X} from 'lucide-react';

export function HelpDialog({onClose}:{onClose:()=>void}){
 const dialog=useRef<HTMLDivElement>(null);
 useEffect(()=>{const before=document.activeElement as HTMLElement|null;dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>before?.focus();},[]);
 return <div className="modal-backdrop" onClick={onClose}><div ref={dialog} className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e=>e.stopPropagation()} onKeyDown={e=>{
  e.stopPropagation();if(e.key==='Escape'){e.preventDefault();onClose();}
  if(e.key==='Tab'){const controls=[...dialog.current!.querySelectorAll<HTMLElement>('button,a,summary')].filter(el=>el.getClientRects().length),first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
 }}>
  <div className="dialog-heading"><h2 id="help-title">FaceMix Help</h2><button className="icon-button" aria-label="Close help" title="Close help" onClick={onClose}><X size={18}/></button></div>
  <dl className="help-topics">
   <div><dt>Photos</dt><dd>Add up to 30 photos. Use Add photos, Face library, or Paste photo. On touch screens, tap the three-dot button for more actions.</dd></div>
   <div><dt>Landmarks</dt><dd>Place matching points on the same feature in each photo. Drag a source point to correct it. Drag a result point to change the output shape. Check covered features before use.</dd></div>
   <div><dt>Mix and Regions</dt><dd>Set each source weight in Mix. Use Regions to set separate texture and shape weights. Shape requires active matching points in that region.</dd></div>
   <div><dt>Masks</dt><dd>Subject removes the background. Source contribution excludes pixels from one photo. Feature area sets a region in the result. Use Keep, Remove, or Polygon to edit the selected mask. Use Selection feather to soften a contribution edge.</dd></div>
   <div><dt>Save and export</dt><dd>Save variant stores a mix in this project. Save project downloads a project file. Export mix saves a PNG. Wait for “Saved on this device” before closing the page. Browser storage is not a backup.</dd></div>
  </dl>
  <p>Photos are processed in your browser. FaceMix does not upload your photos.</p>
  <details className="help-shortcuts"><summary>Keyboard and touch controls</summary><div className="shortcuts-grid">{[
   ['Ctrl / Cmd + V','Paste a photo'],['V','Move points'],['A','Add a matching point'],['B','Open masks'],['Arrow keys','Move selected points'],['Shift + arrows','Move 10 pixels'],['Ctrl / Cmd + Z','Undo'],['Ctrl / Cmd + Shift + Z','Redo'],['Ctrl / Cmd + S','Save project file'],['Pinch / scroll','Zoom view'],['Shift + scroll / middle drag','Pan view'],['0','Fit views'],['? / F1','Help']
  ].map(([key,value])=><div key={key}><kbd>{key}</kbd><span>{value}</span></div>)}</div></details>
  <Changelog/>
  <footer className="help-footer"><span>By is0rynnx</span><a className="help-project" href="https://github.com/is0rynnx/facemix" target="_blank" rel="noopener noreferrer" aria-label="FaceMix on GitHub" title="FaceMix on GitHub"><Github size={20}/></a></footer>
 </div></div>;
}
