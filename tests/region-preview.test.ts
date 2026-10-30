// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {RegionPreviewManager} from '../src/region-preview-manager';
import {defaultRecipe,type RenderSpec} from '../src/types';

class FakeWorker {
 onmessage?: (event:any)=>void;
 onerror?: (event:any)=>void;
 onmessageerror?: (event:any)=>void;
 messages:any[]=[];
 postMessage=vi.fn((message:any)=>{this.messages.push(message);});
 terminate=vi.fn();
 emit(data:any){this.onmessage?.({data});}
 fail(){this.onerror?.({preventDefault:vi.fn()});}
 result(id=this.messages.at(-1).id){return {type:'result',id,width:2,height:2,data:new Uint8ClampedArray(16)};}
}
const spec=(revision=1):RenderSpec=>({revision,sources:[],template:{points:[]} as any,recipe:defaultRecipe(),size:256,quality:'preview'});
let manager:RegionPreviewManager,workers:FakeWorker[],result:ReturnType<typeof vi.fn>,error:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 vi.useFakeTimers();workers=[];result=vi.fn();error=vi.fn();
 manager=new RegionPreviewManager(()=>{const worker=new FakeWorker();workers.push(worker);return worker as unknown as Worker;});manager.onResult=result;manager.onError=error;
});
afterEach(()=>{manager.dispose();vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();history.replaceState(null,'','/');});

it('waits for readiness, coalesces rapid changes, and displays only the newest selection',()=>{
 manager.preview(spec(),'hair');manager.preview(spec(2),'ears');expect(workers[0].messages).toHaveLength(0);
 workers[0].emit({type:'ready'});expect(workers[0].messages.map(m=>m.region)).toEqual(['ears']);
 for(let i=3;i<=50;i++)manager.preview(spec(i),i===50?'clothing':'neck');
 const stale=workers[0].result();workers[0].emit(stale);expect(result).not.toHaveBeenCalled();
 expect(workers[0].messages).toHaveLength(2);expect(workers[0].messages[1]).toMatchObject({id:50,region:'clothing',spec:{revision:50}});
 workers[0].emit(stale);expect(result).not.toHaveBeenCalled();expect(workers[0].messages).toHaveLength(2);
 const final=workers[0].result();workers[0].emit(final);expect(result).toHaveBeenCalledExactlyOnceWith(final);expect(vi.getTimerCount()).toBe(0);
});
it('restarts a failed worker once with the newest request and ignores the old worker',()=>{
 manager.preview(spec(),'hair');workers[0].emit({type:'ready'});const stale=workers[0].result();workers[0].fail();
 manager.preview(spec(2),'neck');vi.advanceTimersByTime(100);expect(workers).toHaveLength(2);expect(workers[0].terminate).toHaveBeenCalledOnce();
 workers[0].emit(stale);workers[0].fail();expect(result).not.toHaveBeenCalled();expect(workers[1].terminate).not.toHaveBeenCalled();
 workers[1].emit({type:'ready'});expect(workers[1].messages[0]).toMatchObject({region:'neck',spec:{revision:2}});
 workers[1].emit(workers[1].result());expect(result).toHaveBeenCalledOnce();expect(error).not.toHaveBeenCalled();
});
it('bounds startup failures and permits a later explicit selection to retry',()=>{
 manager.preview(spec(),'hair');vi.advanceTimersByTime(30100);expect(workers).toHaveLength(2);expect(error).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
 manager.preview(spec(),'ears');expect(workers).toHaveLength(3);workers[2].emit({type:'ready'});workers[2].emit(workers[2].result());expect(result).toHaveBeenCalledOnce();
});
it('terminates a stalled computation without allowing queued slider changes to extend its deadline',()=>{
 manager.preview(spec(),'hair');workers[0].emit({type:'ready'});vi.advanceTimersByTime(40000);manager.preview(spec(2),'neck');
 vi.advanceTimersByTime(5100);expect(workers[0].terminate).toHaveBeenCalledOnce();workers[1].emit({type:'ready'});
 expect(workers[1].messages[0].spec.revision).toBe(2);vi.advanceTimersByTime(45000);expect(error).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it.each(['onmessageerror','invalid','reported'] as const)('recovers from %s errors',kind=>{
 manager.preview(spec(),'hair');workers[0].emit({type:'ready'});
 if(kind==='onmessageerror')workers[0].onmessageerror?.({});
 else workers[0].emit(kind==='reported'?{type:'error',id:1,error:'Cannot calculate'}:{...workers[0].result(),data:new Uint8ClampedArray(1)});
 vi.advanceTimersByTime(100);expect(workers).toHaveLength(2);workers[1].emit({type:'ready'});workers[1].emit(workers[1].result());expect(result).toHaveBeenCalledOnce();
});
it('bounds constructor failures and message-send failures',()=>{
 manager.dispose();const factory=vi.fn(()=>{throw Error('Worker unavailable');});manager=new RegionPreviewManager(factory);manager.onError=error;
 manager.preview(spec(),'hair');vi.advanceTimersByTime(100000);expect(factory).toHaveBeenCalledTimes(2);expect(error).toHaveBeenCalledOnce();
 manager.dispose();manager=new RegionPreviewManager(()=>{const worker=new FakeWorker();worker.postMessage.mockImplementation(()=>{throw Error('Cannot send');});workers.push(worker);return worker as unknown as Worker;});manager.onError=error;
 manager.preview(spec(),'hair');workers[0].emit({type:'ready'});vi.advanceTimersByTime(100);workers[1].emit({type:'ready'});expect(error).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
});
it('stops all retry and result callbacks on unmount',()=>{
 manager.preview(spec(),'hair');workers[0].emit({type:'ready'});const stale=workers[0].result();workers[0].fail();manager.dispose();vi.advanceTimersByTime(100000);workers[0].emit(stale);
 expect(workers).toHaveLength(1);expect(result).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it('uses a stable worker address under the project path',()=>{
 manager.dispose();vi.stubEnv('BASE_URL','./');history.replaceState(null,'','/facemix/');const requests:any[]=[];
 vi.stubGlobal('Worker',class extends FakeWorker{constructor(...args:any[]){super();requests.push(args);workers.push(this);}});
 manager=new RegionPreviewManager();manager.preview(spec(),'ears');expect(String(requests[0][0])).toBe(new URL('/facemix/workers/region-preview.worker.js',location.origin).href);expect(requests[0]).toHaveLength(1);
 workers[0].fail();vi.advanceTimersByTime(100);expect(requests[1][0].pathname).toBe('/facemix/workers/region-preview.worker.js');expect(requests[1][0].searchParams.has('retry')).toBe(true);
});
