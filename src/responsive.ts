/** Preview resolution is independent of export resolution. */
export function previewSize(width:number,zoom:number):number{
 if(width<=640)return zoom>1.5?768:512;
 if(width<=1050)return zoom>1.5?1024:768;
 return zoom>1.5?2048:1024;
}
