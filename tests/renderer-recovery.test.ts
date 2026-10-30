// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {assets} from '../src/data';
import {RenderManager} from '../src/render-manager';
import {defaultRecipe,type RenderSpec} from '../src/types';

class FakeWorker {
 onmessage?: (event:any)=>void;
 onerror?: (event:any)=>void;
 onmessageerror?: (event:any)=>void;
 messages:any[]=[];
 postMessage=vi.fn((message:any)=>{this.messages.push(message);});
 terminate=vi.fn();
 emit(data:any){this.onmessage?.({data});}
 fail(){this.onerror?.({message:'Worker script failed',preventDefault:vi.fn()});}
}
let workers:FakeWorker[],manager:RenderManager;
const spec=(revision=1):RenderSpec=>({revision,sources:[{id:'photo'}] as RenderSpec['sources'],template:{points:[]} as RenderSpec['template'],recipe:defaultRecipe(),size:2048,quality:'final'});
beforeEach(()=>{
 vi.useFakeTimers();workers=[];assets.clear();assets.set('photo',{blob:new Blob(['photo']),url:'blob:photo'});
 manager=new RenderManager(()=>{const worker=new FakeWorker();workers.push(worker);return worker as unknown as Worker;});
});
afterEach(()=>{manager.dispose();assets.clear();vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});

it('restores all photo assets and the exact output settings after a startup failure',()=>{
 const error=vi.fn(),result=vi.fn();manager.onError=error;manager.onResult=result;
 const request=spec();manager.render(request);workers[0].fail();vi.advanceTimersByTime(100);
 expect(workers).toHaveLength(2);expect(workers[0].terminate).toHaveBeenCalledOnce();
 expect(workers[1].messages).toEqual([{type:'configure',forceCPU:true},{type:'asset',id:'photo',blob:assets.get('photo')!.blob},{type:'render',job:1,spec:request}]);
 workers[1].emit({type:'ready'});workers[1].emit({type:'result',job:1,width:1638,height:2048,backend:'CPU'});
 expect(result).toHaveBeenCalledOnce();expect(error).not.toHaveBeenCalled();
});
it('retries the latest request and closes results from the failed worker',()=>{
 manager.render(spec());workers[0].fail();manager.render(spec(2));vi.advanceTimersByTime(100);
 expect(workers[1].messages.at(-1).spec.revision).toBe(2);
 const close=vi.fn();workers[0].emit({type:'result',job:1,bitmap:{close}});workers[0].fail();
 expect(close).toHaveBeenCalledOnce();expect(workers[1].terminate).not.toHaveBeenCalled();
 const stale=vi.fn();workers[1].emit({type:'result',job:1,bitmap:{close:stale}});expect(stale).toHaveBeenCalledOnce();
});
it('retries a worker constructor failure, then reports a second failure without looping',()=>{
 manager.dispose();const factory=vi.fn(()=>{throw new Error('Worker unavailable');});manager=new RenderManager(factory);const error=vi.fn();manager.onError=error;
 manager.render(spec());vi.advanceTimersByTime(100000);
 expect(factory).toHaveBeenCalledTimes(2);expect(error).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it('recovers when a worker does not send its startup response',()=>{
 manager.render(spec());vi.advanceTimersByTime(15100);expect(workers).toHaveLength(2);
 workers[1].emit({type:'ready'});vi.advanceTimersByTime(60000);expect(workers[1].terminate).not.toHaveBeenCalled();
});
it('does not apply a startup timeout to a long render after the worker is ready',()=>{
 manager.render(spec());workers[0].emit({type:'ready'});vi.advanceTimersByTime(120000);expect(workers).toHaveLength(1);expect(workers[0].terminate).not.toHaveBeenCalled();
});
it('recovers from an unreadable worker message',()=>{
 manager.render(spec());workers[0].onmessageerror?.({});vi.advanceTimersByTime(100);expect(workers).toHaveLength(2);
});
it.each(['cancel','dispose'] as const)('%s prevents a delayed retry from restarting work',action=>{
 manager.render(spec());workers[0].fail();manager[action]();vi.advanceTimersByTime(100000);expect(workers).toHaveLength(1);
});
it('updates and removes assets without resending unchanged photo blobs',()=>{
 manager.render(spec());workers[0].emit({type:'ready'});manager.render(spec(2));
 expect(workers[0].messages.filter(m=>m.type==='asset')).toHaveLength(1);
 const blob=new Blob(['replaced']);assets.set('photo',{blob,url:'blob:replacement'});manager.render(spec(3));
 expect(workers[0].messages.filter(m=>m.type==='asset').at(-1).blob).toBe(blob);
 manager.render({...spec(4),sources:[]});expect(workers[0].messages).toContainEqual({type:'remove',id:'photo'});
});
it('uses the stable worker address on a project site',()=>{
 manager.dispose();vi.stubEnv('BASE_URL','./');history.replaceState(null,'','/facemix/');const requests:any[]=[];
 vi.stubGlobal('Worker',class extends FakeWorker{constructor(...args:any[]){super();requests.push(args);}});
 manager=new RenderManager();manager.render(spec());
 expect(String(requests[0][0])).toBe(new URL('/facemix/workers/render.worker.js?v=1.7.0',location.origin).href);
 expect(requests[0]).toHaveLength(1);
 history.replaceState(null,'','/');
});
