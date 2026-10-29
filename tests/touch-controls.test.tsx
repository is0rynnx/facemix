// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import App from '../src/App';
import {FaceLibrary} from '../src/components/FaceLibrary';
import {SourceCanvas} from '../src/components/SourceCanvas';
import {autosave,registerAsset} from '../src/data';
import {useLibrary} from '../src/library';
import {settledSaves} from '../src/session';
import {newProject,useStudio} from '../src/store';
import {regionDefaults,type Source} from '../src/types';

const initialWidth=window.innerWidth;
vi.setConfig({testTimeout:15000});
beforeAll(()=>{
 vi.stubGlobal('ResizeObserver',class{constructor(private cb:any){}observe(){this.cb([{contentRect:{width:400,height:500}}]);}disconnect(){}});
 vi.stubGlobal('Worker',class{postMessage(){}terminate(){}});
 vi.stubGlobal('ImageData',class{constructor(public data:any,public width:number,public height:number){}});
 vi.stubGlobal('PointerEvent',MouseEvent);
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({local:true})})));
 URL.createObjectURL=()=>`blob:test-${crypto.randomUUID()}`;URL.revokeObjectURL=()=>{};
 HTMLCanvasElement.prototype.getContext=()=>new Proxy({getImageData:()=>({data:new Uint8ClampedArray(16)})},{get:(target:any,key)=>target[key]??(()=>{})}) as any;
 HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,dGVzdA==';
 HTMLCanvasElement.prototype.setPointerCapture=()=>{};HTMLCanvasElement.prototype.hasPointerCapture=()=>false;
});
beforeEach(async()=>{
 await settledSaves();localStorage.clear();
 Object.defineProperty(window,'innerWidth',{configurable:true,value:390});
 const project=newProject();
 project.sources=['A','B','C'].map((name,i)=>({id:`touch-${i}`,name:`Source ${name}`,width:800,height:1000,enabled:true,shapeWeight:[60,30,10][i],appearanceWeight:[60,30,10][i],weightLocked:false,regionWeights:regionDefaults(),status:'ready',landmarks:project.template.points.map(p=>({id:p.id,x:p.reference[0],y:p.reference[1],enabled:true,locked:false,authored:true,confidence:1}))} as Source));
 for(const source of project.sources)registerAsset(source.id,new Blob(['test']));
 await autosave(project);
 useStudio.setState({project:newProject(),past:[],future:[],selectedSource:'',selectedPoints:[],workspace:'mix',inspector:'mix',isolatedSource:'',busy:false,inspectSource:'',compareVariant:''});
 useLibrary.setState({loaded:true,error:'',past:[],clipboard:undefined,load:async()=>{},data:{version:1,collections:[{id:'a',name:'Folder A'},{id:'b',name:'Folder B'}],entries:[{id:'1',name:'Photo 1',collections:['a']},{id:'2',name:'Photo 2',collections:['a']}]}});
});
afterEach(()=>{cleanup();Object.defineProperty(window,'innerWidth',{configurable:true,value:initialWidth});});
async function open(){render(<App/>);await screen.findByRole('spinbutton',{name:'Source A appearance percentage'});}

