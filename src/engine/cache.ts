/** Small, bounded LRU cache. Values are reused without changing their precision. */
export class BoundedCache<T>{
 private items=new Map<string,{value:T;cost:number}>();
 constructor(private maxEntries:number,private maxCost:number){}
 get(key:string){const item=this.items.get(key);if(!item)return;this.items.delete(key);this.items.set(key,item);return item.value;}
 set(key:string,value:T,cost=1){if(cost>this.maxCost)return;this.items.delete(key);this.items.set(key,{value,cost});while(this.items.size>this.maxEntries||[...this.items.values()].reduce((n,v)=>n+v.cost,0)>this.maxCost)this.items.delete(this.items.keys().next().value!);}
 get size(){return this.items.size;}
}
