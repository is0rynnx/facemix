// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
class FakeWorker {
 onmessage?: (event:any)=>void;
 onerror?: (event:any)=>void;
 onmessageerror?: (event:any)=>void;
 messages:any[]=[];
 postMessage=vi.fn((message:any)=>{this.messages.push(message);});
 terminate=vi.fn();
 emit(data:any){this.onmessage?.({data});}
 done(){this.emit({type:'detected',job:this.messages.findLast(m=>m.type==='detect').job,found:true,landmarks:[]});}
}
let workers:FakeWorker[],service:typeof import('../src/services');
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
beforeEach(async()=>{
 vi.resetModules();vi.useFakeTimers();workers=[];
 vi.stubGlobal('Worker',class extends FakeWorker{constructor(){super();workers.push(this);}});
 service=await import('../src/services');
});
afterEach(async()=>{service.cancelPreparation();await flush();vi.useRealTimers();vi.unstubAllGlobals();});
it('terminates a stalled detector and completes one retry with a new worker',async()=>{
 const pending=service.detect(new Blob(['photo']));await flush();workers[0].emit({type:'ready'});await flush();
 await vi.advanceTimersByTimeAsync(45000);
 expect(workers[0].terminate).toHaveBeenCalledOnce();expect(workers).toHaveLength(2);
 workers[0].emit({type:'error',message:'late failure'});expect(workers[1].terminate).not.toHaveBeenCalled();
 workers[1].emit({type:'ready'});await flush();workers[1].done();expect((await pending).found).toBe(true);
 expect(vi.getTimerCount()).toBe(0);
});
it('stops after two setup timeouts and permits a later attempt',async()=>{
 const pending=service.detect(new Blob()).catch(error=>error);await flush();await vi.advanceTimersByTimeAsync(120000);
 expect((await pending).message).toContain('setup timed out');expect(workers).toHaveLength(2);expect(workers.every(w=>w.terminate.mock.calls.length===1)).toBe(true);
 const next=service.detect(new Blob());await flush();expect(workers).toHaveLength(3);workers[2].emit({type:'ready'});await flush();workers[2].done();await next;
});
it('does not start the next photo timer while an earlier photo is running',async()=>{
 const a=service.detect(new Blob()),b=service.detect(new Blob());await flush();workers[0].emit({type:'ready'});await flush();
 await vi.advanceTimersByTimeAsync(44000);expect(workers[0].messages.filter(m=>m.type==='detect')).toHaveLength(1);
 workers[0].done();await a;await flush();await vi.advanceTimersByTimeAsync(44000);expect(workers).toHaveLength(1);
 workers[0].done();await b;expect(vi.getTimerCount()).toBe(0);
});
it('cancels active and queued photos without retrying or keeping preparation active',async()=>{
 const a=service.detect(new Blob()).catch(e=>e),b=service.detect(new Blob()).catch(e=>e);await flush();
 service.cancelPreparation();expect((await a).message).toContain('cancelled');expect((await b).message).toContain('cancelled');
 await vi.advanceTimersByTimeAsync(150000);expect(workers).toHaveLength(1);expect(vi.getTimerCount()).toBe(0);
});
it.each(['onerror','onmessageerror'] as const)('recovers from %s without accepting a stale response',async event=>{
 const pending=service.detect(new Blob());await flush();workers[0][event]?.({message:'worker failed',preventDefault:vi.fn()});await flush();
 expect(workers).toHaveLength(2);workers[0].emit({type:'ready'});await flush();expect(workers[1].messages.some(m=>m.type==='detect')).toBe(false);
 workers[1].emit({type:'ready'});await flush();workers[1].done();await pending;
});
it('bounds constructor and message-send failures',async()=>{
 const construct=vi.fn(()=>{throw Error('Cannot start');});vi.stubGlobal('Worker',class{constructor(){construct();}});
 await expect(service.detect(new Blob())).rejects.toThrow('Cannot start');expect(construct).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
 vi.stubGlobal('Worker',class extends FakeWorker{constructor(){super();workers.push(this);}postMessage=vi.fn(()=>{throw Error('Cannot send');});});
 await expect(service.detect(new Blob())).rejects.toThrow('Cannot send');expect(workers).toHaveLength(2);expect(workers.every(w=>w.terminate.mock.calls.length===1)).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it('retains editable landmarks and leaves preparing status when both workers fail',async()=>{
 const {useStudio,newProject}=await import('../src/store');const {assets}=await import('../src/data');
 const project=newProject(),landmarks=[{id:'manual',x:.4,y:.6,enabled:true,authored:true,locked:false}];
 project.sources=[{id:'sample',status:'preparing',landmarks} as any];useStudio.setState({project,past:[],future:[]});assets.set('sample',{blob:new Blob(),url:'blob:sample'});
 const pending=service.analyzeSource('sample');await flush();workers[0].onerror?.({message:'failed'});await flush();workers[1].onerror?.({message:'failed again'});await pending;
 expect(useStudio.getState().project.sources[0]).toMatchObject({status:'manual',landmarks,note:'Error: failed again'});assets.clear();
});
