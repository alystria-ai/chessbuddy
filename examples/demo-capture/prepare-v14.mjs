import {writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {Chess}=createRequire(new URL('../../package.json',import.meta.url))('chess.js');
const call=async(path,data={})=>{const r=await fetch('http://127.0.0.1:8797/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const t=await r.text();if(!r.ok)throw Error(t);return t?JSON.parse(t):null;};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(test,label){const end=Date.now()+120000;while(Date.now()<end){const s=await call('status');if(test(s))return s;await delay(200);}throw Error(label+' timed out');}
const line='e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a6 Bb3 Ba7 Nbd2 h6 Nf1 Be6 Ng3 Qd7 h3 Bxb3';
const game=new Chess();for(const san of line.split(' '))game.move(san);game.move('axb3');const planned=game.move('Rfe8');
await call('eval',{code:"localStorage.setItem('classic-chess.coachingControlMode.v1','game')"});
await call('prepare',{coach:'sofia',lines:{sofia:line},replay:false});await call('click',{name:'Open game library'});await call('click',{selector:'.games-list button:has-text("Sofia")'});await call('click',{name:'Resume game'});
await until(s=>s.canvas.length&&!s.text.includes('LOADING')&&s.text.includes('Your move — choose a piece.'),'ready');
await call('eval',{code:`(()=>{window.__demoStockfish.bestMove=async()=>(${JSON.stringify(planned)});const m=window.__demoManager;const original=m.runCoachTurn.bind(m);window.__v14MoveProof=[];m.runCoachTurn=async(...args)=>{window.__v14MoveProof.push({coach:args[0].id,dynamicInfo:args[1],options:{runLlm:args[2]?.runLlm,waitForFullSpeech:args[2]?.waitForFullSpeech},source:'normal player move -> makeCoachMove -> runCoachTurn'});const text=await original(...args);window.__v14MoveProof.at(-1).returnedText=text;return text;};return true;})()`});
await delay(1000);await call('record',{name:'sofia-move-source',format:'webm'});await call('mha-start');
await call('click',{selector:'.chess-board button[aria-label^="a2"]'});await call('click',{selector:'.chess-board button[aria-label^="b3"]'});await call('pointer',{x:990,y:1240});
await until(s=>s.text.includes('is speaking'),'move response');await call('mark',{name:'speech-start'});await until(s=>s.text.includes('Your move — choose a piece.'),'move response complete');await call('mark',{name:'speech-end'});await delay(700);
const result=await call('eval',{code:"({text:window.__demoManager.pool.get('sofia').longestResponseText,proof:window.__v14MoveProof})"});
await writeFile('capture/sofia-move-reply.json',JSON.stringify({id:'sofia-move',coach:'sofia',line,...result},null,2));console.log(result.text);console.log(await call('mha-save',{name:'sofia-move'}));await call('stop');await call('close');