it('shows the active isolate state for toolbar and source menu actions',async()=>{
 await open();const isolate=screen.getByRole('button',{name:'Isolate selected',exact:true});
 expect(isolate.getAttribute('aria-pressed')).toBe('false');
 fireEvent.click(isolate);const restore=screen.getByRole('button',{name:'Restore mix',exact:true});
 expect(restore.getAttribute('aria-pressed')).toBe('true');expect(restore.classList.contains('active')).toBe(true);
 fireEvent.click(restore);expect(screen.getByRole('button',{name:'Isolate selected',exact:true}).getAttribute('aria-pressed')).toBe('false');
 fireEvent.click(screen.getByRole('button',{name:'Source actions for Source B',exact:true}));fireEvent.click(screen.getByRole('menuitem',{name:'Isolate selected',exact:true}));
 expect(useStudio.getState().isolatedSource).toBe('touch-1');expect(screen.getByRole('button',{name:'Restore mix',exact:true}).classList.contains('active')).toBe(true);
});
it('collapses Shape sections without resetting edited values',async()=>{
 await open();fireEvent.click(screen.getByRole('button',{name:'Shape',exact:true}));
 const eyes=screen.getByText('Eyes',{selector:'summary'}),group=eyes.closest('details')!;
 expect(group.open).toBe(false);fireEvent.click(eyes);expect(group.open).toBe(true);
 fireEvent.change(screen.getByRole('slider',{name:'Eye size',exact:true}),{target:{value:'12'}});
 fireEvent.click(eyes);expect(group.open).toBe(false);expect(useStudio.getState().project.recipe.faceEdits?.eyeSize).toBe(12);
 fireEvent.click(eyes);expect((screen.getByRole('spinbutton',{name:'Eye size value',exact:true}) as HTMLInputElement).value).toBe('12');
});
it('keeps photo names and selection when changing library views and screen width',()=>{
 const name='A long photo name for the mobile library';
 useLibrary.setState(s=>({data:{...s.data,entries:s.data.entries.map((entry,i)=>i===0?{...entry,name}:entry)}}));
 render(<FaceLibrary onClose={()=>{}}/>);fireEvent.click(screen.getByRole('checkbox',{name:`Toggle ${name}`}));
 fireEvent.click(screen.getByRole('button',{name:'Library view',exact:true}));fireEvent.click(screen.getByRole('menuitem',{name:'List',exact:true}));
 expect(screen.getByRole('button',{name:`Deselect ${name}`,exact:true})).toBeTruthy();
 Object.defineProperty(window,'innerWidth',{configurable:true,value:1024});fireEvent(window,new Event('resize'));
 expect(screen.getByRole('status').textContent).toBe('1 selected');
 fireEvent.click(screen.getByRole('button',{name:`Photo actions for ${name}`,exact:true}));fireEvent.click(screen.getByRole('menuitem',{name:'Rename',exact:true}));
 const input=screen.getByLabelText(`Rename ${name}`);fireEvent.change(input,{target:{value:'Updated library photo name'}});fireEvent.keyDown(input,{key:'Enter'});
 expect(useLibrary.getState().data.entries[0].name).toBe('Updated library photo name');expect(screen.getByRole('status').textContent).toBe('1 selected');
});
it('opens source and result menus by tap, and makes menu edits visible on a phone',async()=>{
 await open();fireEvent.click(screen.getByRole('button',{name:'Points',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Photo actions for Source A'}));
 fireEvent.click(screen.getByRole('menuitem',{name:'Rename',exact:true}));
 expect(document.querySelector('.studio-body')?.getAttribute('data-panel')).toBe('sources');
 const rename=screen.getByLabelText('Rename Source A');expect(document.activeElement).toBe(rename);
 fireEvent.change(rename,{target:{value:'Renamed'}});fireEvent.keyDown(rename,{key:'Enter'});
 expect(useStudio.getState().project.sources[0].name).toBe('Renamed');
 fireEvent.click(screen.getByRole('button',{name:'Close side panel'}));
 fireEvent.click(screen.getByRole('button',{name:'Photo actions for Renamed'}));
 fireEvent.click(screen.getByRole('menuitem',{name:'Edit influence'}));
 expect(document.querySelector('.studio-body')?.getAttribute('data-panel')).toBe('sources');
 const value=screen.getByLabelText('Renamed influence percentage');fireEvent.change(value,{target:{value:'50'}});fireEvent.keyDown(value,{key:'Enter'});
 expect(useStudio.getState().project.sources[0].appearanceWeight).toBe(50);
 fireEvent.click(screen.getByRole('button',{name:'Close side panel'}));
 fireEvent.click(screen.getByRole('button',{name:'Result actions'}));
 expect(screen.getByRole('menuitem',{name:'Use as source'})).toBeTruthy();expect(screen.queryByRole('menuitem',{name:'Remove face'})).toBeNull();
 fireEvent.keyDown(screen.getByRole('menu'),{key:'Escape'});expect(screen.queryByRole('menu')).toBeNull();
});
it('edits influence with one tap and equalizes unlocked sources from Properties with Undo',async()=>{
 await open();fireEvent.click(screen.getByRole('button',{name:'Sources',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Source B influence value'}));
 expect(document.querySelector('.studio-body')?.getAttribute('data-panel')).toBe('sources');
 const input=screen.getByLabelText('Source B influence percentage');fireEvent.change(input,{target:{value:'20'}});fireEvent.keyDown(input,{key:'Enter'});
 expect(useStudio.getState().project.sources[1].appearanceWeight).toBe(20);
 act(()=>useStudio.getState().updateSource('touch-0',{weightLocked:true}));
 const before=structuredClone(useStudio.getState().project.sources);
 fireEvent.click(screen.getByRole('button',{name:'Properties',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Equalize source weights'}));
 const after=useStudio.getState().project.sources;expect(after[0]).toEqual(before[0]);expect(after[1].appearanceWeight).toBeCloseTo(after[2].appearanceWeight);expect(after[1].shapeWeight).toBeCloseTo(after[2].shapeWeight);
 expect(after.reduce((sum,s)=>sum+s.appearanceWeight,0)).toBeCloseTo(100);
 expect(document.querySelector('.source-actions')?.textContent).not.toContain('Remove');
 fireEvent.click(screen.getByRole('button',{name:'Undo (Ctrl Z)'}));expect(useStudio.getState().project.sources).toEqual(before);
});
it('keeps a selected photo group in tap menus and pastes it through a folder menu',async()=>{
 render(<FaceLibrary onClose={()=>{}}/>);
 fireEvent.click(screen.getByRole('checkbox',{name:'Toggle Photo 1'}));fireEvent.click(screen.getByRole('checkbox',{name:'Toggle Photo 2'}));
 fireEvent.click(screen.getByRole('button',{name:'Photo actions for Photo 1'}));
 expect(screen.getByRole('status').textContent).toBe('2 selected');expect((screen.getByRole('menuitem',{name:'Rename'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('menuitem',{name:'Copy'}));
 fireEvent.click(screen.getByRole('button',{name:'Folder actions for Folder B'}));fireEvent.click(screen.getByRole('menuitem',{name:'Paste'}));
 await waitFor(()=>expect(useLibrary.getState().data.entries.every(e=>e.collections.includes('b'))).toBe(true));
 fireEvent.click(screen.getByRole('button',{name:'Library actions'}));expect(screen.getByRole('menuitem',{name:'New folder'})).toBeTruthy();
});
it('cancels a polygon by tap without changing the mask and applies a completed outline',()=>{
 const source:Source={id:'polygon',name:'Mask photo',width:800,height:1000,enabled:true,shapeWeight:100,appearanceWeight:100,weightLocked:false,regionWeights:regionDefaults(),status:'manual',landmarks:[],subjectMask:{width:40,height:50,data:new Uint8Array(2000).fill(255)}};
 useStudio.setState({project:{...newProject(),sources:[source]}});
 const update=vi.fn(),view=render(<SourceCanvas source={source} zoom={1} pan={[0,0]} tool="polygon" brush={.1} showMask showLabels={false} showLines={false} onMaskChange={update}/>);
 const canvas=screen.getByLabelText('Mask photo mask editor');canvas.getBoundingClientRect=()=>({left:0,top:0,width:400,height:500,right:400,bottom:500,x:0,y:0,toJSON:()=>{}});
 fireEvent.pointerDown(canvas,{button:0,clientX:100,clientY:100});expect((screen.getByRole('button',{name:'Remove polygon area'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Cancel polygon'}));expect(update).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Cancel polygon'})).toBeNull();
 for(const [x,y] of [[100,100],[300,100],[200,350]])fireEvent.pointerDown(canvas,{button:0,clientX:x,clientY:y});
 fireEvent.click(screen.getByRole('button',{name:'Remove polygon area'}));expect(update).toHaveBeenCalledOnce();expect(update.mock.calls[0][0].data[20*40+20]).toBe(0);
 fireEvent.pointerDown(canvas,{button:0,clientX:100,clientY:100});view.rerender(<SourceCanvas source={source} zoom={1} tool="background" brush={.1} showMask showLabels={false} showLines={false}/>);expect(screen.queryByRole('button',{name:'Cancel polygon'})).toBeNull();
});
it('does not offer automatic recovery snapshots in the project menu',async()=>{
 await open();
 const project=useStudio.getState().project;
 act(()=>useStudio.setState({project:{...project,variants:[{id:'old-recovery',kind:'recovery',name:'Control layout backup',created:1,sources:project.sources,recipe:project.recipe}]}}));
 fireEvent.click(screen.getByRole('button',{name:project.name,exact:true}));
 expect(screen.queryByText(/Recovery snapshots/)).toBeNull();
 expect(screen.queryByText('Control layout backup')).toBeNull();
 expect(useStudio.getState().project.variants[0].id).toBe('old-recovery');
});
