// Recording-only tooling. This file is not part of the deployed Chessbuddy app.
import { chessConvai } from './convaiManager';
import { stockfishEngine } from './stockfishEngine';
import { Chess } from 'chess.js';

const w=window as any;
w.__demoManager=chessConvai;
w.__demoStockfish=stockfishEngine;
let frames: Array<{t:number;v:number[]}>=[];
let captureOrigin=0;
w.__demoBeginMha=()=>{frames=[];captureOrigin=performance.now();return captureOrigin;};
w.__demoEndMha=()=>({origin:captureOrigin,frames});
w.__demoCaptureMha=(v:ArrayLike<number>)=>{if(captureOrigin)frames.push({t:(performance.now()-captureOrigin)/1000,v:Array.from(v)});};

if(localStorage.getItem('demo-replay')==='1'){
  const manager=chessConvai as any;
  let active='leila', speaking=false, sequence=0;
  let audio:HTMLAudioElement|null=null;
  let clip:any=null;
  let index=0;
  const statusListeners=new Set<(s:any)=>void>();
  const responseListeners=new Set<(s:any)=>void>();
  const status=()=>({activeCoachId:active,connected:true,botReady:true,connecting:false,speaking,thinking:false,convaiTurnInFlight:speaking,micEnabled:false,voiceMuted:false,coaches:{[active]:{connected:true,botReady:true,connecting:false,speaking,thinking:false}}});
  const emit=()=>statusListeners.forEach(f=>f(status()));
  manager.getStatus=status;
  manager.onStatus=(f:any)=>{statusListeners.add(f);f(status());return()=>statusListeners.delete(f);};
  manager.onResponse=(f:any)=>{responseListeners.add(f);return()=>responseListeners.delete(f);};
  manager.getIsSpeaking=(id?:string)=>speaking&&(!id||id===active);
  manager.getLipsyncQueue=()=>null;
  manager.reportLipsyncRenderState=()=>{};
  manager.connectCoach=async(c:any)=>{active=c.id;emit();};
  for(const name of ['updateCoachContext','seedStaticCoachPolicy','refreshBoardVision','waitUntilSpeechFinished','syncEndUserIdentity'])manager[name]=async()=>{};
  manager.runCoachTurn=async()=>{const id=w.__demoMoveReplies?.shift();return id?play(id):'';};
  manager.beginNewGame=async(c:any)=>{active=c.id;emit();return 'Your move — let’s look at this position.';};
  manager.interruptBot=()=>{};
  w.__demoReplayFrame=(coach:string)=>{
    if(!clip||!audio||audio.ended||coach!==active)return null;
    const t=audio.currentTime;
    while(index+1<clip.frames.length&&clip.frames[index+1].t<=t)index++;
    if(!clip.frames[index]||clip.frames[index].t>t||t>clip.frames[clip.frames.length-1].t+.12)return null;
    return clip.frames[index].v;
  };
  const play=async(id:string)=>{
    const data=await fetch('/demo-data/'+id+'.json').then(r=>{if(!r.ok)throw Error('Missing recorded reply '+id);return r.json();});
    if(data.frames.some((f:any)=>f.v.length!==251||f.v.some((v:any)=>!Number.isFinite(v))))throw Error('Invalid recorded MHA frame');
    clip=data;index=0;active=data.coach;
    audio=new Audio('/demo-data/'+id+'.wav');audio.preload='auto';
    await new Promise<void>((resolve,reject)=>{audio!.oncanplaythrough=()=>resolve();audio!.onerror=()=>reject(Error('Replay audio unavailable'));audio!.load();});
    const response={coachId:active,characterName:active,text:data.text,responseId:'demo-'+(++sequence)};
    speaking=true;emit();responseListeners.forEach(f=>f(response));
    await audio.play();w.__demoEvent?.('replay-start',{id,text:data.text,browserTime:performance.now()});
    await new Promise<void>(resolve=>{audio!.onended=()=>resolve();});
    speaking=false;clip=null;emit();w.__demoEvent?.('replay-end',{id,browserTime:performance.now()});
    return data.text;
  };
  w.__demoPlayReply=play;
  manager.speakGameOver=async(c:any)=>c.id==='leila'?play('leila-gameover'):'';
  manager.sendUserChat=async(_c:any,_d:any,message:string)=>{
    const manifest=await fetch('/demo-data/manifest.json').then(r=>r.json());
    const id=manifest[message];if(!id)throw Error('No recorded genuine response for this question');
    return play(id);
  };
  const original=stockfishEngine.bestMove.bind(stockfishEngine);
  (stockfishEngine as any).bestMove=async(fen:string,...args:any[])=>{
    const planned=w.__demoBlackMoves?.shift();
    if(!planned)return original(fen,args[0],args[1]);
    await new Promise(r=>setTimeout(r,750));
    return new Chess(fen).move(planned);
  };
}
