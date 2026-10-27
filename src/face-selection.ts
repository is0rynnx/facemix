import {create} from 'zustand';
import type {DetectedFace} from './types';

export interface FaceChoice {index:number;crop:boolean;}
interface Request {name:string;url:string;faces:DetectedFace[];resolve:(choice:FaceChoice|null)=>void;}
const queue:Request[]=[];
export const useFaceSelection=create<{request?:Request}>(()=>({}));
export function chooseFace(name:string,url:string,faces:DetectedFace[]):Promise<FaceChoice|null>{
 return new Promise(resolve=>{const request={name,url,faces,resolve};if(useFaceSelection.getState().request)queue.push(request);else useFaceSelection.setState({request});});
}
export function finishFaceChoice(choice:FaceChoice|null){const current=useFaceSelection.getState().request;if(!current)return;useFaceSelection.setState({request:queue.shift()});current.resolve(choice);}
export function cancelFaceChoices(){const requests=[useFaceSelection.getState().request,...queue.splice(0)];useFaceSelection.setState({request:undefined});for(const request of requests)request?.resolve(null);}
