// @vitest-environment jsdom
import {useState} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {FaceLibrary} from '../src/components/FaceLibrary';
import {FaceChooser} from '../src/components/FaceChooser';
import {Changelog} from '../src/components/Changelog';
import {chooseFace,cancelFaceChoices} from '../src/face-selection';
import {importLibraryEntries} from '../src/services';
import {useLibrary} from '../src/library';
import {newProject,useStudio} from '../src/store';
vi.mock('../src/services',()=>({importLibraryEntries:vi.fn()}));
const faces=[{bounds:[.1,.1,.4,.6]},{bounds:[.6,.1,.9,.6]}] as any;
function Flow(){const [open,setOpen]=useState(true);return <>{open&&<FaceLibrary onClose={()=>setOpen(false)}/>}<FaceChooser/></>;}
beforeEach(()=>{
 localStorage.clear();vi.clearAllMocks();
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 useStudio.setState({project:newProject(),past:[],future:[],busy:false});
 useLibrary.setState({loaded:true,error:'',past:[],clipboard:undefined,load:async()=>{},data:{version:1,collections:[],entries:[{id:'group',name:'Group photo',collections:[]}]}});
});
afterEach(()=>{cleanup();cancelFaceChoices();vi.unstubAllGlobals();});
it.each(['desktop','phone'])('closes the library before face selection and focuses the picker on %s',async device=>{
 Object.defineProperty(window,'innerWidth',{configurable:true,value:device==='phone'?390:1280});
 const selected=vi.fn();vi.mocked(importLibraryEntries).mockImplementation(async()=>{selected(await chooseFace('Group photo','blob:group',faces));});
 render(<Flow/>);fireEvent.click(screen.getByRole('checkbox',{name:'Toggle Group photo'}));fireEvent.click(screen.getByRole('button',{name:'Add to mix',exact:true}));
 expect(screen.queryByRole('dialog',{name:/Face library/})).toBeNull();const picker=await screen.findByRole('dialog',{name:'Choose a face'});
 expect(picker.contains(document.activeElement)).toBe(true);expect(picker.parentElement?.classList.contains('face-picker-backdrop')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Face 2',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Use face',exact:true}));
 await waitFor(()=>expect(selected).toHaveBeenCalledWith({index:1,crop:false}));expect(screen.queryByRole('dialog')).toBeNull();
});
it('can skip automatic placement without reopening the library',async()=>{
 const selected=vi.fn();vi.mocked(importLibraryEntries).mockImplementation(async()=>{selected(await chooseFace('Group photo','blob:group',faces));});
 render(<Flow/>);fireEvent.click(screen.getByRole('checkbox',{name:'Toggle Group photo'}));fireEvent.click(screen.getByRole('button',{name:'Add to mix',exact:true}));
 fireEvent.click(await screen.findByRole('button',{name:'Place manually',exact:true}));await waitFor(()=>expect(selected).toHaveBeenCalledWith(null));expect(screen.queryByRole('dialog')).toBeNull();
});
it('reports an import failure after closing the library',async()=>{
 const notify=vi.spyOn(useStudio.getState(),'notify');vi.mocked(importLibraryEntries).mockRejectedValue(Error('Photo unavailable'));
 render(<Flow/>);fireEvent.click(screen.getByRole('checkbox',{name:'Toggle Group photo'}));fireEvent.click(screen.getByRole('button',{name:'Add to mix',exact:true}));
 await waitFor(()=>expect(notify).toHaveBeenCalledWith('Error: Photo unavailable'));expect(screen.queryByRole('dialog')).toBeNull();notify.mockRestore();
});
it('keeps release history collapsed and includes every published checkpoint',()=>{
 const {container}=render(<Changelog/>);const details=container.querySelector('details')!;expect(details.open).toBe(false);
 fireEvent.click(screen.getByText('Changelog'));expect(details.open).toBe(true);
 expect(container.querySelectorAll('ol>li')).toHaveLength(10);expect(container.textContent).toContain('1.7.0');expect(container.textContent).toContain('1.6.1');
 for(const commit of ['2969283','52c3ae5','2157ddd','1747809','b44b5f7','f3bfbdb','1c130c3','c464e65'])expect(container.textContent).toContain(commit);
});
