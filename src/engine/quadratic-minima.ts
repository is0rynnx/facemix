/** Exact lower envelope for cost[k] + scale * (j-k)^2.
 * Equal costs keep the lowest input index, as in an ascending full search. */
export function quadraticMinima(cost:Float64Array,scale:number):Uint8Array{
 const n=cost.length,result=new Uint8Array(n),vertices=new Uint8Array(n),limits=new Float64Array(n+1);
 let top=0;limits[0]=-Infinity;limits[1]=Infinity;
 for(let q=1;q<n;q++){
  let p=vertices[top],cross=(cost[q]-cost[p])/(2*scale*(q-p))+(q+p)/2;
  while(top>0&&cross<=limits[top]){p=vertices[--top];cross=(cost[q]-cost[p])/(2*scale*(q-p))+(q+p)/2;}
  vertices[++top]=q;limits[top]=cross;limits[top+1]=Infinity;
 }
 top=0;for(let j=0;j<n;j++){while(limits[top+1]<j)top++;result[j]=vertices[top];}
 return result;
}
